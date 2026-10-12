import { PermissionFlagsBits } from 'discord.js';

export function createAntiRaid({ client, env }) {
  const enabled = !['0', 'false', 'off'].includes(String(env.ANTI_RAID ?? '1').toLowerCase());
  const limit = Math.max(3, Number(env.ANTI_RAID_MESSAGE_LIMIT) || 7);
  const history = new Map();
  const admins = new Set((env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean));
  const exempt = new Set((env.ANTI_RAID_EXEMPT_ROLE_IDS || '').split(',').map(s => s.trim()).filter(Boolean));
  const alerts = new Map();
  async function alert(message, info) {
    if (!env.ANTI_RAID_LOG_CHANNEL_ID || Date.now() - (alerts.get(message.guild.id) || 0) < 5000) return;
    alerts.set(message.guild.id, Date.now());
    try {
      const ch = await client.channels.fetch(env.ANTI_RAID_LOG_CHANNEL_ID);
      if (ch?.guildId === message.guild.id && ch.isTextBased()) await ch.send({ content: info, allowedMentions: { parse: [] } });
    } catch (e) { console.warn('AntiRaid log:', e.message); }
  }
  async function onMessage(message) {
    if (!enabled || !message.guild || !message.author || message.system) return false;
    const member = message.member;
    if (admins.has(message.author.id) || member?.permissions?.has(PermissionFlagsBits.Administrator) ||
        member?.permissions?.has(PermissionFlagsBits.ManageGuild) ||
        [...exempt].some(id => member?.roles?.cache?.has(id))) return false;
    if ((message.applicationId || message.webhookId) && String(env.ANTI_RAID_BLOCK_EXTERNAL ?? '1') !== '0') {
      await message.delete().catch(e => console.warn('AntiRaid delete:', e.message));
      await alert(message, `🛡️ AntiRaid: wykryto wiadomość aplikacji/webhooka na <#${message.channelId}>.`);
      return true;
    }
    if (message.author.bot) return false;
    const now = Date.now();
    const key = `${message.guild.id}:${message.author.id}`;
    const recent = (history.get(key) || []).filter(t => now - t < 10000);
    recent.push(now);
    history.set(key, recent);
    if (history.size > 3000) for (const [k, times] of history) if (now - times[times.length - 1] > 10000) history.delete(k);
    if (recent.length < limit) return false;
    history.delete(key);
    await message.delete().catch(() => {});
    const target = member ?? await message.guild.members.fetch(message.author.id).catch(() => null);
    if (target?.moderatable) await target.timeout(600000, 'AntiRaid: masowy spam').catch(e => console.warn('AntiRaid timeout:', e.message));
    await alert(message, `🚨 AntiRaid: spam użytkownika ${message.author.id} (${limit} wiadomości w 10 sekund).`);
    return true;
  }
  return { onMessage };
}
