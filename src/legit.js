import { EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

const EPHEMERAL = MessageFlags.Ephemeral;

/**
 * Licznik legitcheckow: kazda wiadomosc napisana przez gracza na kanale LEGITCHECK_CHANNEL_ID
 * zwieksza licznik, a bot od razu wysyla pod nia embed z aktualna liczba (poprzedni embed licznika kasuje).
 */
export function createLegit({ store, env, isAdmin, serverName }) {
  const channelId = env.LEGITCHECK_CHANNEL_ID;
  const start = parseInt(env.LEGITCHECK_START || '0', 10) || 0;
  let queue = Promise.resolve(); // wiadomosci obslugujemy po kolei, zeby licznik sie nie rozjechal

  const counterCmd = new SlashCommandBuilder()
    .setName('licznik').setDescription('Ustawia aktualną liczbę legitchecków')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addIntegerOption(o => o.setName('ilosc').setDescription('Nowa wartość licznika').setRequired(true).setMinValue(0));

  const embed = n => new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle('⭐ LICZNIK LEGITCHECK')
    .setDescription(`> Łączna liczba legitchecków: \`${n}\` ⭐\n> Dziękujemy za zaufanie i każde wystawione +rep!`)
    .setFooter({ text: `${serverName} LegitCheck` });

  async function handle(message) {
    const n = store.getMeta('legitcheck', start) + 1;
    store.setMeta('legitcheck', n);
    const prev = store.getMeta('legitcheckMsg');
    const sent = await message.channel.send({ embeds: [embed(n)] });
    store.setMeta('legitcheckMsg', sent.id);
    if (prev) message.channel.messages.delete(prev).catch(() => {});
  }

  return {
    commands: [counterCmd],
    onMessage(message) {
      if (!channelId || message.channelId !== channelId) return;
      if (message.author.bot || message.system) return;
      queue = queue.then(() => handle(message)).catch(e => console.error('Licznik legitcheck:', e.message));
    },
    handleCommand: async i => {
      if (i.commandName !== 'licznik') return;
      if (!isAdmin(i)) return i.reply({ content: '❌ Nie masz uprawnień.', flags: EPHEMERAL });
      const n = i.options.getInteger('ilosc', true);
      store.setMeta('legitcheck', n);
      return i.reply({ content: `✅ Licznik ustawiony na **${n}**. Następna wiadomość na kanale pokaże ${n + 1}.`, flags: EPHEMERAL });
    },
  };
}
