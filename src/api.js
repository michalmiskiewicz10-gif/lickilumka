import http from 'node:http';
import crypto from 'node:crypto';

const KEY_RE = /^[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/;
const HWID_RE = /^[0-9a-f]{64}$/;
const NONCE_RE = /^[0-9a-f]{16,64}$/;

/** Sprawdza licencje. Przy pierwszym poprawnym uzyciu PRZYPISUJE ja do komputera (hwid). */
export function evaluate(store, { key, hwid }, now = Date.now()) {
  const lic = store.get(key);
  if (!lic) return { ok: false, reason: 'not_found' };
  if (lic.revoked) return { ok: false, reason: 'revoked' };
  if (lic.expiresAt != null && now >= lic.expiresAt) return { ok: false, reason: 'expired' };
  if (lic.hwid && lic.hwid !== hwid) return { ok: false, reason: 'hwid' };

  let activated = false;
  if (!lic.hwid) {
    lic.hwid = hwid;
    lic.activatedAt = now;
    activated = true;
  }
  lic.lastSeen = now;
  store.put(lic);
  return { ok: true, reason: '', lic, activated };
}

export function createApi({ store, privateKey, onActivated, oauthCallback, log = console }) {
  const hits = new Map(); // ip -> [timestamps]

  function rateLimited(ip) {
    const now = Date.now();
    const arr = (hits.get(ip) || []).filter(t => now - t < 60_000);
    arr.push(now);
    hits.set(ip, arr);
    return arr.length > 60; // max 60 zapytan / minute / IP
  }
  setInterval(() => hits.clear(), 10 * 60_000).unref();

  /** Odpowiedz = linia 1: JSON, linia 2: podpis Ed25519 (base64). Mod sprawdza podpis kluczem publicznym. */
  function signed(obj) {
    const payload = JSON.stringify(obj);
    const sig = crypto.sign(null, Buffer.from(payload), privateKey).toString('base64');
    return payload + '\n' + sig;
  }

  const server = http.createServer(async (req, res) => {
    const send = (code, body) => {
      res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(body);
    };

    // przekierowanie po akceptacji aplikacji (weryfikacja OAuth2)
    if (req.method === 'GET' && req.url.startsWith('/oauth/callback')) {
      if (!oauthCallback) return send(404, 'not found');
      const q = new URL(req.url, 'http://x').searchParams;
      try {
        const r = await oauthCallback({ code: q.get('code'), state: q.get('state'), error: q.get('error') });
        res.writeHead(r.status, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(r.html);
      } catch (e) { log.error(e); return send(500, 'error'); }
    }
    if (req.method === 'GET' && req.url === '/') return send(200, 'ok');
    if (req.method !== 'POST' || req.url !== '/api/validate') return send(404, 'not found');

    const ip = req.socket.remoteAddress || '?';
    if (rateLimited(ip)) return send(429, 'too many requests');

    let raw = '';
    req.on('data', c => {
      raw += c;
      if (raw.length > 2048) { req.destroy(); }
    });
    req.on('end', () => {
      let body;
      try { body = JSON.parse(raw); } catch { return send(400, 'bad json'); }
      const { key, hwid, nonce } = body || {};
      if (!KEY_RE.test(key || '') || !HWID_RE.test(hwid || '') || !NONCE_RE.test(nonce || '')) {
        log.log(`[licencja] 400 bad request: key=${KEY_RE.test(key || '')} hwid=${HWID_RE.test(hwid || '')} nonce=${NONCE_RE.test(nonce || '')}`);
        return send(400, 'bad request');
      }
      const r = evaluate(store, { key, hwid });
      const exp = r.ok ? (r.lic.expiresAt ?? 0) : 0; // 0 = permanentna
      send(200, signed({ ok: r.ok, reason: r.reason, nonce, exp, ts: Date.now() }));
      if (r.ok && r.activated) {
        log.log(`[licencja] aktywowano ${key} (<@${r.lic.discordId}>)`);
        try { onActivated?.(r.lic); } catch (e) { log.error(e); }
      }
    });
  });

  return server;
}
