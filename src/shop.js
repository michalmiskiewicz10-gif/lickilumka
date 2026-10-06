import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags,
  PermissionFlagsBits, SlashCommandBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
} from 'discord.js';

const EPHEMERAL = MessageFlags.Ephemeral;

/**
 * Oferty modow (panel /cennik). Nowy mod = nowy wpis w OFFERS (klucz musi byc taki sam jak w src/mods.js).
 */
const OFFERS = {
  autorynek: {
    label: 'AutoRynek', emoji: '🔑', desc: 'Cennik i zakup moda AutoRynek',
    title: 'Oferta AutoRynek',
    subtitle: 'Modyfikacja do Minecraft na wersję 1.21.11',
    prices: [
      ['1 tydzień', '10,00 zł'],
      ['1 miesiąc', '30,00 zł'],
      ['3 miesiące', '60,00 zł'],
      ['Lifetime', '100,00 zł'],
    ],
    addons: [
      { name: 'Reset HWID', price: '10,00 zł', info: 'wyjasnij' },
    ],
    payments: [['BLIK'], ['PayPal'], ['Paysafecard', 'prowizja +10,00 zł']],
  },
};

const HWID_INFO = [
  '**Reset HWID** pozwala przenieść licencję na **inny komputer**.',
  '',
  'Licencja jest przypisana do komputera, na którym została pierwszy raz użyta. Po resecie HWID:',
  '• licencja zostaje odpięta od starego komputera – **na starym przestanie działać**,',
  '• ten sam kod możesz aktywować na nowym komputerze.',
].join('\n');

export function createShop({ client, env, isAdmin, serverName, tickets }) {
  const cmd = new SlashCommandBuilder()
    .setName('cennik').setDescription('Wysyła na kanał panel z ofertą i cennikiem modów')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

  function selectRow() {
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId('shop:select').setPlaceholder('Wybierz moda...')
        .addOptions(Object.entries(OFFERS).map(([value, o]) =>
          new StringSelectMenuOptionBuilder().setLabel(o.label).setDescription(o.desc).setValue(value).setEmoji({ name: o.emoji }))),
    );
  }

  /** Panel jak panel licencji: tytul + lista wyboru moda. */
  function panelMessage() {
    const embed = new EmbedBuilder()
      .setColor(0xf5c542)
      .setTitle(`🛒 CENNIK ${serverName.toUpperCase()}`)
      .setDescription('Wybierz moda z listy poniżej, aby zobaczyć jego ofertę i cennik (widzisz ją tylko Ty).');
    return { embeds: [embed], components: [selectRow()] };
  }

  function offerMessage(id) {
    const o = OFFERS[id];
    const embed = new EmbedBuilder()
      .setColor(0xf5c542)
      .setDescription([
        `## 💣 ${o.title}`,
        `**${o.subtitle}**`,
        '',
        '▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬',
        '### 💳 CENA',
        ...o.prices.map(([n, p]) => `> ${n} — **${p}**`),
        '',
        '▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬',
        '### ➕ ADDONS',
        ...o.addons.map(a => `> ${a.name} — **${a.price}**`),
        '',
        '▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬',
        '### 💸 METODY PŁATNOŚCI',
        ...o.payments.map(([n, note]) => `> **${n}**${note ? ` *(${note})*` : ''}`),
        '',
        '▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬',
        '*Kliknij **Zakup**, aby otworzyć zgłoszenie zakupu.*',
      ].join('\n'));

    const rows = [];
    if (o.addons.some(a => a.info)) {
      rows.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('shop:hwidinfo').setLabel('Co to Reset HWID?').setStyle(ButtonStyle.Secondary),
      ));
    }
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`shop:buy:${id}`).setLabel('ZAKUP').setStyle(ButtonStyle.Success),
    ));
    return { embeds: [embed], components: rows };
  }

  async function handleSelect(i) {
    const id = i.values[0];
    if (!OFFERS[id]) return i.reply({ content: '❌ Ta oferta nie jest już dostępna.', flags: EPHEMERAL });
    i.message.edit({ components: [selectRow()] }).catch(() => {});   // zerujemy zaznaczenie na panelu
    return i.reply({ ...offerMessage(id), flags: EPHEMERAL });
  }

  async function handleButton(i) {
    const [, action, arg] = i.customId.split(':');
    if (action === 'hwidinfo') {
      return i.reply({
        embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('🔄 Co to Reset HWID?').setDescription(HWID_INFO)],
        flags: EPHEMERAL,
      });
    }
    if (action === 'buy') {
      const o = OFFERS[arg];
      if (!o) return i.reply({ content: '❌ Ta oferta nie jest już dostępna.', flags: EPHEMERAL });
      await i.deferReply({ flags: EPHEMERAL });
      const r = await tickets.open(i, 'zakup', { extra: `Zainteresowanie: **${o.label}** (${o.subtitle.replace('Modyfikacja do Minecraft na wersję ', 'MC ')})` });
      return i.editReply(r.message);
    }
  }

  return {
    commands: [cmd],
    handleCommand: async i => {
      if (i.commandName !== 'cennik') return;
      if (!isAdmin(i)) return i.reply({ content: '❌ Nie masz uprawnień.', flags: EPHEMERAL });
      return i.reply(panelMessage());
    },
    handleSelect,
    handleButton,
  };
}
