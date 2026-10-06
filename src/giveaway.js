import crypto from 'node:crypto';
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags,
  PermissionFlagsBits, SlashCommandBuilder,
} from 'discord.js';
import { parseText } from './util.js';

const EPHEMERAL = MessageFlags.Ephemeral;
const MIN_MS = 10_000;               // minimum 10 sekund
const MAX_MS = 60 * 86_400_000;      // maksimum 60 dni

const allWinners = gw => [...(gw.winners || []), ...(gw.rerolled || [])];
const clip = (s, n = 1000) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/**
 * Konkursy:
 *  /konkurs wymagania ilosc_wygranych nagroda czas   - bot wrzuca embed z przyciskiem "Wez udzial";
 *                                                      po uplywie czasu losuje zwyciezcow i PINGUJE ich na kanale
 *  /roll konkurs [id] [ilosc]                        - dolosowuje kolejna osobe (spoza dotychczasowych zwyciezcow)
 * Konkursy leza w bazie, wiec przezywaja restart bota (zakonczy sie po starcie, jesli czas minal).
 */
export function createGiveaway({ client, store, isAdmin }) {
  const konkursCmd = new SlashCommandBuilder()
    .setName('konkurs').setDescription('Tworzy konkurs z losowaniem zwycięzców')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o => o.setName('wymagania').setDescription('Wymagania, żeby wziąć udział').setRequired(true).setMaxLength(500))
    .addIntegerOption(o => o.setName('ilosc_wygranych').setDescription('Ilu zwycięzców wylosować').setRequired(true).setMinValue(1).setMaxValue(20))
    .addStringOption(o => o.setName('nagroda').setDescription('Rzecz do wygrania').setRequired(true).setMaxLength(200))
    .addStringOption(o => o.setName('czas').setDescription('Za ile kończy się konkurs, np. 30m, 2h, 1d, 7d').setRequired(true).setMaxLength(12));

  const rollCmd = new SlashCommandBuilder()
    .setName('roll').setDescription('Narzędzia do konkursów')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(s => s.setName('konkurs').setDescription('Losuje kolejnego zwycięzcę zakończonego konkursu')
      .addStringOption(o => o.setName('id').setDescription('ID wiadomości konkursu (domyślnie: ostatni zakończony na tym kanale)'))
      .addIntegerOption(o => o.setName('ilosc').setDescription('Ilu nowych zwycięzców (domyślnie 1)').setMinValue(1).setMaxValue(20)));

  const stopCmd = new SlashCommandBuilder()
    .setName('konkurs_wylacz').setDescription('Wyłącza trwający konkurs (anuluje go albo kończy od razu z losowaniem)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o => o.setName('id').setDescription('ID wiadomości konkursu (domyślnie: trwający konkurs na tym kanale)'))
    .addBooleanOption(o => o.setName('losuj').setDescription('Zakończ od razu i wylosuj zwycięzców (domyślnie: nie – konkurs jest po prostu anulowany)'));

  function embedFor(gw) {
    const ended = !!gw.ended;
    const s = Math.floor(gw.endsAt / 1000);
    const embed = new EmbedBuilder()
      .setColor(ended ? 0x808080 : 0xf5c542)
      .setTitle(gw.cancelled ? '🚫 KONKURS – ANULOWANY' : ended ? '🎉 KONKURS – ZAKOŃCZONY' : '🎉 KONKURS')
      .setDescription(`## 🎁 ${gw.prize}`)
      .addFields(
        { name: '📋 Wymagania', value: gw.requirements },
        { name: '🏆 Liczba zwycięzców', value: String(gw.winnersCount), inline: true },
        { name: '👥 Uczestnicy', value: String(gw.participants.length), inline: true },
        { name: '🎤 Organizator', value: `<@${gw.hostId}>`, inline: true },
        { name: ended ? '⏰ Planowany koniec' : '⏰ Koniec', value: `<t:${s}:F>\n(<t:${s}:R>)` },
      );
    if (ended && !gw.cancelled) {
      const w = allWinners(gw);
      embed.addFields({ name: '🏅 Zwycięzcy', value: w.length ? clip(w.map(id => `<@${id}>`).join(', ')) : 'Brak – nikt nie wziął udziału.' });
    }
    return embed;
  }

  const joinRow = gw => new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('gw:join')
      .setLabel(gw.cancelled ? 'Konkurs anulowany' : gw.ended ? 'Konkurs zakończony' : `Weź udział (${gw.participants.length})`)
      .setEmoji('🎉').setStyle(gw.ended ? ButtonStyle.Secondary : ButtonStyle.Primary).setDisabled(!!gw.ended),
  );

  /** Losuje n osob z puli (Fisher-Yates na crypto.randomInt); pomija tych, ktorzy opuscili serwer. */
  async function pick(guild, pool, n) {
    const arr = [...pool];
    for (let k = arr.length - 1; k > 0; k--) {
      const j = crypto.randomInt(k + 1);
      [arr[k], arr[j]] = [arr[j], arr[k]];
    }
    const out = [];
    for (const id of arr) {
      if (out.length >= n) break;
      if (guild) { try { await guild.members.fetch(id); } catch { continue; } }
      out.push(id);
    }
    return out;
  }

  async function finish(gw) {
    gw.ended = true; gw.endedAt = Date.now();
    store.putGiveaway(gw);   // oznaczamy od razu, zeby nie zakonczyc dwa razy

    let ch;
    try { ch = await client.channels.fetch(gw.channelId); }
    catch (e) { console.error('Konkurs - brak kanalu:', e.message); return; }

    gw.winners = await pick(ch.guild, gw.participants, gw.winnersCount);
    store.putGiveaway(gw);

    try {
      const msg = await ch.messages.fetch(gw.id);
      await msg.edit({ embeds: [embedFor(gw)], components: [joinRow(gw)] });
    } catch (e) { console.error('Konkurs - edycja wiadomosci:', e.message); }

    const content = gw.winners.length
      ? `🎉 Gratulacje ${gw.winners.map(id => `<@${id}>`).join(', ')}! ${gw.winners.length === 1 ? 'Wygrywasz' : 'Wygrywacie'} **${gw.prize}**!`
      : `😕 Konkurs na **${gw.prize}** zakończył się bez zwycięzców – nikt nie wziął udziału.`;
    await ch.send({
      content,
      allowedMentions: { users: gw.winners },
      reply: { messageReference: gw.id, failIfNotExists: false },
    }).catch(e => console.error('Konkurs - ogloszenie wynikow:', e.message));
  }

  function tick() {
    const now = Date.now();
    for (const gw of store.allGiveaways()) {
      if (!gw.ended && gw.endsAt <= now) finish(gw).catch(e => console.error('Konkurs - zakonczenie:', e));
    }
  }

  async function handleCreate(i) {
    if (!isAdmin(i)) return i.reply({ content: '❌ Nie masz uprawnień.', flags: EPHEMERAL });
    const dur = parseText(i.options.getString('czas', true));
    if (!dur || dur.perm || dur.ms < MIN_MS || dur.ms > MAX_MS) {
      return i.reply({ content: '❌ Zły czas. Przykłady: `30m`, `2h`, `1d`, `7d` (min. 10 sekund, maks. 60 dni).', flags: EPHEMERAL });
    }
    if (!i.channel) return i.reply({ content: '❌ Nie widzę tego kanału. Sprawdź uprawnienia bota.', flags: EPHEMERAL });

    const gw = {
      id: null, channelId: i.channelId, guildId: i.guildId,
      requirements: i.options.getString('wymagania', true),
      winnersCount: i.options.getInteger('ilosc_wygranych', true),
      prize: i.options.getString('nagroda', true),
      hostId: i.user.id, createdAt: Date.now(), endsAt: Date.now() + dur.ms,
      participants: [], ended: false, winners: [], rerolled: [],
    };
    let msg;
    try { msg = await i.channel.send({ embeds: [embedFor(gw)], components: [joinRow(gw)] }); }
    catch (e) { return i.reply({ content: `❌ Nie mogę wysłać wiadomości na ten kanał: ${e.message}`, flags: EPHEMERAL }); }
    gw.id = msg.id;
    store.putGiveaway(gw);
    return i.reply({ content: `✅ Konkurs utworzony – skończy się <t:${Math.floor(gw.endsAt / 1000)}:R>.`, flags: EPHEMERAL });
  }

  async function handleStop(i) {
    if (!isAdmin(i)) return i.reply({ content: '❌ Nie masz uprawnień.', flags: EPHEMERAL });
    let id = i.options.getString('id');
    if (id) { const m = id.match(/(\d{15,25})\s*$/); id = m ? m[1] : id.trim(); }
    const gw = id
      ? store.getGiveaway(id)
      : store.allGiveaways().filter(g => !g.ended && g.channelId === i.channelId).sort((a, b) => b.createdAt - a.createdAt)[0];
    if (!gw) return i.reply({ content: '❌ Nie znalazłem trwającego konkursu. Użyj tej komendy na kanale konkursu albo podaj `id` wiadomości.', flags: EPHEMERAL });
    if (gw.ended) return i.reply({ content: '⌛ Ten konkurs jest już zakończony lub anulowany.', flags: EPHEMERAL });

    if (i.options.getBoolean('losuj')) {
      await i.deferReply({ flags: EPHEMERAL });
      await finish(gw);
      return i.editReply('🏁 Konkurs zakończony od razu – zwycięzcy wylosowani.');
    }

    gw.ended = true; gw.cancelled = true; gw.endedAt = Date.now(); gw.cancelledBy = i.user.id;
    store.putGiveaway(gw);
    try {
      const ch = await client.channels.fetch(gw.channelId);
      const msg = await ch.messages.fetch(gw.id);
      await msg.edit({ embeds: [embedFor(gw)], components: [joinRow(gw)] });
    } catch (e) { console.error('Konkurs - edycja po anulowaniu:', e.message); }
    return i.reply({ content: '🚫 Konkurs wyłączony (anulowany) – nikt nie został wylosowany.', flags: EPHEMERAL });
  }

  async function handleJoin(i) {
    const gw = store.getGiveaway(i.message.id);
    if (!gw) return i.reply({ content: '❌ Nie znaleziono tego konkursu w bazie.', flags: EPHEMERAL });
    if (gw.ended || Date.now() >= gw.endsAt) return i.reply({ content: '⌛ Ten konkurs już się zakończył.', flags: EPHEMERAL });

    const uid = i.user.id;
    const joined = !gw.participants.includes(uid);
    gw.participants = joined ? [...gw.participants, uid] : gw.participants.filter(x => x !== uid);
    store.putGiveaway(gw);
    await i.update({ embeds: [embedFor(gw)], components: [joinRow(gw)] });
    return i.followUp({
      content: joined ? '✅ Dołączyłeś do konkursu! Kliknij ponownie, aby się wypisać.' : '👋 Wypisałeś się z konkursu.',
      flags: EPHEMERAL,
    });
  }

  async function handleRoll(i) {
    if (!isAdmin(i)) return i.reply({ content: '❌ Nie masz uprawnień.', flags: EPHEMERAL });

    let id = i.options.getString('id');
    if (id) { const m = id.match(/(\d{15,25})\s*$/); id = m ? m[1] : id.trim(); }   // przyjmie tez link do wiadomosci
    const gw = id
      ? store.getGiveaway(id)
      : store.allGiveaways().filter(g => g.ended && g.channelId === i.channelId).sort((a, b) => b.endsAt - a.endsAt)[0];

    if (!gw) return i.reply({ content: '❌ Nie znalazłem takiego konkursu. Podaj `id` wiadomości konkursu (prawy klik → Kopiuj ID wiadomości).', flags: EPHEMERAL });
    if (!gw.ended) return i.reply({ content: '⏳ Ten konkurs jeszcze trwa – dolosować można dopiero po jego zakończeniu.', flags: EPHEMERAL });

    const n = i.options.getInteger('ilosc') ?? 1;
    const taken = new Set(allWinners(gw));
    const pool = gw.participants.filter(x => !taken.has(x));
    if (!pool.length) return i.reply({ content: '❌ Nie ma już nikogo do wylosowania – wszyscy uczestnicy już wygrali.', flags: EPHEMERAL });

    await i.deferReply();
    const picked = await pick(i.guild, pool, n);
    if (!picked.length) return i.editReply('❌ Pozostali uczestnicy opuścili już serwer – nie ma kogo wylosować.');

    gw.rerolled = [...(gw.rerolled || []), ...picked];
    store.putGiveaway(gw);

    // aktualizujemy liste zwyciezcow w oryginalnym embedzie
    try {
      const ch = await client.channels.fetch(gw.channelId);
      const msg = await ch.messages.fetch(gw.id);
      await msg.edit({ embeds: [embedFor(gw)], components: [joinRow(gw)] });
    } catch (e) { console.error('Roll - edycja wiadomosci konkursu:', e.message); }

    const link = `https://discord.com/channels/${gw.guildId}/${gw.channelId}/${gw.id}`;
    return i.editReply({
      content: `🎲 ${picked.length === 1 ? 'Nowy zwycięzca' : 'Nowi zwycięzcy'} konkursu na **${gw.prize}**: ${picked.map(x => `<@${x}>`).join(', ')} – gratulacje! 🎉\n-# [Przejdź do konkursu](${link})`,
      allowedMentions: { users: picked },
    });
  }

  return {
    commands: [konkursCmd, rollCmd, stopCmd],
    start() { setInterval(tick, 5000).unref?.(); tick(); },   // sprawdzanie koncow konkursow co 5 s
    handleCommand: async i => {
      if (i.commandName === 'konkurs') return handleCreate(i);
      if (i.commandName === 'konkurs_wylacz') return handleStop(i);
      if (i.commandName === 'roll' && i.options.getSubcommand() === 'konkurs') return handleRoll(i);
    },
    handleButton: i => (i.customId === 'gw:join' ? handleJoin(i) : null),
  };
}
