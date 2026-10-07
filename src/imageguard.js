import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';

const NOTICE_TTL = 12_000;   // komunikat znika po 12 s
const IMG_EXT = /\.(?:png|jpe?g|gif|gifv|webp|bmp|avif|apng|heic)(?:$|[?#])/i;
// linki do obrazkow / GIF-ow (GIF z wyszukiwarki Discorda to link tenor.com / giphy.com)
const LINK_RES = [
  /https?:\/\/\S+\.(?:png|jpe?g|gif|gifv|webp|bmp|avif|apng|heic)(?:[?#]\S*)?/i,
  /https?:\/\/(?:[\w-]+\.)?(?:tenor\.com|giphy\.com|gfycat\.com|imgur\.com|gyazo\.com|prnt\.sc|ibb\.co|postimg\.cc|imgbb\.com|lightshot\.com)\b/i,
  /https?:\/\/(?:cdn|media)\.discordapp\.(?:com|net)\/attachments\//i,
];

/** Czy wiadomosc zawiera zdjecie / GIF (zalacznik, link albo rozwiniety embed)? */
export function hasImage(message) {
  for (const a of message.attachments?.values?.() ?? []) {
    if ((a.contentType || '').startsWith('image/') || IMG_EXT.test(a.name || '') || IMG_EXT.test(a.url || '')) return true;
  }
  const text = message.content || '';
  if (LINK_RES.some(re => re.test(text))) return true;
  for (const e of message.embeds ?? []) {
    if (e.data?.type === 'image' || e.data?.type === 'gifv' || e.type === 'image' || e.type === 'gifv') return true;
  }
  return false;
}

/**
 * Blokada zdjec i GIF-ow: dozwolone TYLKO na kanalach z IMAGE_CHANNEL_IDS (po przecinku), chyba ze autor ma odpowiednia range.
 * Bez IMAGE_CHANNEL_IDS funkcja jest wylaczona. Zawsze dozwolone: tickety, boosterzy, BOOST_ROLE_ID, MEDIA_ROLE_ID,
 * TICKET_STAFF_ROLE_ID, ADMIN_IDS, Administrator / Zarzadzanie wiadomosciami oraz role z IMAGE_ALLOWED_ROLE_IDS.
 */
export function createImageGuard({ env }) {
  const csv = v => (v || '').split(',').map(s => s.trim()).filter(Boolean);
  const channels = csv(env.IMAGE_CHANNEL_IDS || env.IMAGE_CHANNEL_ID);
  const adminIds = csv(env.ADMIN_IDS);
  const roles = [env.IMAGE_ALLOWED_ROLE_IDS, env.TICKET_STAFF_ROLE_ID, env.BOOST_ROLE_ID, env.MEDIA_ROLE_ID]
    .flatMap(v => csv(v));
  const enabled = channels.length > 0;

  const mayPost = member => {
    if (!member) return false;
    if (adminIds.includes(member.id)) return true;
    if (member.premiumSinceTimestamp) return true;   // Server Booster
    if (member.permissions?.has(PermissionFlagsBits.Administrator) || member.permissions?.has(PermissionFlagsBits.ManageMessages)) return true;
    return roles.some(r => member.roles?.cache?.has(r));
  };

  /** Zwraca true, jesli wiadomosc zostala usunieta. */
  async function check(message) {
    if (!enabled || !message.guild || message.author?.bot || message.system || message.webhookId) return false;
    const ch = message.channel;
    const baseId = ch?.isThread?.() ? ch.parentId : message.channelId;
    if (channels.includes(message.channelId) || channels.includes(baseId)) return false;
    if (/^ticket:/.test(ch?.topic || '')) return false;   // w ticketach mozna wysylac dowody platnosci itp.
    if (!hasImage(message)) return false;

    const member = message.member ?? await message.guild.members.fetch(message.author.id).catch(() => null);
    if (mayPost(member)) return false;

    try { await message.delete(); }
    catch (e) { console.error('Blokada zdjec - nie udalo sie usunac (brak "Zarzadzanie wiadomosciami"?):', e.message); return false; }

    const embed = new EmbedBuilder()
      .setColor(0xed4245)
      .setDescription(`📷 <@${message.author.id}>, zdjęcia i GIF-y możesz wysyłać tylko na kanale ${channels.map(c => `<#${c}>`).join(', ')} (albo mając odpowiednią rangę).`);
    try {
      const sent = await ch.send({ embeds: [embed], allowedMentions: { users: [message.author.id] } });
      setTimeout(() => sent.delete().catch(() => {}), NOTICE_TTL).unref?.();
    } catch { /* brak prawa pisania - trudno */ }
    return true;
  }

  return { enabled, check };
}
