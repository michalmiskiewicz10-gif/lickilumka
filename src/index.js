import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './store.js';
import { createApi } from './api.js';
import { createBot } from './bot.js';

try { process.loadEnvFile(); } catch { /* brak .env - uzyje zmiennych srodowiskowych */ }
const env = process.env;

for (const k of ['DISCORD_TOKEN', 'SIGNING_PRIVATE_KEY']) {
  if (!env[k]) { console.error(`Brakuje ${k} w pliku .env`); process.exit(1); }
}

const privateKey = crypto.createPrivateKey({
  key: Buffer.from(env.SIGNING_PRIVATE_KEY, 'base64'), format: 'der', type: 'pkcs8',
});

const dir = path.dirname(fileURLToPath(import.meta.url));
const dataDir = env.DATA_DIR || path.join(dir, '..', 'data');   // na Railway: ustaw DATA_DIR na sciezke Volume
const store = new Store(path.join(dataDir, 'licenses.json'));

const bot = createBot({ store, env });
const api = createApi({
  store, privateKey,
  onActivated: lic => bot.refreshMessage(lic),
});

const port = parseInt(env.PORT || '8787', 10);
api.listen(port, () => console.log(`API licencji nasluchuje na porcie ${port}`));
bot.client.on('error', e => console.error('Blad klienta Discord:', e.message));
bot.client.login(env.DISCORD_TOKEN).catch(e => {
  console.error('Logowanie bota nie powiodlo sie:', e.message);
  if (/intents/i.test(e.message)) {
    console.error('=> Wlacz w Developer Portal -> Bot -> Privileged Gateway Intents: "Server Members Intent" i "Message Content Intent", zapisz i zrestartuj.');
  }
  process.exit(1);
});
