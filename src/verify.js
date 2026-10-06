import crypto from 'node:crypto';
import {
  ActionRowBuilder, AuditLogEvent, ButtonBuilder, ButtonStyle, EmbedBuilder, Events, MessageFlags,
  ModalBuilder, PermissionFlagsBits, SlashCommandBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';

const EPHEMERAL = MessageFlags.Ephemeral;
const API = 'https://discord.com/api/v10';
const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Weryfikacja:
 *  1) klik w przycisk -> okienko z prostym dzialaniem (dodawanie/odejmowanie, liczby do 10),
 *  2) poprawna odpowiedz -> uzytkownik musi ZAAKCEPTOWAC aplikacje (OAuth2, scope guilds.join),
 *  3) po akceptacji dostaje role, a bot zapamietuje token i dodaje go z powrotem, gdy wyjdzie z serwera.
 * Gdy nie ustawiono CLIENT_SECRET / PUBLIC_URL, weryfikacja dziala bez kroku 2 (sama rola).
 */
export function createVerify({ client, store, env, isAdmin, serverName }) {
  const roleId = env.VERIFIED_ROLE_ID;
  const unverifiedId = env.UNVERIFIED_ROLE_ID;
  const oauthOn = !!(env.CLIENT_SECRET && env.PUBLIC_URL);
  const redirectUri = oauthOn ? env.PUBLIC_URL.replace(/\/+$/, '') + '/oauth/callback' : null;
  const clientId = () => env.CLIENT_ID || client.application?.id || client.user?.id;

  const pending = new Map(); // userId -> { answer, exp }
  const states = new Map();  // state -> { userId, exp }
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of pending) if (v.exp < now) pending.delete(k);
    for (const [k, v] of states) if (v.exp < now) states.delete(k);
  }, 60_000).unref();

  // ---------- dzialanie do 10 ----------
  function makeQuestion() {
    if (crypto.randomInt(2) === 0) {
      const a = crypto.randomInt(1, 10);          // 1..9
      const b = crypto.randomInt(1, 11 - a);      // suma <= 10
      return { text: `${a} + ${b}`, answer: a + b };
    }
    const a = crypto.randomInt(2, 11);            // 2..10
    const b = crypto.randomInt(1, a);             // wynik >= 1
    return { text: `${a} - ${b}`, answer: a - b };
  }

  // ---------- panel ----------
  const verifyCmd = new SlashCommandBuilder()
    .setName('weryfikacja').setDescription('Wysyła na kanał panel weryfikacji')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

  const restoreCmd = new SlashCommandBuilder()
    .setName('przywroc').setDescription('Dodaje z powrotem na serwer zweryfikowanych, którzy go opuścili')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

  function panelMessage() {
    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle('✅ Weryfikacja')
      .setDescription([
        `Witaj na serwerze **${serverName}**!`,
        'Kliknij przycisk poniżej, rozwiąż proste działanie' + (oauthOn ? ' i zaakceptuj aplikację' : '') + ', aby uzyskać dostęp do serwera.',
      ].join('\n'));
    if (env.BANNER_URL) embed.setImage(env.BANNER_URL);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('verify:start').setLabel('Weryfikacja').setEmoji('✅').setStyle(ButtonStyle.Success),
    );
    return { embeds: [embed], components: [row] };
  }

  // ---------- rola ----------
  async function grantRole(userId) {
    const guild = await client.guilds.fetch(env.GUILD_ID);
    const member = await guild.members.fetch(userId);
    await member.roles.add(roleId);
    if (unverifiedId) await member.roles.remove(unverifiedId).catch(() => {});
  }

  // ---------- klik w przycisk -> okienko ----------
  async function handleButton(i) {
    if (!roleId) return i.reply({ content: '❌ Weryfikacja nie jest skonfigurowana (brak `VERIFIED_ROLE_ID`).', flags: EPHEMERAL });
    if (i.member?.roles?.cache?.has(roleId)) {
      return i.reply({ content: '✅ Jesteś już zweryfikowany.', flags: EPHEMERAL });
    }
    const q = makeQuestion();
    pending.set(i.user.id, { answer: String(q.answer), exp: Date.now() + 5 * 60_000 });
    const modal = new ModalBuilder().setCustomId('verify:modal').setTitle('Weryfikacja').addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('odp').setLabel(`Ile to jest ${q.text} ?`)
          .setStyle(TextInputStyle.Short).setPlaceholder('Wpisz wynik (liczba)').setRequired(true).setMaxLength(3),
      ),
    );
    return i.showModal(modal);
  }

  // ---------- odpowiedz z okienka ----------
  async function handleModal(i) {
    const p = pending.get(i.user.id);
    if (!p || p.exp < Date.now()) {
      return i.reply({ content: '⌛ Czas minął. Kliknij **Weryfikacja** jeszcze raz.', flags: EPHEMERAL });
    }
    pending.delete(i.user.id); // kazda proba = nowe dzialanie
    const ans = i.fields.getTextInputValue('odp').trim();
    if (ans !== p.answer) {
      return i.reply({ content: '❌ Zła odpowiedź. Kliknij **Weryfikacja** jeszcze raz – dostaniesz nowe działanie.', flags: EPHEMERAL });
    }

    if (!oauthOn) {
      try { await grantRole(i.user.id); }
      catch (e) {
        console.error('Nadanie roli nie wyszlo:', e.message);
        return i.reply({ content: '❌ Nie udało się nadać roli (sprawdź uprawnienia bota i pozycję jego roli).', flags: EPHEMERAL });
      }
      return i.reply({ content: '✅ Weryfikacja zakończona – witamy!', flags: EPHEMERAL });
    }

    const state = crypto.randomBytes(24).toString('hex');
    states.set(state, { userId: i.user.id, exp: Date.now() + 10 * 60_000 });
    const url = 'https://discord.com/oauth2/authorize?' + new URLSearchParams({
      client_id: clientId(), response_type: 'code', redirect_uri: redirectUri,
      scope: 'identify guilds.join', state, prompt: 'consent',
    });
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('🔐 Ostatni krok – zaakceptuj aplikację')
      .setDescription([
        '✅ Dobra odpowiedź! Aby dokończyć weryfikację, kliknij przycisk poniżej i **zaakceptuj** aplikację na Discordzie.',
        '',
        '**Co to oznacza?**',
        `• Jeśli kiedyś opuścisz serwer **${serverName}**, bot automatycznie doda Cię z powrotem.`,
        '• Bot widzi tylko Twoją nazwę użytkownika i może dodać Cię na serwer – nic więcej.',
        '• Zgodę możesz cofnąć w każdej chwili: Ustawienia użytkownika → **Autoryzowane aplikacje**.',
        '',
        'Link działa 10 minut.',
      ].join('\n'));
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel('Zaakceptuj i zweryfikuj się').setStyle(ButtonStyle.Link).setURL(url),
    );
    return i.reply({ embeds: [embed], components: [row], flags: EPHEMERAL });
  }

  // ---------- OAuth2 ----------
  async function tokenRequest(params) {
    const r = await fetch(`${API}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId(), client_secret: env.CLIENT_SECRET, ...params }),
    });
    if (!r.ok) { const e = new Error(`token ${r.status}`); e.status = r.status; throw e; }
    return r.json();
  }

  const page = (ok, title, text) => ({
    status: ok ? 200 : 400,
    html: `<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
      + `<title>${title}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#1e1f22;color:#f2f3f5;font-family:system-ui,sans-serif}`
      + `.c{max-width:420px;padding:32px;text-align:center;background:#2b2d31;border-radius:12px}h1{margin:0 0 12px;font-size:24px}p{color:#b5bac1;line-height:1.5}</style></head>`
      + `<body><div class="c"><h1>${ok ? '✅' : '❌'} ${title}</h1><p>${text}</p></div></body></html>`,
  });

  /** Wywolywane przez API (GET /oauth/callback). Zwraca { status, html }. */
  async function oauthCallback({ code, state, error }) {
    if (!oauthOn) return page(false, 'Błąd', 'Weryfikacja przez OAuth nie jest włączona.');
    const s = states.get(state);
    if (!s || s.exp < Date.now()) return page(false, 'Link wygasł', 'Wróć na Discorda i kliknij <b>Weryfikacja</b> jeszcze raz.');
    states.delete(state);
    if (error || !code) return page(false, 'Nie zaakceptowano', 'Aby się zweryfikować, musisz zaakceptować aplikację. Wróć na Discorda i spróbuj ponownie.');

    try {
      const t = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri });
      if (!String(t.scope || '').split(' ').includes('guilds.join')) {
        return page(false, 'Brak zgody', 'Nie przyznano wymaganego uprawnienia. Spróbuj ponownie.');
      }
      const me = await fetch(`${API}/users/@me`, { headers: { Authorization: `Bearer ${t.access_token}` } });
      const user = await me.json();
      if (!me.ok || user.id !== s.userId) {
        return page(false, 'To nie Twój link', 'Zalogowano na inne konto Discorda niż to, które klikało przycisk. Spróbuj ponownie na właściwym koncie.');
      }
      store.putUser(user.id, {
        username: user.username,
        accessToken: t.access_token, refreshToken: t.refresh_token,
        expiresAt: Date.now() + t.expires_in * 1000, verifiedAt: Date.now(),
      });
      await grantRole(user.id);
      return page(true, 'Zweryfikowano!', 'Możesz wrócić na Discorda – masz już dostęp do serwera.');
    } catch (e) {
      console.error('OAuth callback:', e.message);
      return page(false, 'Błąd', 'Coś poszło nie tak. Spróbuj ponownie za chwilę.');
    }
  }

  // ---------- ponowne dodanie na serwer ----------
  async function rejoin(userId, guild) {
    const u = store.getUser(userId);
    if (!u) return 'brak zgody';
    try {
      if (Date.now() > u.expiresAt - 60_000) {
        const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: u.refreshToken });
        u.accessToken = t.access_token;
        u.refreshToken = t.refresh_token || u.refreshToken;
        u.expiresAt = Date.now() + t.expires_in * 1000;
        store.putUser(userId, u);
      }
      await guild.members.add(userId, { accessToken: u.accessToken, roles: roleId ? [roleId] : undefined });
      return 'ok';
    } catch (e) {
      // cofnieta zgoda / wygasly token -> zapominamy uzytkownika
      if (e.status === 400 || e.status === 401 || e.code === 50025) store.delUser(userId);
      return e.message;
    }
  }

  client.on(Events.GuildMemberRemove, async member => {
    if (!oauthOn || member.user?.bot) return;
    if (env.GUILD_ID && member.guild.id !== env.GUILD_ID) return;
    if (!store.getUser(member.id)) return;
    try {
      await sleep(5000);
      // nie dodajemy z powrotem osob wyrzuconych (kick) - wymaga uprawnienia "Wyswietlanie dziennika zdarzen"
      try {
        const logs = await member.guild.fetchAuditLogs({ limit: 5, type: AuditLogEvent.MemberKick });
        if (logs.entries.some(e => e.targetId === member.id && Date.now() - e.createdTimestamp < 20_000)) return;
      } catch { /* brak uprawnien do dziennika - jedziemy dalej */ }
      const r = await rejoin(member.id, member.guild);
      console.log(`[weryfikacja] ponowne dodanie ${member.id}: ${r}`);
    } catch (e) { console.error('Ponowne dodanie nie wyszlo:', e.message); }
  });

  async function handleRestore(i) {
    if (!isAdmin(i)) return i.reply({ content: '❌ Nie masz uprawnień.', flags: EPHEMERAL });
    if (!oauthOn) return i.reply({ content: '❌ OAuth nie jest skonfigurowany (`CLIENT_SECRET`, `PUBLIC_URL`).', flags: EPHEMERAL });
    await i.deferReply({ flags: EPHEMERAL });
    const guild = i.guild;
    let ok = 0, fail = 0, already = 0;
    for (const u of store.allUsers()) {
      const here = await guild.members.fetch(u.id).catch(() => null);
      if (here) { already++; continue; }
      const r = await rejoin(u.id, guild);
      if (r === 'ok') ok++; else fail++;
      await sleep(700);
    }
    return i.editReply(`✅ Przywrócono: **${ok}**, już na serwerze: **${already}**, nie udało się: **${fail}**.`);
  }

  return {
    commands: [verifyCmd, restoreCmd],
    handleCommand: async i => {
      if (i.commandName === 'weryfikacja') {
        if (!isAdmin(i)) return i.reply({ content: '❌ Nie masz uprawnień.', flags: EPHEMERAL });
        return i.reply(panelMessage());
      }
      if (i.commandName === 'przywroc') return handleRestore(i);
    },
    handleButton, handleModal, oauthCallback, oauthOn,
  };
}
