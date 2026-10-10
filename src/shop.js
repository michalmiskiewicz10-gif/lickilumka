import { sendPanel } from './util.js';
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, EmbedBuilder, MessageFlags,
  PermissionFlagsBits, SectionBuilder, SeparatorBuilder, SeparatorSpacingSize, SlashCommandBuilder,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder, TextDisplayBuilder,
} from 'discord.js';

const EPHEMERAL = MessageFlags.Ephemeral;

/**
 * Oferty modow (panel /cennik). Nowy mod = nowy wpis w OFFERS (klucz musi byc taki sam jak w src/mods.js).
 */
const OFFERS = {
  botyluma: {
    label: 'BotyLuma', emoji: '🤖', desc: 'Cennik i zakup moda BotyLuma',
    title: 'Oferta BotyLuma', subtitle: 'Automat BotyLuma do Minecraft 1.21.11',
    prices: [
      ['1 tydzień', '10,00 zł'],
      ['1 miesiąc', '30,00 zł'],
      ['3 miesiące', '60,00 zł'],
      ['Lifetime', '100,00 zł'],
    ],
    addons: [{ name: 'Reset HWID', price: '5,00 zł', info: true }],
    payments: [['BLIK'], ['PayPal'], ['Paysafecard', 'prowizja +10,00 zł']],
  },
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
      { name: 'Reset HWID', price: '5,00 zł', info: true },
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

  /**
   * Oferta jako kontener (komponenty V2): tekst + separatory, a przy addonie przycisk "Co to?" PO PRAWEJ stronie linii
   * oraz zielony przycisk ZAKUP na dole. Wiadomosci V2 nie moga miec embedow ani zwyklego `content`.
   */
  function offerMessage(id) {
    const o = OFFERS[id];
    const text = c => new TextDisplayBuilder().setContent(c);
    const sep = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);

    const box = new ContainerBuilder().setAccentColor(0xf5c542)
      .addTextDisplayComponents(text(`## ${o.emoji} ${o.title}\n**${o.subtitle}**`))
      .addSeparatorComponents(sep())
      .addTextDisplayComponents(text(['### 💳 CENA', ...o.prices.map(([n, p]) => `> ${n} — **${p}**`)].join('\n')))
      .addSeparatorComponents(sep())
      .addTextDisplayComponents(text('### ➕ ADDONS'));

    for (const a of o.addons) {
      const line = text(`> ${a.name} — **${a.price}**`);
      if (a.info) {
        box.addSectionComponents(new SectionBuilder().addTextDisplayComponents(line)
          .setButtonAccessory(new ButtonBuilder().setCustomId('shop:hwidinfo').setLabel('Co to?').setStyle(ButtonStyle.Secondary)));
      } else {
        box.addTextDisplayComponents(line);
      }
    }

    box.addSeparatorComponents(sep())
      .addTextDisplayComponents(text(['### 💸 METODY PŁATNOŚCI', ...o.payments.map(([n, note]) => `> **${n}**${note ? ` *(${note})*` : ''}`)].join('\n')))
      .addSeparatorComponents(sep())
      .addTextDisplayComponents(text('*Kliknij **Zakup**, aby otworzyć zgłoszenie zakupu.*'))
      .addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`shop:buy:${id}`).setLabel('ZAKUP').setStyle(ButtonStyle.Success),
      ));

    return { components: [box], flags: MessageFlags.IsComponentsV2 | EPHEMERAL };
  }

  async function handleSelect(i) {
    const id = i.values[0];
    if (!OFFERS[id]) return i.reply({ content: '❌ Ta oferta nie jest już dostępna.', flags: EPHEMERAL });
    i.message.edit({ components: [selectRow()] }).catch(() => {});   // zerujemy zaznaczenie na panelu
    return i.reply(offerMessage(id));
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
      return sendPanel(i, panelMessage());
    },
    handleSelect,
    handleButton,
  };
}
