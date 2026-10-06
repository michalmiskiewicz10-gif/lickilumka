import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, Client, EmbedBuilder, Events, GatewayIntentBits,
  MessageFlags, ModalBuilder, PermissionFlagsBits, SlashCommandBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { genKey, parseDuration, parseText, isExpired, expiryText } from './util.js';

const EPHEMERAL = MessageFlags.Ephemeral;

export function createBot({ store, env }) {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  const adminIds = (env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);

  /** Uprawnienia: lista ADMIN_IDS albo "Zarzadzanie serwerem". */
  function isAdmin(i) {
    if (adminIds.length) return adminIds.includes(i.user.id);
    return i.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;
  }

  // ---------- wyglad wiadomosci z licencja ----------
  function buildMessage(lic) {
    const expired = isExpired(lic);
    let status, color;
    if (lic.revoked) { status = '🔴 Unieważniona'; color = 0xed4245; }
    else if (expired) { status = '🟠 Wygasła'; color = 0xf0a020; }
    else if (lic.hwid) { status = '🟢 Aktywowana (przypisana do komputera)'; color = 0x57f287; }
    else { status = '🟡 Jeszcze nie użyta'; color = 0x5865f2; }

    const embed = new EmbedBuilder()
      .setTitle('🔑 Licencja AutoRynek')
      .setColor(color)
      .addFields(
        { name: 'Nick gracza', value: `\`${lic.nick}\``, inline: true },
        { name: 'Discord', value: `<@${lic.discordId}>`, inline: true },
        { name: 'Status', value: status, inline: false },
        { name: 'Kod licencyjny', value: `\`\`\`${lic.key}\`\`\`` },
        { name: 'Wygasa', value: expiryText(lic) },
      )
      .setFooter({ text: `Utworzył: ${lic.createdByTag}` })
      .setTimestamp(lic.createdAt);

    const dead = !!lic.revoked;
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`ext:${lic.key}`).setLabel('Przedłuż licencję')
        .setStyle(ButtonStyle.Success).setDisabled(dead),
      new ButtonBuilder().setCustomId(`rev:${lic.key}`).setLabel('Unieważnij licencję')
        .setStyle(ButtonStyle.Danger).setDisabled(dead),
    );
    return { embeds: [embed], components: [row] };
  }

  /** Odswieza wiadomosc na kanale licencji (po przedluzeniu / uniewaznieniu / aktywacji). */
  async function refreshMessage(lic) {
    if (!lic.channelId || !lic.messageId) return;
    try {
      const ch = await client.channels.fetch(lic.channelId);
      const msg = await ch.messages.fetch(lic.messageId);
      await msg.edit(buildMessage(lic));
    } catch (e) {
      console.error('Nie udalo sie odswiezyc wiadomosci:', e.message);
    }
  }

  // ---------- komenda /licencja ----------
  const command = new SlashCommandBuilder()
    .setName('licencja')
    .setDescription('Tworzy jednorazowy kod licencyjny do moda')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o => o.setName('nick').setDescription('Nick gracza w Minecrafcie').setRequired(true)
      .setMinLength(1).setMaxLength(16))
    .addUserOption(o => o.setName('discord').setDescription('Użytkownik Discorda, który kupuje licencję').setRequired(true))
    .addStringOption(o => o.setName('jednostka').setDescription('Na jak długo').setRequired(true).addChoices(
      { name: 'Sekundy', value: 's' },
      { name: 'Minuty', value: 'm' },
      { name: 'Godziny', value: 'h' },
      { name: 'Dni', value: 'd' },
      { name: 'Permanentna (bez końca)', value: 'perm' },
    ))
    .addIntegerOption(o => o.setName('ilosc').setDescription('Ile sekund/minut/godzin/dni (pomiń przy permanentnej)')
      .setMinValue(1).setMaxValue(3650 * 86400));

  async function handleCreate(i) {
    if (!isAdmin(i)) return i.reply({ content: '❌ Nie masz uprawnień.', flags: EPHEMERAL });

    const nick = i.options.getString('nick', true).trim();
    const user = i.options.getUser('discord', true);
    const unit = i.options.getString('jednostka', true);
    const amount = i.options.getInteger('ilosc');

    if (!/^[A-Za-z0-9_]{1,16}$/.test(nick)) {
      return i.reply({ content: '❌ Nick Minecraft: 1-16 znaków, tylko litery, cyfry i `_`.', flags: EPHEMERAL });
    }
    const dur = parseDuration(unit, amount);
    if (!dur) {
      return i.reply({
        content: '❌ Podaj poprawną **ilość** (np. 7 dni). Przy „Permanentna” ilość nie jest potrzebna. Maks. 3650 dni.',
        flags: EPHEMERAL,
      });
    }

    const channelId = env.LICENSE_CHANNEL_ID;
    let channel;
    try { channel = await client.channels.fetch(channelId); }
    catch { return i.reply({ content: '❌ Nie widzę kanału licencji. Sprawdź `LICENSE_CHANNEL_ID` i uprawnienia bota.', flags: EPHEMERAL }); }

    let key;
    do { key = genKey(); } while (store.has(key));
    const now = Date.now();
    const lic = {
      key, nick, discordId: user.id,
      createdAt: now,
      expiresAt: dur.perm ? null : now + dur.ms,
      hwid: null, activatedAt: null, lastSeen: null,
      revoked: false,
      createdByTag: i.user.tag ?? i.user.username,
      channelId, messageId: null,
    };

    try {
      const msg = await channel.send(buildMessage(lic));
      lic.messageId = msg.id;
    } catch (e) {
      return i.reply({ content: `❌ Nie mogę wysłać na kanał: ${e.message}`, flags: EPHEMERAL });
    }
    store.put(lic);

    // kod do kupujacego w DM (jesli ma wylaczone DM - trudno, kod jest i tak na kanale)
    let dm = '';
    try {
      await user.send(`🔑 Twój kod licencyjny do AutoRynek (nick **${nick}**):\n\`${key}\`\nW grze wpisz: \`/autorynek licencja ${key}\`\nKod działa tylko na jednym komputerze i tylko dla nicku **${nick}**.`);
      dm = '\n📩 Kod wysłano też w DM do kupującego.';
    } catch { dm = '\n⚠️ Nie udało się wysłać DM (kupujący ma zablokowane wiadomości).'; }

    return i.reply({
      content: `✅ Licencja utworzona.\n**Kod:** \`${key}\`\nWiadomość poszła na <#${channelId}>.${dm}`,
      flags: EPHEMERAL,
    });
  }

  // ---------- przyciski ----------
  async function handleButton(i) {
    if (!isAdmin(i)) return i.reply({ content: '❌ Nie masz uprawnień.', flags: EPHEMERAL });
    const [action, key] = i.customId.split(':');
    const lic = store.get(key);
    if (!lic) return i.reply({ content: '❌ Nie ma takiej licencji w bazie.', flags: EPHEMERAL });

    if (action === 'rev') {
      if (lic.revoked) return i.reply({ content: 'Ta licencja jest już unieważniona.', flags: EPHEMERAL });
      lic.revoked = true;
      lic.revokedAt = Date.now();
      store.put(lic);
      await i.update(buildMessage(lic));
      return i.followUp({ content: `🔴 Unieważniono licencję \`${key}\`. Mod przestanie działać w ciągu kilku minut.`, flags: EPHEMERAL });
    }

    if (action === 'ext') {
      if (lic.revoked) return i.reply({ content: '❌ Licencja jest unieważniona - nie da się jej przedłużyć.', flags: EPHEMERAL });
      const modal = new ModalBuilder().setCustomId(`extm:${key}`).setTitle('Przedłuż licencję').addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('czas').setLabel('O ile przedłużyć? (30s, 10m, 12h, 7d, perm)')
            .setStyle(TextInputStyle.Short).setPlaceholder('np. 7d').setRequired(true).setMaxLength(12),
        ),
      );
      return i.showModal(modal);
    }
  }

  async function handleModal(i) {
    if (!i.customId.startsWith('extm:')) return;
    if (!isAdmin(i)) return i.reply({ content: '❌ Nie masz uprawnień.', flags: EPHEMERAL });
    const key = i.customId.slice(5);
    const lic = store.get(key);
    if (!lic || lic.revoked) return i.reply({ content: '❌ Licencja nie istnieje albo jest unieważniona.', flags: EPHEMERAL });

    const dur = parseText(i.fields.getTextInputValue('czas'));
    if (!dur) return i.reply({ content: '❌ Zły format. Przykłady: `30s`, `10m`, `12h`, `7d`, `perm`.', flags: EPHEMERAL });

    if (dur.perm) {
      lic.expiresAt = null;
    } else if (lic.expiresAt == null) {
      return i.reply({ content: 'Ta licencja jest już permanentna.', flags: EPHEMERAL });
    } else {
      // jesli jeszcze trwa - dodaj do konca; jesli wygasla - licz od teraz
      lic.expiresAt = Math.max(Date.now(), lic.expiresAt) + dur.ms;
    }
    store.put(lic);
    await refreshMessage(lic);
    const when = lic.expiresAt == null ? 'permanentna' : `do <t:${Math.floor(lic.expiresAt / 1000)}:F>`;
    return i.reply({ content: `🟢 Przedłużono licencję \`${key}\` - teraz ${when}.`, flags: EPHEMERAL });
  }

  client.on(Events.InteractionCreate, async i => {
    try {
      if (i.isChatInputCommand() && i.commandName === 'licencja') await handleCreate(i);
      else if (i.isButton()) await handleButton(i);
      else if (i.isModalSubmit()) await handleModal(i);
    } catch (e) {
      console.error(e);
      try {
        const msg = { content: '❌ Wystąpił błąd.', flags: EPHEMERAL };
        if (i.replied || i.deferred) await i.followUp(msg); else await i.reply(msg);
      } catch { /* ignoruj */ }
    }
  });

  client.once(Events.ClientReady, async c => {
    console.log(`Bot zalogowany jako ${c.user.tag}`);
    try {
      if (env.GUILD_ID) {
        const guild = await c.guilds.fetch(env.GUILD_ID);
        await guild.commands.set([command.toJSON()]);   // od razu widoczna
      } else {
        await c.application.commands.set([command.toJSON()]); // globalnie (do godziny)
      }
      console.log('Komenda /licencja zarejestrowana.');
    } catch (e) { console.error('Rejestracja komendy nie powiodla sie:', e.message); }
  });

  return { client, refreshMessage };
}
