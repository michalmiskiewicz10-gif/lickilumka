import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, Client, EmbedBuilder, Events, GatewayIntentBits,
  MessageFlags, ModalBuilder, Partials, PermissionFlagsBits, SlashCommandBuilder, StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { genKey, parseDuration, parseText, isExpired, expiryText, sendPanel } from './util.js';
import { createVerify } from './verify.js';
import { createTickets } from './tickets.js';
import { createLegit } from './legit.js';
import { createMedia } from './media.js';
import { createGiveaway } from './giveaway.js';
import { createShop } from './shop.js';
import { createAntiInvite } from './antiinvite.js';
import { createBoost } from './boost.js';
import { createImageGuard } from './imageguard.js';
import { MODS, DEFAULT_MOD } from './mods.js';
import { findAsset } from './assets.js';

const EPHEMERAL = MessageFlags.Ephemeral;

/** 1 osoba / 2 osoby / 5 osob */
function osob(n) {
  if (n === 1) return '1 osoba';
  const last = n % 10, lastTwo = n % 100;
  if (last >= 2 && last <= 4 && !(lastTwo >= 12 && lastTwo <= 14)) return `${n} osoby`;
  return `${n} osób`;
}

export function createBot({ store, env }) {
  const serverName = env.SERVER_NAME || 'LumaMC';
  const intents = [GatewayIntentBits.Guilds];
  // GuildMembers (uprzywilejowane) - tylko dla powitan
  if (env.WELCOME_CHANNEL_ID || env.UNVERIFIED_ROLE_ID || env.BOOST_ROLE_ID) intents.push(GatewayIntentBits.GuildMembers);
  // wiadomosci na kanalach (propozycje, legitcheck, antyreklama, boosty)
  intents.push(GatewayIntentBits.GuildMessages);
  // tresc wiadomosci (uprzywilejowane): propozycje + antyreklama (wylaczysz ja: ANTI_INVITE=0)
  const antiInviteOn = !['0', 'off', 'false', 'nie'].includes(String(env.ANTI_INVITE || '').toLowerCase());
  if (env.PROPOSALS_CHANNEL_ID || antiInviteOn || env.IMAGE_CHANNEL_IDS || env.IMAGE_CHANNEL_ID) intents.push(GatewayIntentBits.MessageContent);
  // wiadomosci prywatne (podania na Media) - tresc PV nie wymaga uprzywilejowanego intentu
  intents.push(GatewayIntentBits.DirectMessages);
  const client = new Client({ intents, partials: [Partials.Channel] });
  const adminIds = (env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);

  /** Uprawnienia: lista ADMIN_IDS albo "Zarzadzanie serwerem". */
  function isAdmin(i) {
    if (adminIds.length) return adminIds.includes(i.user.id);
    return i.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;
  }

  const verify = createVerify({ client, env, isAdmin, serverName });
  const tickets = createTickets({ client, env, isAdmin, serverName });
  const legit = createLegit({ store, env, isAdmin, serverName });
  const media = createMedia({ client, store, env, isAdmin, serverName });
  const shop = createShop({ client, env, isAdmin, serverName, tickets });
  const antiInvite = createAntiInvite({ client, env, serverName });
  const boost = createBoost({ client, env, serverName });
  const imageGuard = createImageGuard({ env });
  const giveaway = createGiveaway({ client, store, isAdmin });

  // ================= wiadomosc o licencji =================
  function statusOf(lic) {
    if (lic.revoked) return { text: '🔴 Unieważniona', color: 0xed4245 };
    if (isExpired(lic)) return { text: '🟠 Wygasła', color: 0xf0a020 };
    if (lic.hwid) return { text: '🟢 Aktywowana (przypisana do komputera)', color: 0x57f287 };
    return { text: '🟡 Jeszcze nie użyta', color: 0x5865f2 };
  }

  function buildMessage(lic, { buttons = true } = {}) {
    const st = statusOf(lic);
    const creator = lic.createdById ? `<@${lic.createdById}>` : (lic.createdByTag || '?');
    const embed = new EmbedBuilder()
      .setTitle(`🔑 Licencja ${(MODS[lic.mod || DEFAULT_MOD] || MODS[DEFAULT_MOD]).label}`)
      .setColor(st.color)
      .addFields(
        { name: 'Kupujący', value: `<@${lic.discordId}>`, inline: true },
        { name: 'Utworzył', value: creator, inline: true },
        { name: 'Status', value: st.text },
        { name: 'Kod', value: `\`${lic.key}\`` },
        { name: 'Wygasa', value: expiryText(lic) },
      )
      .setTimestamp(lic.createdAt);

    if (!buttons) return { embeds: [embed] };   // wersja publiczna (w tickecie) - bez przyciskow

    const dead = !!lic.revoked;
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`ext:${lic.key}`).setLabel('Przedłuż licencję')
        .setStyle(ButtonStyle.Success).setDisabled(dead),
      new ButtonBuilder().setCustomId(`hwd:${lic.key}`).setLabel('Resetuj HWID')
        .setStyle(ButtonStyle.Primary).setDisabled(dead || !lic.hwid),
      new ButtonBuilder().setCustomId(`rev:${lic.key}`).setLabel('Unieważnij licencję')
        .setStyle(ButtonStyle.Danger).setDisabled(dead),
    );
    return { embeds: [embed], components: [row] };
  }

  /** Odswieza wiadomosc na kanale licencji (po przedluzeniu / uniewaznieniu / aktywacji). */
  async function refreshMessage(lic) {
    const targets = [
      [lic.channelId, lic.messageId, { buttons: !lic.pub }],   // publiczna (w tickecie); stare licencje zachowuja przyciski
      [lic.adminChannelId, lic.adminMessageId, { buttons: true }], // dla administracji
    ];
    for (const [chId, msgId, opts] of targets) {
      if (!chId || !msgId) continue;
      try {
        const ch = await client.channels.fetch(chId);
        const msg = await ch.messages.fetch(msgId);
        await msg.edit(buildMessage(lic, opts));
      } catch (e) {
        console.error('Nie udalo sie odswiezyc wiadomosci:', e.message);
      }
    }
  }

  // ================= instrukcja =================
  const modDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'mod');

  /** Najnowszy plik .jar z folderu mod/ - dolaczany do instrukcji, zeby gracz mogl go od razu pobrac. */
  function modFile() {
    try {
      const jars = fs.readdirSync(modDir).filter(f => f.toLowerCase().endsWith('.jar'))
        .map(f => ({ f, t: fs.statSync(path.join(modDir, f)).mtimeMs })).sort((a, b) => b.t - a.t);
      return jars.length ? { attachment: path.join(modDir, jars[0].f), name: jars[0].f } : null;
    } catch { return null; }
  }

  /** mine = licencje kupujacego (gdy podane, kod pojawia sie w instrukcji; tylko dla wiadomosci ukrytej). */
  function helpMessage(mine = null) {
    const file = modFile();
    const download = file
      ? `• Plik **\`${file.name}\`** jest **dołączony do tej wiadomości** – kliknij jego nazwę, żeby go pobrać.`
      : (env.MOD_DOWNLOAD_URL ? `• Plik \`autorynek-….jar\` pobierzesz stąd: [kliknij tutaj](${env.MOD_DOWNLOAD_URL}).` : '• Plik moda dostaniesz od administracji.');

    const install = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`📖 Jak zainstalować moda AutoRynek (${serverName})`)
      .setDescription([
        'Mod działa **tylko na wersji Minecrafta 1.21.11** z **Fabric**. Zrób to raz, krok po kroku:',
        '',
        '**Krok 1 – Zainstaluj Fabric**',
        '• Wejdź na https://fabricmc.net/use/installer/ i pobierz instalator (dla Windows: plik `.exe`).',
        '• Uruchom go, jako wersję Minecrafta wybierz **1.21.11** i kliknij **Install**.',
        '• Otwórz Minecraft Launcher, wybierz profil **fabric-loader-1.21.11** i raz uruchom grę. Potem ją zamknij (powstanie folder `mods`).',
        '',
        '**Krok 2 – Pobierz Fabric API**',
        '• Wejdź na https://modrinth.com/mod/fabric-api/versions, wybierz wersję **1.21.11** (Fabric) i kliknij **Download**.',
        '',
        '**Krok 3 – Pobierz moda AutoRynek (wersja 1.21.11)**',
        download,
        '',
        '**Krok 4 – Wrzuć pliki do folderu mods**',
        '• Wciśnij `Windows + R`, wpisz `%appdata%\\.minecraft\\mods` i naciśnij Enter.',
        '• Skopiuj tam **dwa** pliki: `fabric-api-….jar` i `autorynek-….jar`.',
        '',
        '**Krok 5 – Uruchom grę**',
        '• W Minecraft Launcherze wybierz profil **fabric-loader-1.21.11** i kliknij **Graj**.',
        '• Gdy gra się włączy, mod wyświetli okno **„AutoRynek – licencja”** – przejdź do aktywacji.',
      ].join('\n'));

    // Krok 1 - kod: pokazujemy go tylko wlascicielowi (wiadomosc ukryta)
    let codeLines;
    if (mine && mine.length) {
      codeLines = [
        '• Twój kod licencyjny (widzisz go tylko Ty):',
        ...mine.map(l => `\`\`\`${l.key}\`\`\`` + (isExpired(l) ? '*(licencja wygasła)*' : '')),
      ];
    } else if (mine) {
      codeLines = ['• ❌ Nie masz jeszcze żadnej aktywnej licencji. Jeśli ją kupiłeś, napisz do administracji w zgłoszeniu.'];
    } else {
      codeLines = ['• Twój kod licencyjny jest w wiadomości z licencją (pole **Kod**). Możesz też kliknąć **„Sprawdź swoją licencję”** w panelu licencji.'];
    }

    const activate = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle('🔑 Jak wpisać kod licencyjny')
      .setDescription([
        '**Krok 1 – Zdobądź kod**',
        ...codeLines,
        '',
        '**Krok 2 – Skopiuj kod**',
        '• Kod wygląda tak: `XXXX-XXXX-XXXX-XXXX`. Zaznacz go i wciśnij `Ctrl + C`.',
        '',
        '**Krok 3 – Wklej kod w grze**',
        '• W oknie **„AutoRynek – licencja”** kliknij pole **Kod** i wciśnij `Ctrl + V`.',
        '• Kliknij **Aktywuj**.',
        '• Gdy zobaczysz **„Licencja aktywna”** – gotowe! Przy następnych uruchomieniach nie musisz wpisywać kodu ponownie.',
        '• Okno możesz też otworzyć komendą w czacie: `/autorynek licencja XXXX-XXXX-XXXX-XXXX`.',
        '',
        '**⚠️ Ważne**',
        '• Kod działa **tylko na jednym komputerze** – pierwsze użycie przypisuje go do Twojego komputera.',
        '• **Nikomu nie udostępniaj kodu.** Jeśli ktoś użyje go pierwszy, Ty stracisz licencję.',
        '• Zmieniasz komputer? Napisz do administracji, a wystawi nowy kod.',
        '',
        '**Co oznaczają komunikaty?**',
        '• *nieprawidłowy kod* – kod jest błędny, skopiuj go jeszcze raz,',
        '• *kod jest już użyty na innym komputerze* – licencja jest przypisana do innego komputera,',
        '• *licencja wygasła / została unieważniona* – skontaktuj się z administracją,',
        '• *Nie można połączyć z serwerem licencji* – sprawdź internet i spróbuj za chwilę.',
      ].join('\n'));

    const payload = { embeds: [install, activate] };
    if (file) payload.files = [file];
    return payload;
  }

  // ================= panel licencji =================
  function panelMessage() {
    const embed = new EmbedBuilder()
      .setColor(0xf5c542)
      .setTitle(`🔑 PANEL LICENCJI ${serverName.toUpperCase()}`)
      .setDescription('Wybierz moda z listy poniżej, aby sprawdzić swoją licencję (kod widzisz tylko Ty).');
    return { embeds: [embed], components: [modSelectRow()] };
  }

  /** Lista wyboru modow (suwak) - nowe mody dopisujesz w src/mods.js. */
  function modSelectRow() {
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId('panel:modsel').setPlaceholder('Wybierz moda...')
        .addOptions(Object.entries(MODS).map(([value, m]) =>
          new StringSelectMenuOptionBuilder().setLabel(m.label).setDescription(m.desc).setValue(value).setEmoji({ name: m.emoji }))),
    );
  }

  /** Osobny panel (na nowym kanale) z przyciskiem "Jak zainstalowac moda". */
  function installPanelMessage() {
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`📖 INSTALACJA MODA ${serverName.toUpperCase()}`)
      .setDescription('Kliknij przycisk poniżej, aby zobaczyć instrukcję instalacji moda razem z Twoim kodem licencyjnym i plikiem do pobrania.');
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('panel:help').setLabel('Jak zainstalować moda').setEmoji('📖').setStyle(ButtonStyle.Primary),
    );
    return { embeds: [embed], components: [row] };
  }

  /** Licencje kupujacego (kod + data wygasniecia + ostrzezenie) - idzie na PV. */
  function ownerMessage(list) {
    const embeds = list.map(lic => {
      const st = statusOf(lic);
      return new EmbedBuilder()
        .setColor(st.color)
        .setTitle(`🔑 Twoja licencja ${(MODS[lic.mod || DEFAULT_MOD] || MODS[DEFAULT_MOD]).label} (${serverName})`)
        .addFields(
          { name: 'Kod licencyjny', value: `\`\`\`${lic.key}\`\`\`` },
          { name: 'Status', value: st.text },
          { name: 'Wygasa', value: expiryText(lic) },
          { name: '⚠️ Uwaga', value: '**Nikomu nie udostępniaj tego kodu!** Działa tylko na jednym komputerze – jeśli ktoś użyje go pierwszy, stracisz licencję.' },
          { name: 'Jak użyć', value: 'W grze wklej kod w oknie licencji i kliknij **Aktywuj** (albo wpisz `/autorynek licencja KOD`).' },
        );
    });
    return { embeds: embeds.slice(0, 10) };
  }

  async function handleMyLicense(i, modId = DEFAULT_MOD) {
    const mod = MODS[modId];
    if (!mod) return i.reply({ content: '❌ Nieznany mod.', flags: EPHEMERAL });
    const mine = store.byDiscord(i.user.id).filter(l => !l.revoked && (l.mod || DEFAULT_MOD) === modId);
    if (!mine.length) {
      return i.reply({ content: `❌ Nie masz żadnej aktywnej licencji na moda **${mod.label}**. Jeśli ją kupiłeś, napisz do administracji.`, flags: EPHEMERAL });
    }
    const payload = ownerMessage(mine);
    try {
      await i.user.send(payload);
      return i.reply({ content: '📩 Wysłałem Ci licencję w wiadomości prywatnej.', flags: EPHEMERAL });
    } catch {
      return i.reply({
        content: '⚠️ Nie mogę wysłać wiadomości prywatnej (masz je zablokowane). Twoja licencja poniżej – widzisz ją tylko Ty:',
        ...payload, flags: EPHEMERAL,
      });
    }
  }

  // ================= propozycje =================
  function voteRow(sug) {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('vote:up').setLabel(`Jestem za! (${osob(sug.up.length)})`).setEmoji('👍').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('vote:down').setLabel(`Jestem przeciw! (${osob(sug.down.length)})`).setEmoji('👎').setStyle(ButtonStyle.Danger),
    );
  }

  async function handleVote(i, dir) {
    const sug = store.getSuggestion(i.message.id) || { up: [], down: [] };
    const uid = i.user.id;
    const wasUp = sug.up.includes(uid), wasDown = sug.down.includes(uid);
    sug.up = sug.up.filter(x => x !== uid);
    sug.down = sug.down.filter(x => x !== uid);
    if (dir === 'up' && !wasUp) sug.up.push(uid);      // drugie klikniecie = cofniecie glosu
    if (dir === 'down' && !wasDown) sug.down.push(uid);
    store.putSuggestion(i.message.id, sug);
    return i.update({ components: [voteRow(sug)] });
  }

  /** Zamienia zwykla wiadomosc gracza na kanale propozycji w ladny embed z glosowaniem i watkiem. */
  async function convertToSuggestion(message) {
    const tresc = (message.content || '').trim();
    const img = message.attachments.find(a => (a.contentType || '').startsWith('image/'));
    if (!tresc && !img) return;

    const embed = new EmbedBuilder()
      .setColor(0x2b2d31)
      .setTitle('Nowa propozycja')
      .addFields({ name: 'Autor propozycji:', value: `<@${message.author.id}>` })
      .setThumbnail(message.author.displayAvatarURL({ size: 256 }));
    const text = tresc || '(bez tekstu)';
    if (text.length <= 1024) embed.addFields({ name: 'Treść propozycji:', value: text });
    else embed.addFields({ name: 'Treść propozycji:', value: text.slice(0, 1021) + '...' });

    const payload = { embeds: [embed] };
    if (img) {
      // zalacznik wgrywamy ponownie, bo po usunieciu oryginalu jego link przestaje dzialac
      const name = (img.name || 'obraz.png').replace(/[^A-Za-z0-9._-]/g, '_');
      payload.files = [{ attachment: img.url, name }];
      embed.setImage(`attachment://${name}`);
    } else if (env.BANNER_URL) {
      embed.setImage(env.BANNER_URL);
    }

    const sug = { up: [], down: [] };
    payload.components = [voteRow(sug)];

    let msg;
    try {
      msg = await message.channel.send(payload);
    } catch (e) {
      console.error('Nie udalo sie wyslac propozycji:', e.message);
      return; // oryginalu nie kasujemy, zeby tresc nie przepadla
    }
    store.putSuggestion(msg.id, sug);
    try { await message.delete(); } catch (e) { console.error('Nie udalo sie usunac wiadomosci (brak "Zarzadzanie wiadomosciami"?):', e.message); }
    try {
      await msg.startThread({ name: `Dyskusja: ${tresc || 'propozycja'}`.replace(/\s+/g, ' ').slice(0, 90), autoArchiveDuration: 1440 });
    } catch (e) { console.error('Nie udalo sie utworzyc watku:', e.message); }
  }

  client.on(Events.MessageCreate, async message => {
    if (await boost.onMessage(message).catch(e => (console.error('Boost:', e), false))) return;
    if (await antiInvite.onMessage(message).catch(e => (console.error('Antyreklama:', e), false))) return;
    if (await imageGuard.check(message).catch(e => (console.error('Blokada zdjec:', e), false))) return;
    legit.onMessage(message);
    media.onMessage(message).catch(e => console.error('Media (PV):', e));
    if (!env.PROPOSALS_CHANNEL_ID || message.channelId !== env.PROPOSALS_CHANNEL_ID) return;
    if (message.author.bot || message.system) return;
    try { await convertToSuggestion(message); } catch (e) { console.error(e); }
  });

  // ================= komendy =================
  const licencjaCmd = new SlashCommandBuilder()
    .setName('licencja')
    .setDescription('Tworzy jednorazowy kod licencyjny do moda')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption(o => o.setName('discord').setDescription('Użytkownik Discorda, który kupuje licencję').setRequired(true))
    .addStringOption(o => o.setName('jednostka').setDescription('Na jak długo').setRequired(true).addChoices(
      { name: 'Sekundy', value: 's' },
      { name: 'Minuty', value: 'm' },
      { name: 'Godziny', value: 'h' },
      { name: 'Dni', value: 'd' },
      { name: 'Permanentna (bez końca)', value: 'perm' },
    ))
    .addIntegerOption(o => o.setName('ilosc').setDescription('Ile sekund/minut/godzin/dni (pomiń przy permanentnej)')
      .setMinValue(1).setMaxValue(3650 * 86400))
    .addStringOption(o => o.setName('mod').setDescription('Którego moda dotyczy licencja (domyślnie AutoRynek)')
      .addChoices(...Object.entries(MODS).map(([value, m]) => ({ name: m.label, value }))));

  const panelCmd = new SlashCommandBuilder()
    .setName('panel').setDescription('Wysyła na kanał panel licencji (przyciski dla graczy)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

  const instalacjaCmd = new SlashCommandBuilder()
    .setName('instalacja').setDescription('Wysyła na kanał panel z przyciskiem „Jak zainstalować moda”')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

  async function handleCreate(i) {
    if (!isAdmin(i)) return i.reply({ content: '❌ Nie masz uprawnień.', flags: EPHEMERAL });

    const user = i.options.getUser('discord', true);
    const unit = i.options.getString('jednostka', true);
    const amount = i.options.getInteger('ilosc');
    const modId = i.options.getString('mod') || DEFAULT_MOD;

    const dur = parseDuration(unit, amount);
    if (!dur) {
      return i.reply({
        content: '❌ Podaj poprawną **ilość** (np. 7 dni). Przy „Permanentna” ilość nie jest potrzebna. Maks. 3650 dni.',
        flags: EPHEMERAL,
      });
    }

    // wiadomosc publiczna - na kanale, na ktorym uzyto komendy (np. w tickecie); widza ja wszyscy z dostepem do kanalu
    const channel = i.channel;
    if (!channel) return i.reply({ content: '❌ Nie widzę tego kanału. Sprawdź uprawnienia bota.', flags: EPHEMERAL });

    let key;
    do { key = genKey(); } while (store.has(key));
    const now = Date.now();
    const lic = {
      key, discordId: user.id, mod: modId,
      createdAt: now,
      expiresAt: dur.perm ? null : now + dur.ms,
      hwid: null, activatedAt: null, lastSeen: null,
      revoked: false,
      createdById: i.user.id,
      createdByTag: i.user.tag ?? i.user.username,
      channelId: channel.id, messageId: null, pub: true,
      adminChannelId: null, adminMessageId: null,
    };

    try {
      const msg = await channel.send(buildMessage(lic, { buttons: false }));
      lic.messageId = msg.id;
    } catch (e) {
      return i.reply({ content: `❌ Nie mogę wysłać wiadomości na ten kanał: ${e.message}`, flags: EPHEMERAL });
    }

    // opcjonalnie: kopia dla administracji z przyciskami Przedluz / Uniewaznij (gdy ustawiono LICENSE_CHANNEL_ID)
    let adminNote = '';
    if (env.LICENSE_CHANNEL_ID && env.LICENSE_CHANNEL_ID !== channel.id) {
      try {
        const ach = await client.channels.fetch(env.LICENSE_CHANNEL_ID);
        const amsg = await ach.send(buildMessage(lic, { buttons: true }));
        lic.adminChannelId = ach.id; lic.adminMessageId = amsg.id;
        adminNote = `\nKopia z przyciskami dla administracji: <#${ach.id}>.`;
      } catch (e) {
        adminNote = `\n⚠️ Nie udało się wysłać kopii na kanał administracji: ${e.message}`;
      }
    }
    store.put(lic);

    // zaraz pod licencja: plik z modem + instrukcja jak go pobrac i zainstalowac
    try { await channel.send(helpMessage()); }
    catch (e) { adminNote += `\n⚠️ Nie udało się wysłać instrukcji z plikiem moda: ${e.message}`; }

    return i.reply({
      content: `✅ Licencja utworzona dla <@${user.id}> (wiadomość jest powyżej).\n**Kod:** \`${key}\` (widzisz go tylko Ty)\n`
        + `Instrukcja i plik moda zostały wysłane pod licencją.${adminNote}`,
      flags: EPHEMERAL,
    });
  }

  // ================= reset HWID =================
  /** Odpina licencje od komputera; stary komputer zostaje zablokowany dla tego kodu. Zwraca tekst bledu albo null. */
  function resetHwid(lic) {
    if (lic.revoked) return 'Licencja jest unieważniona.';
    if (!lic.hwid) return 'Ta licencja nie jest jeszcze przypisana do żadnego komputera (nie ma czego resetować).';
    const banned = new Set(lic.bannedHwids || []);
    banned.add(lic.hwid);
    lic.bannedHwids = [...banned].slice(-10);
    lic.hwid = null;
    lic.activatedAt = null;
    lic.hwidResets = (lic.hwidResets || 0) + 1;
    lic.lastHwidReset = Date.now();
    store.put(lic);
    return null;
  }

  const resetCmd = new SlashCommandBuilder()
    .setName('resethwid').setDescription('Resetuje HWID licencji - kod można wtedy użyć na innym komputerze')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o => o.setName('kod').setDescription('Kod licencji XXXX-XXXX-XXXX-XXXX').setRequired(true).setMaxLength(19));

  async function handleResetCmd(i) {
    if (!isAdmin(i)) return i.reply({ content: '❌ Nie masz uprawnień.', flags: EPHEMERAL });
    const key = i.options.getString('kod', true).trim().toUpperCase();
    const lic = store.get(key);
    if (!lic) return i.reply({ content: '❌ Nie ma takiej licencji w bazie.', flags: EPHEMERAL });
    const err = resetHwid(lic);
    if (err) return i.reply({ content: `❌ ${err}`, flags: EPHEMERAL });
    await refreshMessage(lic);
    return i.reply({
      content: `🔄 Zresetowano HWID licencji \`${key}\` (kupujący: <@${lic.discordId}>).\n`
        + 'Stary komputer przestanie działać z tym kodem (mod sprawdza licencję co jakiś czas), a kod można aktywować na nowym komputerze.',
      flags: EPHEMERAL,
    });
  }

  // ================= przedluzanie wszystkich aktywnych licencji =================
  const extAllCmd = new SlashCommandBuilder()
    .setName('przedluz_wszystkie').setDescription('Przedłuża KAŻDĄ aktywną licencję o podaną liczbę dni')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addIntegerOption(o => o.setName('dni').setDescription('O ile dni przedłużyć').setRequired(true).setMinValue(1).setMaxValue(3650))
    .addStringOption(o => o.setName('mod').setDescription('Tylko licencje tego moda (domyślnie: wszystkie mody)')
      .addChoices(...Object.entries(MODS).map(([value, m]) => ({ name: m.label, value }))));

  /** Aktywna = nie uniewazniona i nie wygasla. Permanentne pomijamy (nie ma czego przedluzac). */
  function extAllScan(modId) {
    const all = Object.values(store.data.licenses).filter(l => !modId || (l.mod || DEFAULT_MOD) === modId);
    return {
      todo: all.filter(l => !l.revoked && l.expiresAt != null && !isExpired(l)),
      perm: all.filter(l => !l.revoked && l.expiresAt == null).length,
      dead: all.filter(l => l.revoked || (l.expiresAt != null && isExpired(l))).length,
    };
  }

  async function handleExtAllCmd(i) {
    if (!isAdmin(i)) return i.reply({ content: '❌ Nie masz uprawnień.', flags: EPHEMERAL });
    const days = i.options.getInteger('dni', true);
    const modId = i.options.getString('mod') || '';
    const { todo, perm, dead } = extAllScan(modId);
    if (!todo.length) {
      return i.reply({ content: `ℹ️ Brak aktywnych licencji do przedłużenia (permanentne: ${perm}, wygasłe/unieważnione: ${dead}).`, flags: EPHEMERAL });
    }
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`extall:ok:${days}:${modId || '-'}`).setLabel(`Przedłuż ${todo.length} licencji o ${days} dni`).setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('extall:no:0:-').setLabel('Anuluj').setStyle(ButtonStyle.Secondary),
    );
    return i.reply({
      content: `⚠️ **Potwierdź akcję masową**\nZostanie przedłużonych **${todo.length}** aktywnych licencji o **${days} dni**.\n`
        + `Pomijam: permanentne (${perm}) oraz wygasłe/unieważnione (${dead}).`,
      components: [row], flags: EPHEMERAL,
    });
  }

  async function handleExtAllButton(i) {
    const [, decision, daysStr, modArg] = i.customId.split(':');
    if (decision !== 'ok') return i.update({ content: '🚫 Anulowano – nic nie zmieniono.', components: [] });
    const days = parseInt(daysStr, 10);
    const { todo } = extAllScan(modArg === '-' ? '' : modArg);   // liczymy ponownie - stan mogl sie zmienic
    if (!Number.isInteger(days) || days < 1 || !todo.length) return i.update({ content: 'ℹ️ Nie ma już czego przedłużać.', components: [] });

    const add = days * 86_400_000;
    for (const lic of todo) lic.expiresAt += add;
    store.save();   // jeden zapis dla wszystkich licencji
    await i.update({ content: `🟢 Przedłużono **${todo.length}** aktywnych licencji o **${days} dni**. Wiadomości z licencjami odświeżą się w tle.`, components: [] });

    (async () => { for (const lic of todo) { await refreshMessage(lic); await new Promise(r => setTimeout(r, 400)); } })()
      .catch(e => console.error('Przedluz wszystkie - odswiezanie:', e.message));
  }

  // ================= przyciski =================
  async function handleButton(i) {
    const [action, arg] = i.customId.split(':');

    if (action === 'panel') {
      if (arg === 'lic') {   // stary panel z przyciskiem - pokazujemy liste wyboru modow
        return i.reply({ content: 'Wybierz moda, którego licencję chcesz sprawdzić:', components: [modSelectRow()], flags: EPHEMERAL });
      }
      const mine = store.byDiscord(i.user.id).filter(l => !l.revoked);
      return i.reply({ ...helpMessage(mine), flags: EPHEMERAL });
    }
    if (action === 'verify') return verify.handleButton(i);
    if (action === 'ticket') return tickets.handleButton(i);
    if (action === 'media') return media.handleButton(i);
    if (action === 'shop') return shop.handleButton(i);
    if (action === 'gw') return giveaway.handleButton(i);
    if (action === 'vote') return handleVote(i, arg);

    // ponizej: tylko administracja
    if (!isAdmin(i)) return i.reply({ content: '❌ Nie masz uprawnień.', flags: EPHEMERAL });
    if (action === 'extall') return handleExtAllButton(i);
    const key = arg;
    const lic = store.get(key);
    if (!lic) return i.reply({ content: '❌ Nie ma takiej licencji w bazie.', flags: EPHEMERAL });

    if (action === 'hwd') {
      const err = resetHwid(lic);
      if (err) return i.reply({ content: `❌ ${err}`, flags: EPHEMERAL });
      await i.update(buildMessage(lic));
      return i.followUp({ content: `🔄 Zresetowano HWID licencji \`${key}\`. Stary komputer jest zablokowany, kod można aktywować na nowym.`, flags: EPHEMERAL });
    }

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
      if (i.isChatInputCommand()) {
        if (i.commandName === 'weryfikacja') await verify.handleCommand(i);
        else if (i.commandName === 'zgloszenia') await tickets.handleCommand(i);
        else if (i.commandName === 'licznik') await legit.handleCommand(i);
        else if (i.commandName === 'media' || i.commandName === 'reset') await media.handleCommand(i);
        else if (i.commandName === 'konkurs' || i.commandName === 'konkurs_wylacz' || i.commandName === 'roll') await giveaway.handleCommand(i);
        else if (i.commandName === 'cennik') await shop.handleCommand(i);
        else if (i.commandName === 'resethwid') await handleResetCmd(i);
        else if (i.commandName === 'przedluz_wszystkie') await handleExtAllCmd(i);
        else if (i.commandName === 'licencja') await handleCreate(i);
        else if (i.commandName === 'panel') {
          if (!isAdmin(i)) return i.reply({ content: '❌ Nie masz uprawnień.', flags: EPHEMERAL });
          await sendPanel(i, panelMessage());
        } else if (i.commandName === 'instalacja') {
          if (!isAdmin(i)) return i.reply({ content: '❌ Nie masz uprawnień.', flags: EPHEMERAL });
          await sendPanel(i, installPanelMessage());
        }
      } else if (i.isButton()) await handleButton(i);
      else if (i.isStringSelectMenu()) {
        if (i.customId === 'ticket:select') await tickets.handleSelect(i);
        else if (i.customId === 'shop:select') await shop.handleSelect(i);
        else if (i.customId === 'panel:modsel') {
          await handleMyLicense(i, i.values[0]);
          i.message.edit({ components: [modSelectRow()] }).catch(() => {});   // zerujemy zaznaczenie na panelu
        }
      }
      else if (i.isModalSubmit()) {
        if (i.customId === 'verify:modal') await verify.handleModal(i);
        else if (i.customId.startsWith('mediarej:')) await media.handleModal(i);
        else await handleModal(i);
      }
    } catch (e) {
      console.error(e);
      try {
        const msg = { content: '❌ Wystąpił błąd.' + (isAdmin(i) ? `\n\`${String(e.message).slice(0, 300)}\`` : ''), flags: EPHEMERAL };
        if (i.replied || i.deferred) await i.followUp(msg); else await i.reply(msg);
      } catch { /* ignoruj */ }
    }
  });

  // ================= powitania =================
  /** Obrazek powitania: assets/welcome.* albo (domyslnie) grafika kota assets/kot.* - wysylane jako zalacznik, wiec nie wygasa. */
  const welcomeImage = () => findAsset('welcome', 'kot');

  client.on(Events.GuildMemberAdd, async member => {
    if (!env.WELCOME_CHANNEL_ID) return;
    try {
      const ch = await client.channels.fetch(env.WELCOME_CHANNEL_ID);
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`Witaj w ${serverName}!`)
        .setDescription([
          `Witaj ${member}!`,
          '',
          `Właśnie dołączyłeś na oficjalny serwer Discord **${serverName}**.`,
          'Mamy nadzieję, że zostaniesz z nami na dłużej!',
          '',
          `Aktualna liczba członków: **${member.guild.memberCount}**`,
        ].join('\n'))
        .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
        .setFooter({ text: `Witaj w ${serverName}!` });
      const img = welcomeImage();
      const payload = { embeds: [embed] };
      if (img) { embed.setImage(`attachment://${img.name}`); payload.files = [img]; }
      else if (env.WELCOME_IMAGE_URL) embed.setImage(env.WELCOME_IMAGE_URL);
      await ch.send(payload);
    } catch (e) { console.error('Powitanie nie wyszlo:', e.message); }
  });

  client.on(Events.MessageUpdate, async (_old, message) => {
    try {
      if (message.partial) message = await message.fetch();
      await imageGuard.check(message);
    } catch { /* wiadomosc juz usunieta albo brak dostepu */ }
  });

  client.on(Events.GuildMemberUpdate, (_old, member) => { boost.syncMember(member).catch(() => {}); });

  client.once(Events.ClientReady, async c => {
    console.log(`Bot zalogowany jako ${c.user.tag}`);
    giveaway.start();
    if (boost.roleId && env.GUILD_ID) c.guilds.fetch(env.GUILD_ID).then(g => boost.syncAll(g)).catch(() => {});
    const cmds = [licencjaCmd, panelCmd, instalacjaCmd, resetCmd, extAllCmd, ...shop.commands, ...verify.commands, ...tickets.commands, ...legit.commands, ...media.commands, ...giveaway.commands].map(x => x.toJSON());
    try {
      if (env.GUILD_ID) {
        const guild = await c.guilds.fetch(env.GUILD_ID);
        await guild.commands.set(cmds);   // od razu widoczne
      } else {
        await c.application.commands.set(cmds); // globalnie (do godziny)
      }
      console.log('Komendy zarejestrowane:', cmds.map(c => '/' + c.name).join(' '));
    } catch (e) { console.error('Rejestracja komend nie powiodla sie:', e.message); }
  });

  return { client, refreshMessage };
}
