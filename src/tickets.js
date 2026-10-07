import { sendPanel } from './util.js';
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, MessageFlags,
  PermissionFlagsBits as P, PermissionFlagsBits, SlashCommandBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
} from 'discord.js';
import { findAsset } from './assets.js';

const EPHEMERAL = MessageFlags.Ephemeral;

/**
 * Kategorie ticketow. Kazda trafia do WLASNEJ kategorii (folderu) Discorda:
 *   zakup -> TICKET_CATEGORY_ZAKUP, pomoc -> TICKET_CATEGORY_POMOC, wspolpraca -> TICKET_CATEGORY_WSPOLPRACA
 * (jesli danej zmiennej brak, uzywany jest TICKET_CATEGORY_ID).
 */
const CATS = {
  zakup: {
    label: 'Zakup', desc: 'Chcę kupić licencję / moda', emoji: '🛒', color: 0x57f287,
    intro: 'Napisz, co chcesz kupić – administracja prześle Ci szczegóły płatności i przygotuje licencję.',
  },
  pomoc: {
    label: 'Pomoc', desc: 'Uzyskaj pomoc od administracji', emoji: '❓', color: 0xed4245,
    intro: 'Opisz dokładnie swój problem – administracja odpowie tak szybko, jak to możliwe.',
  },
  wspolpraca: {
    label: 'Współpraca', desc: 'Zgłoszenie w sprawie współpracy', emoji: '🤝', color: 0xf5c542,
    intro: 'Napisz, na czym ma polegać współpraca i kim jesteś – administracja się z Tobą skontaktuje.',
  },
};

/**
 * System zgloszen (ticketow) z lista wyboru kategorii.
 * Temat kanalu trzyma stan:
 *   ticket:<userId>:<kat>    - otwarty ticket
 *   archiwum:<userId>:<kat>  - zamkniety (gracz usuniety z kanalu, kanal w kategorii "Usuniete", czeka na skasowanie)
 */
export function createTickets({ client, env, isAdmin, serverName }) {
  const staffRole = env.TICKET_STAFF_ROLE_ID;
  const adminIds = (env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  const deletedCategory = env.TICKET_CATEGORY_DELETED;
  const parentFor = key => env[`TICKET_CATEGORY_${key.toUpperCase()}`] || env.TICKET_CATEGORY_ID || undefined;

  const ticketCmd = new SlashCommandBuilder()
    .setName('zgloszenia').setDescription('Wysyła na kanał panel systemu zgłoszeń (ticketów)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

  // /zaproponuj_zamkniecie - bez setDefaultMemberPermissions, zeby mogl jej uzyc tez personel z TICKET_STAFF_ROLE_ID (uprawnienia sprawdza handler)
  const proposeCmd = new SlashCommandBuilder()
    .setName('zaproponuj_zamkniecie').setDescription('Proponuje zamknięcie tego zgłoszenia (gracz lub administracja potwierdza przyciskiem)')
    .addStringOption(o => o.setName('powod').setDescription('Dlaczego proponujesz zamknięcie (opcjonalnie)').setMaxLength(300));

  function selectRow() {
    const select = new StringSelectMenuBuilder()
      .setCustomId('ticket:select').setPlaceholder('Wybierz kategorię ticketu...')
      .addOptions(Object.entries(CATS).map(([value, c]) =>
        new StringSelectMenuOptionBuilder().setLabel(c.label).setDescription(c.desc).setValue(value).setEmoji({ name: c.emoji })));
    return new ActionRowBuilder().addComponents(select);
  }

  function panelMessage({ noBanner = false } = {}) {
    const embed = new EmbedBuilder()
      .setColor(0x2b2d31)
      .setTitle(`📩 Centrum Pomocy • ${serverName}`)
      .setDescription('Wybierz odpowiednią kategorię z rozwijanego menu poniżej, aby otworzyć prywatne zgłoszenie z personelem serwera.');
    const payload = { embeds: [embed], components: [selectRow()] };
    if (!noBanner) {
      // grafika kota z folderu assets/ jest wysylana jako zalacznik - nie wygasa jak link z Discorda
      const img = findAsset('ticket', 'kot');
      if (img) {
        embed.setImage(`attachment://${img.name}`);
        payload.files = [img];
      } else {
        const url = (env.TICKET_BANNER_URL || env.BANNER_URL || '').trim();
        if (/^https?:\/\//i.test(url)) embed.setImage(url);
      }
    }
    return payload;
  }

  const ownerOf = ch => {
    const m = /^ticket:(\d+):/.exec(ch?.topic || '');
    return m ? m[1] : null;
  };
  const isArchived = ch => /^archiwum:\d+:/.test(ch?.topic || '');
  const isStaffMember = i => (!!staffRole && i.member?.roles?.cache?.has(staffRole)) || isAdmin(i);

  /**
   * Tworzy ticket danej kategorii dla uzytkownika z interakcji `i` (musi byc juz zdeferowana/odpowiedziana).
   * Zwraca { ok, message, channel } - `message` to tekst dla gracza.
   */
  async function open(i, key, { extra = '' } = {}) {
    const cat = CATS[key];
    if (!cat) return { ok: false, message: '❌ Ta kategoria nie jest już dostępna. Poproś administrację o nowy panel.' };

    const guild = i.guild;
    const existing = guild.channels.cache.find(c => ownerOf(c) === i.user.id);
    if (existing) return { ok: false, message: `❌ Masz już otwarte zgłoszenie: <#${existing.id}>` };

    const nick = (i.user.username || 'user').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20) || 'user';
    const overwrites = [
      { id: guild.id, deny: [P.ViewChannel] },
      { id: i.user.id, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles, P.EmbedLinks] },
      { id: client.user.id, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.EmbedLinks, P.ManageChannels, P.ManageRoles] },
    ];
    if (staffRole) overwrites.push({ id: staffRole, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles, P.EmbedLinks] });
    for (const id of adminIds) overwrites.push({ id, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles, P.EmbedLinks] });

    let ch;
    try {
      ch = await guild.channels.create({
        name: `${key}-${nick}`, type: ChannelType.GuildText,
        parent: parentFor(key),
        topic: `ticket:${i.user.id}:${key}`,
        permissionOverwrites: overwrites,
      });
    } catch (e) {
      console.error('Nie udalo sie utworzyc ticketu:', e.message);
      return { ok: false, message: `❌ Nie udało się utworzyć zgłoszenia (sprawdź ID kategorii \`TICKET_CATEGORY_${key.toUpperCase()}\` i uprawnienie bota „Zarządzanie kanałami”).` };
    }

    const embed = new EmbedBuilder()
      .setColor(cat.color)
      .setTitle(`${cat.emoji} Zgłoszenie – ${cat.label}`)
      .setDescription([`Witaj <@${i.user.id}>!`, '', cat.intro, ...(extra ? ['', extra] : [])].join('\n'))
      .setFooter({ text: serverName });
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket:close').setLabel('Zamknij zgłoszenie').setEmoji('🔒').setStyle(ButtonStyle.Danger),
    );
    await ch.send({
      content: `<@${i.user.id}>${staffRole ? ` <@&${staffRole}>` : ''}`,
      embeds: [embed], components: [row],
      allowedMentions: { users: [i.user.id], roles: staffRole ? [staffRole] : [] },
    }).catch(e => console.error('Wiadomosc w tickecie:', e.message));

    return { ok: true, message: `✅ Utworzono zgłoszenie: <#${ch.id}>`, channel: ch };
  }

  async function handleSelect(i) {
    const key = i.values[0];
    // lista wyboru zostaje "zaznaczona" - odswiezamy ja, zeby mozna bylo wybrac ponownie (embed i grafika zostaja)
    i.message.edit({ components: [selectRow()] }).catch(() => {});
    await i.deferReply({ flags: EPHEMERAL });
    const r = await open(i, key);
    return i.editReply(r.message);
  }

  /** "Usuniecie" ticketu przez gracza: gracz traci dostep, kanal wedruje do kategorii "Usuniete", reszta (administracja) zostaje. */
  async function handleClose(i) {
    const ch = i.channel;
    const owner = ownerOf(ch);
    if (!owner) {
      return i.reply({
        content: isArchived(ch) ? '🔒 To zgłoszenie jest już zamknięte.' : '❌ To nie jest kanał zgłoszenia.',
        flags: EPHEMERAL,
      });
    }
    if (!(i.user.id === owner || isStaffMember(i))) {
      return i.reply({ content: '❌ Nie masz uprawnień do zamknięcia tego zgłoszenia.', flags: EPHEMERAL });
    }
    await i.deferUpdate();

    const key = /^ticket:\d+:(\w+)/.exec(ch.topic)[1];
    try {
      await ch.permissionOverwrites.delete(owner, 'Zgłoszenie zamknięte – gracz usunięty z kanału');
      await ch.edit({
        topic: `archiwum:${owner}:${key}`,
        ...(deletedCategory ? { parent: deletedCategory, lockPermissions: false } : {}),
      });
    } catch (e) {
      console.error('Zamykanie ticketu:', e.message);
      return i.followUp({
        content: `❌ Nie udało się zamknąć zgłoszenia: ${e.message}\n(Bot potrzebuje uprawnień „Zarządzanie kanałami” i „Zarządzanie rolami”; sprawdź też ID \`TICKET_CATEGORY_DELETED\` – kategoria może być pełna, limit 50 kanałów.)`,
        flags: EPHEMERAL,
      });
    }
    if (!deletedCategory) console.warn('Brak TICKET_CATEGORY_DELETED - kanal zostal w starej kategorii (gracz i tak zostal usuniety).');

    await i.editReply({ components: [] }).catch(() => {});   // zdejmujemy przycisk z pierwszej wiadomosci
    const embed = new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle('🔒 Zgłoszenie zamknięte')
      .setDescription([
        `Zgłoszenie zostało zamknięte przez <@${i.user.id}>.`,
        `Gracz <@${owner}> został usunięty z kanału.`,
        '',
        'Administracja może teraz usunąć kanał całkowicie przyciskiem poniżej.',
      ].join('\n'))
      .setFooter({ text: serverName });
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket:delete').setLabel('Zamknij i usuń kanał').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
    );
    await ch.send({ embeds: [embed], components: [row], allowedMentions: { parse: [] } })
      .catch(e => console.error('Wiadomosc w archiwum ticketu:', e.message));
  }

  /** /zaproponuj_zamkniecie - personel proponuje zamkniecie ticketu; przyciski [Zamknij] / [Zostaw otwarte]. */
  async function handlePropose(i) {
    if (!isStaffMember(i)) return i.reply({ content: '❌ Nie masz uprawnień.', flags: EPHEMERAL });
    const owner = ownerOf(i.channel);
    if (!owner) {
      return i.reply({
        content: isArchived(i.channel) ? '🔒 To zgłoszenie jest już zamknięte.' : '❌ Tej komendy użyjesz tylko na kanale zgłoszenia (ticketu).',
        flags: EPHEMERAL,
      });
    }
    const reason = (i.options.getString('powod') || '').trim();
    const embed = new EmbedBuilder()
      .setColor(0xf5c542)
      .setTitle('🔒 Propozycja zamknięcia zgłoszenia')
      .setDescription([
        `<@${i.user.id}> proponuje zamknięcie tego zgłoszenia.`,
        reason ? `\n**Powód:** ${reason}` : '',
        '\nJeśli sprawa jest załatwiona, kliknij **Zamknij**. Jeśli nie – **Zostaw otwarte**.',
      ].join(''))
      .setFooter({ text: serverName });
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket:propyes').setLabel('Zamknij').setEmoji('🔒').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('ticket:propno').setLabel('Zostaw otwarte').setEmoji('📂').setStyle(ButtonStyle.Secondary),
    );
    return i.reply({
      content: `<@${owner}>`, embeds: [embed], components: [row],
      allowedMentions: { users: [owner] },
    });
  }

  /** [Zostaw otwarte] - odrzucenie propozycji zamkniecia (gracz albo personel). */
  async function handleKeepOpen(i) {
    const owner = ownerOf(i.channel);
    if (!owner) return i.reply({ content: '❌ To nie jest otwarte zgłoszenie.', flags: EPHEMERAL });
    if (!(i.user.id === owner || isStaffMember(i))) {
      return i.reply({ content: '❌ Nie masz uprawnień do tego zgłoszenia.', flags: EPHEMERAL });
    }
    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle('📂 Zgłoszenie zostaje otwarte')
      .setDescription(`<@${i.user.id}> zdecydował, że zgłoszenie zostaje otwarte.`)
      .setFooter({ text: serverName });
    return i.update({ content: '', embeds: [embed], components: [], allowedMentions: { parse: [] } });
  }

  /** Przycisk w kategorii "Usuniete": kasuje kanal calkowicie (tylko administracja). */
  async function handleDelete(i) {
    if (!isArchived(i.channel)) return i.reply({ content: '❌ Ten kanał nie jest zamkniętym zgłoszeniem.', flags: EPHEMERAL });
    if (!isStaffMember(i)) return i.reply({ content: '❌ Tylko administracja może usunąć ten kanał.', flags: EPHEMERAL });
    await i.reply('🗑️ Kanał zostanie usunięty za 5 sekund...');
    setTimeout(() => i.channel.delete('Zgłoszenie usunięte przez administrację').catch(e => console.error('Usuwanie ticketu:', e.message)), 5000);
  }

  return {
    commands: [ticketCmd, proposeCmd],
    handleCommand: async i => {
      if (i.commandName === 'zaproponuj_zamkniecie') return handlePropose(i);
      if (i.commandName !== 'zgloszenia') return;
      if (!isAdmin(i)) return i.reply({ content: '❌ Nie masz uprawnień.', flags: EPHEMERAL });
      // 2. proba: bez grafiki (np. brak uprawnienia "Dolaczanie plikow")
      return sendPanel(i, panelMessage(), panelMessage({ noBanner: true }));
    },
    handleSelect,
    open,
    handleButton: i => {
      if (i.customId === 'ticket:close' || i.customId === 'ticket:propyes') return handleClose(i);
      if (i.customId === 'ticket:propno') return handleKeepOpen(i);
      if (i.customId === 'ticket:delete') return handleDelete(i);
      return null;
    },
  };
}
