import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, MessageFlags,
  PermissionFlagsBits as P, PermissionFlagsBits, SlashCommandBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
} from 'discord.js';

const EPHEMERAL = MessageFlags.Ephemeral;

const CATS = {
  pomoc: {
    label: 'Pomoc', desc: 'Uzyskaj pomoc od administracji', emoji: '❓', color: 0xed4245,
    intro: 'Opisz dokładnie swój problem – administracja odpowie tak szybko, jak to możliwe.',
  },
  wspolpraca: {
    label: 'Współpraca', desc: 'Zgłoszenie w sprawie współpracy', emoji: '🤝', color: 0xf5c542,
    intro: 'Napisz, na czym ma polegać współpraca i kim jesteś – administracja się z Tobą skontaktuje.',
  },
  media: {
    label: 'Media', desc: 'Chcę zostać media', emoji: '📸', color: 0x5865f2,
    intro: 'Podaj link do swojego kanału oraz liczbę widzów/subskrybentów – administracja rozpatrzy zgłoszenie.',
  },
};

/** System zgloszen (ticketow) z lista wyboru kategorii. Wlasciciela ticketu trzymamy w temacie kanalu: ticket:<userId>:<kat>. */
export function createTickets({ client, env, isAdmin, serverName }) {
  const staffRole = env.TICKET_STAFF_ROLE_ID;
  const adminIds = (env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);

  const ticketCmd = new SlashCommandBuilder()
    .setName('zgloszenia').setDescription('Wysyła na kanał panel systemu zgłoszeń (ticketów)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

  function panelMessage({ noBanner = false } = {}) {
    const embed = new EmbedBuilder()
      .setColor(0x2b2d31)
      .setTitle('System zgłoszeń')
      .setDescription('> Wybierz kategorię **zgłoszenia** z poniższego paska wyboru.');
    const banner = env.TICKET_BANNER_URL || env.BANNER_URL;
    if (banner && !noBanner && /^https?:\/\//i.test(banner.trim())) embed.setImage(banner.trim());
    const select = new StringSelectMenuBuilder()
      .setCustomId('ticket:select').setPlaceholder('Wybierz kategorię zgłoszenia')
      .addOptions(Object.entries(CATS).map(([value, c]) =>
        new StringSelectMenuOptionBuilder().setLabel(c.label).setDescription(c.desc).setValue(value).setEmoji({ name: c.emoji })));
    return { embeds: [embed], components: [new ActionRowBuilder().addComponents(select)] };
  }

  const ownerOf = ch => {
    const m = /^ticket:(\d+):/.exec(ch?.topic || '');
    return m ? m[1] : null;
  };

  async function handleSelect(i) {
    const key = i.values[0];
    const cat = CATS[key];
    if (!cat) return;
    await i.deferReply({ flags: EPHEMERAL });
    // lista wyboru zostaje "zaznaczona" - odswiezamy panel, zeby mozna bylo wybrac ponownie
    i.message.edit(panelMessage()).catch(() => {});

    const guild = i.guild;
    const existing = guild.channels.cache.find(c => ownerOf(c) === i.user.id);
    if (existing) return i.editReply(`❌ Masz już otwarte zgłoszenie: <#${existing.id}>`);

    const nick = (i.user.username || 'user').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20) || 'user';
    const overwrites = [
      { id: guild.id, deny: [P.ViewChannel] },
      { id: i.user.id, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles, P.EmbedLinks] },
      { id: client.user.id, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.EmbedLinks, P.ManageChannels] },
    ];
    if (staffRole) overwrites.push({ id: staffRole, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles, P.EmbedLinks] });
    for (const id of adminIds) overwrites.push({ id, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles, P.EmbedLinks] });

    let ch;
    try {
      ch = await guild.channels.create({
        name: `${key}-${nick}`, type: ChannelType.GuildText,
        parent: env.TICKET_CATEGORY_ID || undefined,
        topic: `ticket:${i.user.id}:${key}`,
        permissionOverwrites: overwrites,
      });
    } catch (e) {
      console.error('Nie udalo sie utworzyc ticketu:', e.message);
      return i.editReply('❌ Nie udało się utworzyć zgłoszenia (sprawdź `TICKET_CATEGORY_ID` i uprawnienie bota „Zarządzanie kanałami”).');
    }

    const embed = new EmbedBuilder()
      .setColor(cat.color)
      .setTitle(`${cat.emoji} Zgłoszenie – ${cat.label}`)
      .setDescription([`Witaj <@${i.user.id}>!`, '', cat.intro].join('\n'))
      .setFooter({ text: serverName });
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket:close').setLabel('Zamknij zgłoszenie').setEmoji('🔒').setStyle(ButtonStyle.Danger),
    );
    await ch.send({
      content: `<@${i.user.id}>${staffRole ? ` <@&${staffRole}>` : ''}`,
      embeds: [embed], components: [row],
      allowedMentions: { users: [i.user.id], roles: staffRole ? [staffRole] : [] },
    }).catch(e => console.error('Wiadomosc w tickecie:', e.message));

    return i.editReply(`✅ Utworzono zgłoszenie: <#${ch.id}>`);
  }

  async function handleClose(i) {
    const owner = ownerOf(i.channel);
    if (!owner) return i.reply({ content: '❌ To nie jest kanał zgłoszenia.', flags: EPHEMERAL });
    const isStaff = !!staffRole && i.member?.roles?.cache?.has(staffRole);
    if (!(i.user.id === owner || isStaff || isAdmin(i))) {
      return i.reply({ content: '❌ Nie masz uprawnień do zamknięcia tego zgłoszenia.', flags: EPHEMERAL });
    }
    await i.reply('🔒 Zgłoszenie zostanie zamknięte za 5 sekund...');
    setTimeout(() => i.channel.delete('Zgłoszenie zamknięte').catch(e => console.error('Usuwanie ticketu:', e.message)), 5000);
  }

  return {
    commands: [ticketCmd],
    handleCommand: async i => {
      if (i.commandName !== 'zgloszenia') return;
      if (!isAdmin(i)) return i.reply({ content: '❌ Nie masz uprawnień.', flags: EPHEMERAL });
      try { return await i.reply(panelMessage()); }
      catch (e) {
        console.error('Panel zgloszen (1. proba):', e);
        // 2. proba: bez baneru (np. zly link w BANNER_URL)
        try { return await i.reply(panelMessage({ noBanner: true })); }
        catch (e2) {
          console.error('Panel zgloszen (2. proba):', e2);
          return i.reply({ content: `❌ Nie udało się wysłać panelu: ${e2.message}`, flags: EPHEMERAL });
        }
      }
    },
    handleSelect,
    handleButton: i => (i.customId === 'ticket:close' ? handleClose(i) : null),
  };
}
