import crypto from 'node:crypto';
import { MessageFlags } from 'discord.js';

// bez O/0/I/1, zeby kod dalo sie przepisac bez pomylek
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Losowy kod XXXX-XXXX-XXXX-XXXX (crypto.randomInt = kryptograficznie bezpieczny losowy). */
export function genKey() {
  const groups = [];
  for (let i = 0; i < 4; i++) {
    let g = '';
    for (let j = 0; j < 4; j++) g += ALPHABET[crypto.randomInt(ALPHABET.length)];
    groups.push(g);
  }
  return groups.join('-');
}

export const UNIT_MS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
const MAX_MS = 3650 * UNIT_MS.d; // 10 lat

export const UNIT_LABEL = { s: 'sek.', m: 'min.', h: 'godz.', d: 'dni' };

function unitOf(word) {
  if (/^(s|sek)/.test(word)) return 's';
  if (/^(m|min)/.test(word)) return 'm';
  if (/^(h|g|godz)/.test(word)) return 'h';
  if (/^(d|dz|dn)/.test(word)) return 'd';
  return null;
}

/** Z komendy: jednostka (s/m/h/d/perm) + ilosc. Zwraca {perm:true} | {ms} | null. */
export function parseDuration(unit, amount) {
  if (unit === 'perm') return { perm: true };
  const mult = UNIT_MS[unit];
  if (!mult || !Number.isInteger(amount) || amount < 1) return null;
  const ms = amount * mult;
  return ms > MAX_MS ? null : { ms };
}

/** Z tekstu (modal): "7d", "12h", "90m", "30s", "perm". */
export function parseText(text) {
  const t = String(text || '').trim().toLowerCase();
  if (['perm', 'permanent', 'permanentna', 'permamentna', 'na zawsze'].includes(t)) return { perm: true };
  const m = t.match(/^(\d+)\s*([a-ząćęłńóśźż]+)$/);
  if (!m) return null;
  const unit = unitOf(m[2]);
  if (!unit) return null;
  return parseDuration(unit, parseInt(m[1], 10));
}

export function isExpired(lic, now = Date.now()) {
  return lic.expiresAt != null && now >= lic.expiresAt;
}

/** Tekst "kiedy wygasa" dla Discorda (znaczniki czasu Discorda sa lokalne dla kazdego). */
export function expiryText(lic) {
  if (lic.expiresAt == null) return '♾️ Nigdy (permanentna)';
  const s = Math.floor(lic.expiresAt / 1000);
  return `<t:${s}:F>\n(<t:${s}:R>)`;
}

/**
 * Wysyla panel jako ZWYKLA wiadomosc bota na kanale (bez naglowka "X uzyl /komenda"),
 * a osobie, ktora uzyla komendy, odpowiada tylko prywatnym potwierdzeniem.
 * `payloads` - jeden payload albo kilka (kolejne sa proba awaryjna, np. bez grafiki).
 */
export async function sendPanel(i, ...payloads) {
  const EPH = MessageFlags.Ephemeral;
  if (!i.channel) return i.reply({ content: '❌ Nie widzę tego kanału. Sprawdź uprawnienia bota.', flags: EPH });
  let lastErr;
  for (const payload of payloads) {
    try {
      await i.channel.send(payload);
      return i.reply({ content: '✅ Panel wysłany.', flags: EPH });
    } catch (e) { lastErr = e; console.error('Wysylanie panelu:', e.message); }
  }
  return i.reply({ content: `❌ Nie udało się wysłać panelu: ${lastErr?.message || 'nieznany błąd'}\n(Bot musi widzieć ten kanał i mieć „Wysyłanie wiadomości”, „Osadzanie linków”, „Dołączanie plików”.)`, flags: EPH });
}
