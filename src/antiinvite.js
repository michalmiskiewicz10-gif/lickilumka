import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';

const MUTE_MS = 30 * 60_000;        // 30 minut
const NOTICE_TTL = 30_000;          // komunikat na kanale znika po 30 s

// zaproszenia do serwerow Discord (kody: litery, cyfry, myslnik)
const INVITE_RES = [
  /discord(?:app)?\.com\/invite\/+([a-z0-9-]+)/gi,
  /(?:discord\.gg|dsc\.gg|discord\.me|discord\.link|invite\.gg|discord\.io|discord\.li)\/+([a-z0-9-]+)/gi,
];

/** Wyciaga kody zaproszen z tekstu (odporne na proste obejscia: "discord[.]gg", znaki zerowej szerokosci). */
export function findInviteCodes(content) {
  const text = String(content || '')
    .normalize('NFKC')
    .replace(/[\u200b-\u200f\u2060\ufeff]/g, '')
    .replace(/\s*(?:\[\.\]|\(\.\)|\(dot\))\s*/gi, '.')
    .replace(/\s*\.\s*(?=gg\/)/gi, '.');
  const codes = new Set();
  for (const re of INVITE_RES) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) codes.add(m[1]);
  }
  return [...codes];
}

/**
 * Antyreklama: wiadomosc z linkiem do INNEGO serwera Discord jest usuwana, autor dostaje mute na 30 minut,
 * a na kanale pojawia sie komunikat. Zaproszenia do WLASNEGO serwera sa dozwolone.
 * Wylaczysz: ANTI_INVITE=0. Wyjatki: osoby z "Zarzadzanie wiadomosciami"/Administrator, ADMIN_IDS, TICKET_STAFF_ROLE_ID,
 * role z ANTI_INVITE_EXEMPT_ROLE_IDS (po przecinku).
 */
export function createAntiInvite({ client, env, serverName }) {
  const enabled = !['0', 'off', 'false', 'nie'].includes(String(env.ANTI_INVITE || '').toLowerCase());
  const adminIds = (env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  const exemptRoles = [env.TICKET_STAFF_ROLE_ID, ...(env.ANTI_INVITE_EXEMPT_ROLE_IDS || '').split(',')]
    .map(s => (s || '').trim()).filter(Boolean);

  const isExempt = member => {
    if (!member) return false;
    if (adminIds.includes(member.id)) return true;
    if (member.permissions?.has(PermissionFlagsBits.Administrator) || member.permissions?.has(PermissionFlagsBits.ManageMessages)) return true;
    return exemptRoles.some(r => member.roles?.cache?.has(r));
  };

  /** Czy zaproszenie prowadzi do innego serwera niz ten? (blad pobrania / nieistniejacy kod = traktujemy jak obcy). */
  async function isForeign(code, guildId) {
    try {
      const inv = await client.fetchInvite(code);
      return inv.guild?.id !== guildId;
    } catch { return true; }
  }

  /** Zwraca true, jesli wiadomosc zostala potraktowana jako reklama (reszta handlerow ma ja pominac). */
  async function onMessage(message) {
    if (!enabled || !message.guild || message.author?.bot || message.system || !message.content) return false;
    const codes = findInviteCodes(message.content);
    if (!codes.length) return false;

    const member = message.member ?? await message.guild.members.fetch(message.author.id).catch(() => null);
    if (isExempt(member)) return false;

    let foreign = false;
    for (const c of codes) { if (await isForeign(c, message.guild.id)) { foreign = true; break; } }
    if (!foreign) return false;

    try { await message.delete(); }
    catch (e) { console.error('Antyreklama - nie udalo sie usunac wiadomosci (brak "Zarzadzanie wiadomosciami"?):', e.message); }

    let muted = true;
    try { await member?.timeout(MUTE_MS, 'Link do innego serwera Discord'); }
    catch (e) {
      muted = false;
      console.error('Antyreklama - nie udalo sie nadac mute (brak "Wyciszanie czlonkow" albo rola bota nizej niz uzytkownika):', e.message);
    }

    const embed = new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle('🚫 Nie wysyłaj linków do innych serwerów!')
      .setDescription([
        `<@${message.author.id}>, wysyłanie zaproszeń do innych serwerów Discord jest **zabronione**.`,
        muted ? 'Twoja wiadomość została usunięta, a Ty otrzymałeś **wyciszenie na 30 minut**.' : 'Twoja wiadomość została usunięta.',
      ].join('\n'))
      .setFooter({ text: serverName });
    try {
      const sent = await message.channel.send({ embeds: [embed], allowedMentions: { users: [message.author.id] } });
      setTimeout(() => sent.delete().catch(() => {}), NOTICE_TTL).unref?.();
    } catch (e) { console.error('Antyreklama - komunikat:', e.message); }
    return true;
  }

  return { enabled, onMessage };
}
