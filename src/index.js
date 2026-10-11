import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './store.js';
import { createApi } from './api.js';
import { createBot } from './bot.js';
import { findAsset } from './assets.js';

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

for (const n of ['kot', 'welcome', 'ticket']) {
  const a = findAsset(n);
  console.log(`[grafika] assets/${n}: ${a ? 'znaleziono (' + a.name + ')' : 'brak'}`);
}
if (!findAsset('welcome', 'kot') && env.WELCOME_IMAGE_URL) {
  console.warn('[grafika] UWAGA: brak assets/kot.png na serwerze - powitanie uzyje WELCOME_IMAGE_URL; linki z Discorda (cdn.discordapp.com) wygasaja i obrazek sie nie laduje. Upewnij sie, ze folder assets/ jest wdrozony.');
}

// Bot moze pozostac tylko na jednym, wskazanym serwerze.
// Discord nie pozwala zmienic komunikatu w oknie autoryzacji zaproszenia.
const allowedGuildId = (env.GUILD_ID || '').trim();
if (!/^\d{17,20}$/.test(allowedGuildId)) {
  console.error('Ustaw prawidlowe GUILD_ID swojego serwera w .env (17-20 cyfr).');
  process.exit(1);
}

async function rejectForeignGuild(guild) {
  if (guild.id === allowedGuildId) return;
  console.warn(`Niedozwolony serwer: ${guild.name} (${guild.id}). Opuszczam.`);
  const message = 'nie dodasz tego bota do siebie ziomeczku';
  try {
    const channel = guild.systemChannel;
    if (channel?.isTextBased() && channel.permissionsFor(guild.members.me)?.has('SendMessages')) {
      await channel.send(message);
    } else {
      const owner = await guild.fetchOwner();
      await owner.send(message);
    }
  } catch (error) {
    console.warn(`Nie udalo sie wyslac komunikatu na ${guild.id}: ${error.message}`);
  } finally {
    try { await guild.leave(); }
    catch (error) { console.error(`Nie udalo sie opuscic ${guild.id}: ${error.message}`); }
  }
}

const bot = createBot({ store, env });
bot.client.on('guildCreate', rejectForeignGuild);
bot.client.once('ready', () => {
  for (const guild of bot.client.guilds.cache.values()) {
    if (guild.id !== allowedGuildId) void rejectForeignGuild(guild);
  }
});
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
