import crypto from 'node:crypto';
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, Events, MessageFlags,
  ModalBuilder, PermissionFlagsBits, SlashCommandBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';

const EPHEMERAL = MessageFlags.Ephemeral;

/**
 * Weryfikacja: klik w przycisk -> okienko z prostym dzialaniem (dodawanie/odejmowanie, liczby do 10)
 * -> po poprawnej odpowiedzi bot nadaje role VERIFIED_ROLE_ID.
 */
export function createVerify({ client, env, isAdmin, serverName }) {
  const roleId = env.VERIFIED_ROLE_ID;
  const unverifiedId = env.UNVERIFIED_ROLE_ID;
  const pending = new Map(); // userId -> { answer, exp }
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of pending) if (v.exp < now) pending.delete(k);
  }, 60_000).unref();

  function makeQuestion() {
    if (crypto.randomInt(2) === 0) {
      const a = crypto.randomInt(1, 10);          // 1..9
      const b = crypto.randomInt(1, 11 - a);      // suma <= 10
      return { text: `${a} + ${b}`, answer: a + b };
    }
    const a = crypto.randomInt(2, 11);            // 2..10
    const b = crypto.randomInt(1, a);             // wynik >= 1
    return { text: `${a} - ${b}`, answer: a - b };
  }

  // kazdy nowy czlonek od razu dostaje range "niezweryfikowany" (UNVERIFIED_ROLE_ID); zabierana po weryfikacji
  client.on(Events.GuildMemberAdd, async member => {
    if (!unverifiedId || member.user.bot) return;
    if (env.GUILD_ID && member.guild.id !== env.GUILD_ID) return;
    try { await member.roles.add(unverifiedId); }
    catch (e) { console.error('Nadanie roli niezweryfikowanego nie wyszlo (rola bota musi byc wyzej):', e.message); }
  });

  const verifyCmd = new SlashCommandBuilder()
    .setName('weryfikacja').setDescription('Wysyła na kanał panel weryfikacji')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

  function panelMessage() {
    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle('✅ Weryfikacja')
      .setDescription([
        `Witaj na serwerze **${serverName}**!`,
        'Kliknij przycisk poniżej i rozwiąż proste działanie, aby uzyskać dostęp do serwera.',
      ].join('\n'));
    if (env.BANNER_URL) embed.setImage(env.BANNER_URL);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('verify:start').setLabel('Weryfikacja').setEmoji('✅').setStyle(ButtonStyle.Success),
    );
    return { embeds: [embed], components: [row] };
  }

  async function grantRole(userId) {
    const guild = await client.guilds.fetch(env.GUILD_ID);
    const member = await guild.members.fetch(userId);
    await member.roles.add(roleId);
    if (unverifiedId) await member.roles.remove(unverifiedId).catch(() => {});
  }

  async function handleButton(i) {
    if (!roleId) return i.reply({ content: '❌ Weryfikacja nie jest skonfigurowana (brak `VERIFIED_ROLE_ID`).', flags: EPHEMERAL });
    if (i.member?.roles?.cache?.has(roleId)) {
      return i.reply({ content: '✅ Jesteś już zweryfikowany.', flags: EPHEMERAL });
    }
    const q = makeQuestion();
    pending.set(i.user.id, { answer: String(q.answer), exp: Date.now() + 5 * 60_000 });
    const modal = new ModalBuilder().setCustomId('verify:modal').setTitle('Weryfikacja').addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('odp').setLabel(`Ile to jest ${q.text} ?`)
          .setStyle(TextInputStyle.Short).setPlaceholder('Wpisz wynik (liczba)').setRequired(true).setMaxLength(3),
      ),
    );
    return i.showModal(modal);
  }

  async function handleModal(i) {
    const p = pending.get(i.user.id);
    if (!p || p.exp < Date.now()) {
      return i.reply({ content: '⌛ Czas minął. Kliknij **Weryfikacja** jeszcze raz.', flags: EPHEMERAL });
    }
    pending.delete(i.user.id); // kazda proba = nowe dzialanie
    const ans = i.fields.getTextInputValue('odp').trim();
    if (ans !== p.answer) {
      return i.reply({ content: '❌ Zła odpowiedź. Kliknij **Weryfikacja** jeszcze raz – dostaniesz nowe działanie.', flags: EPHEMERAL });
    }
    try { await grantRole(i.user.id); }
    catch (e) {
      console.error('Nadanie roli nie wyszlo:', e.message);
      return i.reply({ content: '❌ Nie udało się nadać roli (sprawdź uprawnienia bota i pozycję jego roli).', flags: EPHEMERAL });
    }
    return i.reply({ content: '✅ Weryfikacja zakończona – witamy!', flags: EPHEMERAL });
  }

  return {
    commands: [verifyCmd],
    handleCommand: async i => {
      if (i.commandName !== 'weryfikacja') return;
      if (!isAdmin(i)) return i.reply({ content: '❌ Nie masz uprawnień.', flags: EPHEMERAL });
      return i.reply(panelMessage());
    },
    handleButton, handleModal,
  };
}
