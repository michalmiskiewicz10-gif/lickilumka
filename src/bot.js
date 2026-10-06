import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, Client, EmbedBuilder, Events, GatewayIntentBits,
  MessageFlags, ModalBuilder, PermissionFlagsBits, SlashCommandBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { genKey, parseDuration, parseText, isExpired, expiryText } from './util.js';
import { createVerify } from './verify.js';
import { createTickets } from './tickets.js';
import { createLegit } from './legit.js';

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
  if (env.WELCOME_CHANNEL_ID || env.UNVERIFIED_ROLE_ID) intents.push(GatewayIntentBits.GuildMembers);
  // wiadomosci na kanalach propozycji / legitchecka
  if (env.PROPOSALS_CHANNEL_ID || env.LEGITCHECK_CHANNEL_ID) intents.push(GatewayIntentBits.GuildMessages);
  // tresc wiadomosci (uprzywilejowane) jest potrzebna tylko do propozycji
  if (env.PROPOSALS_CHANNEL_ID) intents.push(GatewayIntentBits.MessageContent);
  const client = new Client({ intents });
  const adminIds = (env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);

  /** Uprawnienia: lista ADMIN_IDS albo "Zarzadzanie serwerem". */
  function isAdmin(i) {
    if (adminIds.length) return adminIds.includes(i.user.id);
    return i.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;
  }

  const verify = createVerify({ client, env, isAdmin, serverName });
  const tickets = createTickets({ client, env, isAdmin, serverName });
  const legit = createLegit({ store, env, isAdmin, serverName });

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
      .setTitle('🔑 Licencja AutoRynek')
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
      .setDescription('Kliknij przycisk poniżej, aby sprawdzić swoją licencję (kod widzisz tylko Ty).');
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('panel:lic').setLabel('Sprawdź swoją licencję').setEmoji('🔑').setStyle(ButtonStyle.Secondary),
    );
    return { embeds: [embed], components: [row] };
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
        .setTitle(`🔑 Twoja licencja AutoRynek (${serverName})`)
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

  async function handleMyLicense(i) {
    const mine = store.byDiscord(i.user.id).filter(l => !l.revoked);
    if (!mine.length) {
      return i.reply({ content: '❌ Nie masz żadnej aktywnej licencji. Jeśli ją kupiłeś, napisz do administracji.', flags: EPHEMERAL });
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
    legit.onMessage(message);
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
      .setMinValue(1).setMaxValue(3650 * 86400));

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
      key, discordId: user.id,
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

  // ================= przyciski =================
  async function handleButton(i) {
    const [action, arg] = i.customId.split(':');

    if (action === 'panel') {
      if (arg === 'lic') return handleMyLicense(i);
      const mine = store.byDiscord(i.user.id).filter(l => !l.revoked);
      return i.reply({ ...helpMessage(mine), flags: EPHEMERAL });
    }
    if (action === 'verify') return verify.handleButton(i);
    if (action === 'ticket') return tickets.handleButton(i);
    if (action === 'vote') return handleVote(i, arg);

    // ponizej: tylko administracja
    if (!isAdmin(i)) return i.reply({ content: '❌ Nie masz uprawnień.', flags: EPHEMERAL });
    const key = arg;
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
      if (i.isChatInputCommand()) {
        if (i.commandName === 'weryfikacja') await verify.handleCommand(i);
        else if (i.commandName === 'zgloszenia') await tickets.handleCommand(i);
        else if (i.commandName === 'licznik') await legit.handleCommand(i);
        else if (i.commandName === 'licencja') await handleCreate(i);
        else if (i.commandName === 'panel') {
          if (!isAdmin(i)) return i.reply({ content: '❌ Nie masz uprawnień.', flags: EPHEMERAL });
          await i.reply(panelMessage());
        } else if (i.commandName === 'instalacja') {
          if (!isAdmin(i)) return i.reply({ content: '❌ Nie masz uprawnień.', flags: EPHEMERAL });
          await i.reply(installPanelMessage());
        }
      } else if (i.isButton()) await handleButton(i);
      else if (i.isStringSelectMenu()) { if (i.customId === 'ticket:select') await tickets.handleSelect(i); }
      else if (i.isModalSubmit()) {
        if (i.customId === 'verify:modal') await verify.handleModal(i);
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
  /** Obrazek powitania: plik assets/welcome.(gif|png|jpg|jpeg|webp) ma pierwszenstwo przed WELCOME_IMAGE_URL (linki z Discorda wygasaja). */
  function welcomeImage() {
    const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets');
    for (const ext of ['gif', 'png', 'jpg', 'jpeg', 'webp']) {
      const f = path.join(dir, `welcome.${ext}`);
      if (fs.existsSync(f)) return { attachment: f, name: `welcome.${ext}` };
    }
    return null;
  }

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

  client.once(Events.ClientReady, async c => {
    console.log(`Bot zalogowany jako ${c.user.tag}`);
    const cmds = [licencjaCmd, panelCmd, instalacjaCmd, ...verify.commands, ...tickets.commands, ...legit.commands].map(x => x.toJSON());
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
