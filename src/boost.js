import { EmbedBuilder, MessageType } from 'discord.js';

const BOOST_TYPES = new Set([MessageType.GuildBoost, MessageType.GuildBoostTier1, MessageType.GuildBoostTier2, MessageType.GuildBoostTier3]);

/**
 * Boosty:
 *  - podziekowanie "Dziekujemy za boosta!" (embed + reakcja 💜) - wywolywane systemowa wiadomoscia Discorda o boostie
 *    (w Ustawieniach serwera -> Wiadomosci systemowe wlacz "Wysylaj wiadomosc, gdy ktos zboostuje serwer").
 *    Kanal: BOOST_CHANNEL_ID (jesli puste - kanal wiadomosci systemowej).
 *  - ranga BOOST_ROLE_ID: nadawana osobom, ktore boostuja serwer, i zabierana, gdy przestana. Uprawnienia ustawiasz
 *    w Discordzie na tej randze (bot tylko ja przydziela).
 */
export function createBoost({ client, env, serverName }) {
  const channelId = env.BOOST_CHANNEL_ID;
  const roleId = env.BOOST_ROLE_ID;

  async function onMessage(message) {
    if (!BOOST_TYPES.has(message.type) || !message.guild) return false;
    try {
      const ch = channelId ? await client.channels.fetch(channelId) : message.channel;
      const embed = new EmbedBuilder()
        .setColor(0x2b2d31)
        .setDescription([
          '# 💜 Dziękujemy za boosta! 💜',
          `Użytkownik <@${message.author.id}> właśnie zboostował serwer! 🚀`,
          '',
          'Twoje wsparcie bardzo pomaga w rozwoju naszej społeczności! 🔥',
        ].join('\n'))
        .setFooter({ text: `${serverName} • Boosty` });
      const sent = await ch.send({ embeds: [embed], allowedMentions: { parse: [] } });
      await sent.react('💜').catch(() => {});
    } catch (e) { console.error('Boost - podziekowanie:', e.message); }
    return true;
  }

  /** Synchronizuje range z faktycznym boostowaniem jednego czlonka. */
  async function syncMember(member) {
    if (!roleId || !member || member.user?.bot) return;
    const boosting = !!member.premiumSinceTimestamp;
    const has = member.roles.cache.has(roleId);
    try {
      if (boosting && !has) await member.roles.add(roleId, 'Boostuje serwer');
      else if (!boosting && has) await member.roles.remove(roleId, 'Przestal boostowac serwer');
    } catch (e) { console.error('Boost - ranga (rola bota musi byc WYZEJ niz BOOST_ROLE_ID):', e.message); }
  }

  /** Po starcie: porzadkuje rangi dla juz istniejacych boosterow (tylko na mniejszych serwerach). */
  async function syncAll(guild) {
    if (!roleId || guild.memberCount > 3000) return;
    try {
      const members = await guild.members.fetch();
      for (const m of members.values()) await syncMember(m);
    } catch (e) { console.error('Boost - synchronizacja rang:', e.message); }
  }

  return { enabled: !!(channelId || roleId), roleId, onMessage, syncMember, syncAll };
}
