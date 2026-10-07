import {
  ChannelType, EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder,
} from 'discord.js';
import { PARTS } from './regulamin-tekst.js';

const EPHEMERAL = MessageFlags.Ephemeral;

/**
 * /regulamin [kanal] - wysyla regulamin modow i licencji jako 7 wiadomosci bota (embedy) na kanal.
 * Uzupelnij w .env: REGULAMIN_SPRZEDAWCA (dane sprzedawcy) i opcjonalnie REGULAMIN_DATA (data obowiazywania; domyslnie dzisiaj).
 */
export function createRegulamin({ env, isAdmin, serverName }) {
  const cmd = new SlashCommandBuilder()
    .setName('regulamin').setDescription('Wysyła na kanał regulamin modów i licencji')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(o => o.setName('kanal').setDescription('Na jaki kanał wysłać (domyślnie: ten, na którym użyto komendy)')
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement));

  const fill = text => text
    .replaceAll('{{SERWER}}', serverName)
    .replaceAll('{{DATA}}', env.REGULAMIN_DATA || new Date().toLocaleDateString('pl-PL', { timeZone: 'Europe/Warsaw' }))
    .replaceAll('{{SPRZEDAWCA}}', env.REGULAMIN_SPRZEDAWCA || `administracja serwera ${serverName} (kontakt przez ticket)`);

  async function handleCommand(i) {
    if (i.commandName !== 'regulamin') return;
    if (!isAdmin(i)) return i.reply({ content: '❌ Nie masz uprawnień.', flags: EPHEMERAL });
    const channel = i.options.getChannel('kanal') || i.channel;
    if (!channel?.isTextBased?.()) return i.reply({ content: '❌ Nie widzę tego kanału. Sprawdź uprawnienia bota.', flags: EPHEMERAL });

    await i.deferReply({ flags: EPHEMERAL });
    let sent = 0;
    try {
      for (let n = 0; n < PARTS.length; n++) {
        const embed = new EmbedBuilder().setColor(0x5865f2).setDescription(fill(PARTS[n]));
        if (n === PARTS.length - 1) embed.setFooter({ text: `${serverName} • Regulamin modów i licencji` });
        await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
        sent++;
      }
    } catch (e) {
      console.error('Regulamin:', e.message);
      return i.editReply(`❌ Wysłano ${sent}/${PARTS.length} części, potem błąd: ${e.message}\n(Bot musi widzieć kanał i mieć „Wysyłanie wiadomości” oraz „Osadzanie linków”.)`);
    }
    return i.editReply(`✅ Regulamin wysłany na <#${channel.id}> (${sent} wiadomości).`);
  }

  return { commands: [cmd], handleCommand };
}
