import {
  ActionRowBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
} from 'discord.js';
import { MODS, DEFAULT_MOD } from './mods.js';
import { versionsFor } from './jars.js';
import { isExpired, sendPanel } from './util.js';

const EPHEMERAL = MessageFlags.Ephemeral;

/**
 * Panel pobierania modow (/pobierz): gracz wybiera moda, potem wersje Minecrafta - dostaje plik .jar.
 * Bot sprawdza licencje: plik dostaje tylko ten, kto ma AKTYWNA (nieunieważnioną i niewygasłą) licencje na wybranego moda.
 * Licencja nie zalezy od wersji Minecrafta - ten sam kod dziala na kazdej wersji (liczy sie tylko mod i HWID).
 */
export function createDownload({ store, isAdmin, serverName, modDir }) {
  const cmd = new SlashCommandBuilder()
    .setName('pobierz').setDescription('Wysyła na kanał panel pobierania modów (wybór moda i wersji Minecrafta)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

  // /mody - dla KAZDEGO gracza: prywatny panel (widzi go tylko wywolujacy), te same kroki i sprawdzanie licencji co w /pobierz
  const modyCmd = new SlashCommandBuilder()
    .setName('mody').setDescription('Pobierz mod: wybierz moda i wersję Minecrafta (wymagana aktywna licencja)');

  const labelOf = id => (MODS[id] || MODS[DEFAULT_MOD]).label;

  function modSelectRow() {
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId('dl:mod').setPlaceholder('Wybierz moda...')
        .addOptions(Object.entries(MODS).map(([value, m]) =>
          new StringSelectMenuOptionBuilder().setLabel(m.label).setDescription(`Pobierz ${m.label}`).setValue(value).setEmoji({ name: m.emoji }))),
    );
  }

  function panelMessage() {
    const embed = new EmbedBuilder().setColor(0x57f287)
      .setTitle(`📥 POBIERANIE MODÓW ${serverName.toUpperCase()}`)
      .setDescription([
        'Wybierz moda z listy poniżej, a potem **wersję Minecrafta** – dostaniesz plik `.jar` (widzisz go tylko Ty).',
        '',
        '• Bot sprawdza, czy masz **aktywną licencję** na wybranego moda.',
        '• Licencja na część modów (np. **PlayerHighlight**) jest przypisana do **jednej wersji** Minecrafta – pobierzesz plik tylko dla tej wersji. Pozostałe mody działają na każdej wersji.',
      ].join('\n'));
    return { embeds: [embed], components: [modSelectRow()] };
  }

  /** Czy gracz ma aktywna licencje na moda? Zwraca { ok } albo { ok:false, message }. */
  function checkAccess(userId, modId) {
    const mine = store.byDiscord(userId).filter(l => !l.revoked);
    const lic = id => mine.filter(l => (l.mod || DEFAULT_MOD) === id);
    const active = id => lic(id).some(l => !isExpired(l));
    if (active(modId)) return { ok: true };

    const label = labelOf(modId);
    const others = Object.keys(MODS).filter(id => id !== modId && active(id)).map(id => `**${labelOf(id)}**`);
    if (lic(modId).length) {   // ma licencje na tego moda, ale wygasla
      const extra = others.length ? ` Aktywną licencję masz tylko na: ${others.join(', ')}.` : '';
      return { ok: false, message: `❌ Twoja licencja na **${label}** wygasła.${extra} Napisz do administracji w zgłoszeniu, aby ją przedłużyć.` };
    }
    if (others.length) {
      return { ok: false, message: `❌ Nie masz aktywnej licencji na **${label}**. Aktywną licencję masz tylko na: ${others.join(', ')}.` };
    }
    return { ok: false, message: `❌ Nie masz żadnej aktywnej licencji (w tym na **${label}**). Jeśli ją kupiłeś, napisz do administracji w zgłoszeniu.` };
  }

  /** Wersje MC dozwolone dla gracza (mody z mcBound). null = wszystkie. */
  function allowedVersions(userId, modId) {
    if (!MODS[modId]?.mcBound) return null;
    const act = store.byDiscord(userId).filter(l => !l.revoked && !isExpired(l) && (l.mod || DEFAULT_MOD) === modId);
    if (act.some(l => !l.mcVersion)) return null;   // starsze licencje bez przypisanej wersji dzialaja wszedzie
    return new Set(act.map(l => l.mcVersion));
  }

  function instruction(modId, ver) {
    const m = MODS[modId];
    const lines = [
      `**Mod ${m.label} dla Minecrafta ${ver}** (Fabric).`,
      '',
      `1. Zainstaluj **Fabric Loader** dla Minecrafta **${ver}**: https://fabricmc.net/use/installer/`,
      `2. Pobierz **Fabric API** dla **${ver}**: https://modrinth.com/mod/fabric-api/versions`,
      '3. Wciśnij `Windows + R`, wpisz `%appdata%\\.minecraft\\mods` i wrzuć tam **oba** pliki (Fabric API i mod).',
      m.openKey
        ? `4. Uruchom grę i naciśnij **${m.openKey}** – pojawi się okno licencji. Wklej kod i kliknij **Aktywuj** (albo wpisz \`${m.cmd} KOD\`).`
        : `4. Uruchom grę – pojawi się okno licencji. Wklej kod i kliknij **Aktywuj** (albo wpisz \`${m.cmd} KOD\`).`,
      '',
      MODS[modId].mcBound
        ? `🔑 Kod licencyjny działa tylko na wersji Minecrafta przypisanej do licencji (na tym samym komputerze), dopóki nie wygaśnie lub nie zostanie unieważniony.`
        : '🔑 Ten sam kod licencyjny działa na każdej wersji Minecrafta (na tym samym komputerze), dopóki licencja nie wygaśnie lub nie zostanie unieważniona.',
    ];
    return new EmbedBuilder().setColor(0x5865f2).setTitle(`📖 ${m.label} – Minecraft ${ver}`).setDescription(lines.join('\n'));
  }

  async function handleModSelect(i) {
    const modId = i.values[0];
    if (!MODS[modId]) return i.reply({ content: '❌ Nieznany mod.', flags: EPHEMERAL });
    i.message.edit({ components: [modSelectRow()] }).catch(() => {});   // zerujemy zaznaczenie na panelu

    const acc = checkAccess(i.user.id, modId);
    if (!acc.ok) return i.reply({ content: acc.message, flags: EPHEMERAL });

    const allowed = allowedVersions(i.user.id, modId);
    const list = versionsFor(modDir, modId).filter(x => !allowed || allowed.has(x.ver));
    if (allowed && !list.length) {
      return i.reply({ content: `⚠️ Twoja licencja na **${labelOf(modId)}** jest przypisana do Minecrafta **${[...allowed].join(', ')}**, ale plik dla tej wersji nie został jeszcze dodany przez administrację.`, flags: EPHEMERAL });
    }
    if (!list.length) {
      return i.reply({ content: `⚠️ Pliki moda **${labelOf(modId)}** nie zostały jeszcze dodane przez administrację. Spróbuj później.`, flags: EPHEMERAL });
    }
    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId(`dl:ver:${modId}`).setPlaceholder('Wybierz wersję Minecrafta...')
        .addOptions(list.map(({ ver, jar }) =>
          new StringSelectMenuOptionBuilder().setLabel(`Minecraft ${ver}`).setDescription(jar.name.slice(0, 100)).setValue(ver))),
    );
    return i.reply({ content: `✅ Masz aktywną licencję na **${labelOf(modId)}**.${allowed ? ` Licencja działa tylko na Minecrafcie **${[...allowed].join(', ')}**.` : ''} Wybierz wersję Minecrafta:`, components: [row], flags: EPHEMERAL });
  }

  async function handleVersionSelect(i) {
    const modId = i.customId.slice('dl:ver:'.length);
    const ver = i.values[0];
    if (!MODS[modId]) return i.reply({ content: '❌ Nieznany mod.', flags: EPHEMERAL });

    const acc = checkAccess(i.user.id, modId);   // sprawdzamy ponownie - licencja mogla w miedzyczasie wygasnac / zostac uniewazniona
    if (!acc.ok) return i.reply({ content: acc.message, flags: EPHEMERAL });

    const allowed = allowedVersions(i.user.id, modId);
    if (allowed && !allowed.has(ver)) return i.reply({ content: `❌ Twoja licencja na **${labelOf(modId)}** działa tylko na Minecrafcie **${[...allowed].join(', ')}** (nie na ${ver}).`, flags: EPHEMERAL });

    const found = versionsFor(modDir, modId).find(x => x.ver === ver);   // plik wybieramy z listy na dysku, nie z tekstu od gracza
    if (!found) return i.reply({ content: `⚠️ Brak pliku **${labelOf(modId)}** dla Minecrafta ${ver}.`, flags: EPHEMERAL });

    return i.reply({
      content: `📦 **${labelOf(modId)}** dla Minecrafta **${ver}** – plik \`${found.jar.name}\` poniżej.`,
      embeds: [instruction(modId, ver)],
      files: [{ attachment: found.jar.path, name: found.jar.name }],
      flags: EPHEMERAL,
    });
  }

  return {
    commands: [cmd, modyCmd],
    handleCommand: async i => {
      if (i.commandName === 'mody') return i.reply({ ...panelMessage(), flags: EPHEMERAL });
      if (i.commandName !== 'pobierz') return;
      if (!isAdmin(i)) return i.reply({ content: '❌ Nie masz uprawnień.', flags: EPHEMERAL });
      return sendPanel(i, panelMessage());
    },
    handleSelect: i => i.customId === 'dl:mod' ? handleModSelect(i) : handleVersionSelect(i),
    checkAccess,
  };
}
