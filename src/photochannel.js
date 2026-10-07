import { EmbedBuilder } from 'discord.js';

const IMG_EXT = /\.(?:png|jpe?g|gif|webp|bmp|avif|apng)(?:$|[?#])/i;
const isImage = a => (a.contentType || '').startsWith('image/') || IMG_EXT.test(a.name || '') || IMG_EXT.test(a.url || '');

/**
 * KANAL ZE ZDJECIAMI (PHOTO_CHANNEL_ID, mozna kilka po przecinku).
 * Kazda wiadomosc gracza na tym kanale jest USUWANA:
 *  - jesli to zdjecie/GIF (zalacznik) -> bot wysyla to zdjecie w embedzie (autor + obrazek),
 *  - jesli to cos innego (sam tekst, plik, naklejka) -> wiadomosc znika, bot nic nie wysyla.
 * Zwraca true, gdy wiadomosc zostala obsluzona (zeby kolejne moduly jej nie dotykaly).
 */
export function createPhotoChannel({ env, serverName }) {
  const channels = (env.PHOTO_CHANNEL_ID || '').split(',').map(s => s.trim()).filter(Boolean);
  const enabled = channels.length > 0;
  const color = 0x5865f2;

  async function onMessage(message) {
    if (!enabled || !message.guild || message.author?.bot || message.system || message.webhookId) return false;
    if (!channels.includes(message.channelId)) return false;

    const imgs = [...message.attachments.values()].filter(isImage).slice(0, 10);

    if (imgs.length) {
      const caption = (message.content || '').trim().slice(0, 1000);
      const files = [];
      const embeds = imgs.map((img, idx) => {
        // zalacznik wgrywamy ponownie, bo po usunieciu oryginalu jego link przestaje dzialac
        const name = `${idx}_${(img.name || 'obraz.png').replace(/[^A-Za-z0-9._-]/g, '_')}`;
        files.push({ attachment: img.url, name });
        const e = new EmbedBuilder().setColor(color).setImage(`attachment://${name}`);
        if (idx === 0) {
          e.setAuthor({ name: message.member?.displayName || message.author.username, iconURL: message.author.displayAvatarURL({ size: 128 }) })
            .setDescription(`📷 Zdjęcie od <@${message.author.id}>${caption ? `\n\n${caption}` : ''}`)
            .setFooter({ text: serverName });
        }
        return e;
      });
      try {
        await message.channel.send({ embeds, files, allowedMentions: { parse: [] } });
      } catch (e) {
        console.error('Kanal zdjec - nie udalo sie wyslac embeda:', e.message);
        return false;   // oryginalu nie kasujemy, zeby zdjecie nie przepadlo
      }
    }

    try { await message.delete(); }
    catch (e) { console.error('Kanal zdjec - nie udalo sie usunac wiadomosci (brak "Zarzadzanie wiadomosciami"?):', e.message); }
    return true;
  }

  return { enabled, onMessage };
}
