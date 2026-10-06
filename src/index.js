import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './store.js';
import { createApi } from './api.js';
import { createBot } from './bot.js';

try { process.loadEnvFile(); } catch { /* brak .env - uzyje zmiennych srodowiskowych */ }
const env = process.env;

for (const k of ['DISCORD_TOKEN', 'LICENSE_CHANNEL_ID', 'SIGNING_PRIVATE_KEY']) {
  if (!env[k]) { console.error(`Brakuje ${k} w pliku .env`); process.exit(1); }
}

const privateKey = crypto.createPrivateKey({
  key: Buffer.from(env.SIGNING_PRIVATE_KEY, 'base64'), format: 'der', type: 'pkcs8',
});

const dir = path.dirname(fileURLToPath(import.meta.url));
const store = new Store(path.join(dir, '..', 'data', 'licenses.json'));

const bot = createBot({ store, env });
const api = createApi({ store, privateKey, onActivated: lic => bot.refreshMessage(lic) });

const port = parseInt(env.PORT || '8787', 10);
api.listen(port, () => console.log(`API licencji nasluchuje na porcie ${port}`));
bot.client.login(env.DISCORD_TOKEN);
