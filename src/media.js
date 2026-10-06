import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, ModalBuilder,
  PermissionFlagsBits, SlashCommandBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';

const EPHEMERAL = MessageFlags.Ephemeral;
const DAY = 86_400_000;
const SESSION_TTL = 15 * 60_000;   // na odpowiedzi w PV gracz ma 15 min. od ostatniej wiadomosci

/**
 * Podania na range Media:
 *  1. /media                      - (admin) wysyla panel z przyciskiem "Aplikuj na Media"
 *  2. klik w przycisk             - bot pisze do gracza na PV i zadaje 3 pytania:
 *                                   nick z Minecrafta -> konto premium -> nazwa konta YT/TikTok
 *  3. PV: [Wyslij apelacje] / [Usun apelacje]
 *  4. kanal administracji         - podanie z przyciskami [Akceptuj] / [Odrzuc]
 *  5. akceptacja -> rola MEDIA_ROLE_ID nadana automatycznie + wiadomosc na PV
 *     odrzucenie -> wiadomosc na PV + cooldown (domyslnie 7 dni) na ponowne podanie
 */
export function createMedia({ client, store, env, isAdmin, serverName }) {
  const roleId = env.MEDIA_ROLE_ID;
  const reviewChannelId = env.MEDIA_REVIEW_CHANNEL_ID;
  const cooldownDays = parseInt(env.MEDIA_COOLDOWN_DAYS || '7', 10) || 7;
  const cooldownMs = cooldownDays * DAY;
  const sessions = new Map();   // userId -> { step, data, exp }
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of sessions) if (v.exp < now) sessions.delete(k);
  }, 60_000).unref();

  const mediaCmd = new SlashCommandBuilder()
    .setName('media').setDescription('Wysyła na kanał panel rekrutacji do ekipy Media')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

  // ================= panel =================
  function panelMessage() {
    const embed = new EmbedBuilder()
      .setColor(0xf5c542)
      .setDescription([
        '## 🎬 Zostań częścią zespołu Media',
        'Masz kanał na **YouTube** lub konto na **TikToku** i regularnie tworzysz materiały? Jeśli chcesz pomóc w promowaniu naszego serwera i zgarnąć dodatkowe korzyści, zapraszamy do ekipy **Media**!',
        '',
        '▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬',
        '### 🎵 TikTok',
        '**Wymagania:**',
        '> • Musisz już posiadać na swoim koncie minimum **4 filmy z tematyką Minecraft** przekraczające **1800 wyświetleń**.',
        '> • **Mile widziane +1000 obserwacji**.',
        '> • Minimum **2 filmy** tygodniowo.',
        '> • Link do naszego Discorda w opisie lub widoczny na filmie.',
        '',
        '### 🎥 YouTube',
        '**Wymagania:**',
        '> • Nie przyjmujemy słabych twórców! Chcesz rangę? Musisz mieć **świetne wyświetlenia** i **dużo subskrypcji**.',
        '> • Minimum **1 film** tygodniowo.',
        '> • Link do naszego Discorda w opisie lub widoczny na filmie.',
        '',
        '### 🎁 Co oferujemy?',
        '⚡ Rangę **Media** na serwerze i Discordzie.',
        '🔑 Licencję na **Dowolny Mod**.',
        '🌟 Dostęp do dodatkowych przywilejów.',
        '',
        '### 📩 Jak się zgłosić?',
        'Kliknij przycisk poniżej – bot napisze do Ciebie na **wiadomości prywatne** i zada kilka pytań.',
        'Na końcu wyślesz swoje podanie do administracji.',
        '',
        '▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬',
        '⚠️ *Administracja zastrzega sobie prawo do odrzucenia wniosku nawet jeśli spełniasz wymagania.*',
      ].join('\n'));
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('media:apply').setLabel('Aplikuj na Media').setStyle(ButtonStyle.Success),
    );
    return { embeds: [embed], components: [row] };
  }

  // ================= pytania na PV =================
  const qEmbed = (n, title, text) => new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`📝 Pytanie ${n}/3 – ${title}`)
    .setDescription(text)
    .setFooter({ text: `${serverName} • Podanie na Media` });

  const q1 = () => ({ embeds: [qEmbed(1, 'Nick z Minecrafta', 'Podaj swój **nick z Minecrafta** (napisz go w odpowiedzi na tę wiadomość).')] });
  const q2 = () => ({
    embeds: [qEmbed(2, 'Konto premium', 'Czy posiadasz **konto premium** Minecrafta? Kliknij przycisk poniżej (możesz też napisać „tak” albo „nie”).')],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('media:prem:yes').setLabel('Tak').setEmoji('✅').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('media:prem:no').setLabel('Nie').setEmoji('❌').setStyle(ButtonStyle.Danger),
    )],
  });
  const q3 = () => ({ embeds: [qEmbed(3, 'Konto YouTube / TikTok', 'Podaj **nazwę swojego konta na YouTube lub TikToku** (może być też link do profilu).')] });

  function summary(data) {
    const embed = new EmbedBuilder()
      .setColor(0xf5c542)
      .setTitle('📋 Twoje podanie na Media')
      .setDescription('Sprawdź dane. Kliknij **Wyślij apelację**, aby przekazać je administracji, albo **Usuń apelację**, aby zrezygnować.')
      .addFields(
        { name: 'Nick z Minecrafta', value: `\`${data.nick}\``, inline: true },
        { name: 'Konto premium', value: data.premium ? '✅ Tak' : '❌ Nie', inline: true },
        { name: 'Konto YouTube / TikTok', value: data.acct },
      );
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('media:send').setLabel('Wyślij apelację').setEmoji('📨').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('media:cancel').setLabel('Usuń apelację').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
    );
    return { embeds: [embed], components: [row] };
  }

  /** Czy gracz moze teraz zlozyc podanie? Zwraca tekst bledu albo null. */
  function blocker(userId, member = null) {
    if (roleId && member?.roles?.cache?.has(roleId)) return '✅ Masz już rangę **Media**.';
    if (store.pendingMedia(userId)) return '⏳ Twoje podanie czeka już na rozpatrzenie przez administrację.';
    const cd = store.getMediaCd(userId);
    if (cd > Date.now()) {
      const s = Math.ceil(cd / 1000);
      return `⛔ Twoje poprzednie podanie zostało odrzucone. Ponownie możesz aplikować <t:${s}:R> (<t:${s}:F>).`;
    }
    return null;
  }

  async function startApply(i) {
    if (!reviewChannelId) {
      return i.reply({ content: '❌ System Media nie jest jeszcze skonfigurowany (administracja musi ustawić `MEDIA_REVIEW_CHANNEL_ID`).', flags: EPHEMERAL });
    }
    const uid = i.user.id;
    const block = blocker(uid, i.member);
    if (block) return i.reply({ content: block, flags: EPHEMERAL });

    sessions.set(uid, { step: 'nick', data: {}, exp: Date.now() + SESSION_TTL });
    try { await i.user.send(q1()); }
    catch {
      sessions.delete(uid);
      return i.reply({ content: '❌ Nie mogę wysłać Ci wiadomości prywatnej. Włącz wiadomości prywatne od członków serwera (Ustawienia serwera → Prywatność) i spróbuj ponownie.', flags: EPHEMERAL });
    }
    return i.reply({ content: '📩 Wysłałem Ci wiadomość prywatną – odpowiedz tam na pytania.', flags: EPHEMERAL });
  }

  /** Odpowiedzi tekstowe gracza na PV. */
  async function onMessage(message) {
    if (message.guildId || message.author.bot) return;
    const s = sessions.get(message.author.id);
    if (!s) return;
    if (s.exp < Date.now()) { sessions.delete(message.author.id); return; }
    s.exp = Date.now() + SESSION_TTL;
    const text = (message.content || '').trim();
    const dm = payload => message.author.send(payload).catch(() => {});

    if (s.step === 'nick') {
      if (!/^[A-Za-z0-9_]{3,16}$/.test(text)) {
        return dm('❌ To nie wygląda na poprawny nick z Minecrafta (3–16 znaków: litery, cyfry, `_`). Spróbuj jeszcze raz.');
      }
      s.data.nick = text; s.step = 'premium';
      return dm(q2());
    }
    if (s.step === 'premium') {
      const t = text.toLowerCase();
      if (['tak', 't', 'yes', 'y'].includes(t)) s.data.premium = true;
      else if (['nie', 'n', 'no'].includes(t)) s.data.premium = false;
      else return dm('Kliknij jeden z przycisków **Tak** / **Nie** (albo napisz „tak” lub „nie”).');
      s.step = 'acct';
      return dm(q3());
    }
    if (s.step === 'acct') {
      if (!text) return dm('❌ Napisz nazwę konta (albo link do profilu) jako zwykłą wiadomość tekstową.');
      if (text.length > 200) return dm('❌ Za długo – maksymalnie 200 znaków. Spróbuj skrócić.');
      s.data.acct = text; s.step = 'confirm';
      return dm(summary(s.data));
    }
  }

  async function premiumButton(i, yes) {
    const s = sessions.get(i.user.id);
    if (!s || s.step !== 'premium') {
      return i.update({ content: '⌛ Ta sesja wygasła. Kliknij **Aplikuj na Media** na serwerze jeszcze raz.', embeds: [], components: [] });
    }
    s.data.premium = yes; s.step = 'acct'; s.exp = Date.now() + SESSION_TTL;
    await i.update({ embeds: [qEmbed(2, 'Konto premium', `Twoja odpowiedź: **${yes ? 'Tak' : 'Nie'}**`)], components: [] });
    await i.user.send(q3()).catch(() => {});
  }

  async function cancelApplication(i) {
    sessions.delete(i.user.id);
    return i.update({
      embeds: [new EmbedBuilder().setColor(0x808080).setTitle('🗑️ Apelacja usunięta').setDescription('Twoje podanie zostało usunięte i nie trafiło do administracji. Możesz złożyć nowe w dowolnym momencie.')],
      components: [],
    });
  }

  // ================= wyslanie do administracji =================
  async function sendApplication(i) {
    const uid = i.user.id;
    const s = sessions.get(uid);
    if (!s || s.step !== 'confirm') {
      return i.update({ content: '⌛ Ta sesja wygasła. Kliknij **Aplikuj na Media** na serwerze jeszcze raz.', embeds: [], components: [] });
    }
    const block = blocker(uid);
    if (block) { sessions.delete(uid); return i.update({ content: block, embeds: [], components: [] }); }

    const { nick, premium, acct } = s.data;
    const embed = new EmbedBuilder()
      .setColor(0xf5c542)
      .setTitle('📸 Nowe podanie – Media')
      .setThumbnail(i.user.displayAvatarURL({ size: 256 }))
      .addFields(
        { name: 'Gracz Discord', value: `<@${uid}> (\`${i.user.username}\`)` },
        { name: 'Nick z Minecrafta', value: `\`${nick}\``, inline: true },
        { name: 'Konto premium', value: premium ? '✅ Tak' : '❌ Nie', inline: true },
        { name: 'Konto YouTube / TikTok', value: acct },
        { name: 'Status', value: '🟡 Oczekuje na decyzję' },
      )
      .setTimestamp();
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`media:acc:${uid}`).setLabel('Akceptuj').setEmoji('✅').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`media:rej:${uid}`).setLabel('Odrzuć').setEmoji('❌').setStyle(ButtonStyle.Danger),
    );

    let msg;
    try {
      const ch = await client.channels.fetch(reviewChannelId);
      msg = await ch.send({ embeds: [embed], components: [row] });
    } catch (e) {
      console.error('Podanie Media - wysylka na kanal administracji:', e.message);
      return i.reply({ content: '❌ Nie udało się wysłać podania do administracji. Spróbuj za chwilę albo napisz do administracji.', flags: EPHEMERAL });
    }
    store.putMedia({ id: msg.id, userId: uid, nick, premium, acct, status: 'pending', createdAt: Date.now() });
    sessions.delete(uid);

    return i.update({
      embeds: [new EmbedBuilder().setColor(0x57f287).setTitle('✅ Apelacja wysłana')
        .setDescription('Twoje podanie trafiło do administracji. Odpowiedź dostaniesz w wiadomości prywatnej – pamiętaj, aby mieć je włączone.')],
      components: [],
    });
  }

  // ================= decyzja administracji =================
  const setStatus = (embed, value) => embed.setFields((embed.data.fields || []).map(f => (f.name === 'Status' ? { ...f, value } : f)));

  async function dmUser(userId, payload) {
    try { const u = await client.users.fetch(userId); await u.send(payload); return true; }
    catch { return false; }
  }

  async function accept(i, uid) {
    if (!isAdmin(i)) return i.reply({ content: '❌ Nie masz uprawnień.', flags: EPHEMERAL });
    const app = store.pendingMedia(uid);
    if (!app) return i.reply({ content: 'To podanie zostało już rozpatrzone.', flags: EPHEMERAL });
    if (!roleId) return i.reply({ content: '❌ Brak `MEDIA_ROLE_ID` w konfiguracji – bot nie wie, jaką rangę nadać.', flags: EPHEMERAL });

    let member;
    try { member = await i.guild.members.fetch(uid); }
    catch { return i.reply({ content: '❌ Ten gracz nie jest już na serwerze.', flags: EPHEMERAL }); }
    try { await member.roles.add(roleId, `Podanie Media zaakceptowane przez ${i.user.username}`); }
    catch (e) {
      console.error('Nadanie roli Media:', e.message);
      return i.reply({ content: `❌ Nie udało się nadać rangi: ${e.message}\n(Rola bota musi być **wyżej** na liście niż rola Media i musi mieć „Zarządzanie rolami”.)`, flags: EPHEMERAL });
    }

    app.status = 'accepted'; app.decidedBy = i.user.id; app.decidedAt = Date.now();
    store.putMedia(app);
    const embed = setStatus(EmbedBuilder.from(i.message.embeds[0]).setColor(0x57f287), `✅ Zaakceptowano przez <@${i.user.id}> – ranga nadana`);
    await i.update({ embeds: [embed], components: [] });

    const sent = await dmUser(uid, { embeds: [new EmbedBuilder().setColor(0x57f287).setTitle('🎉 Podanie zaakceptowane!')
      .setDescription(`Twoje podanie na **Media** w **${serverName}** zostało zaakceptowane. Otrzymałeś rangę **Media** – witamy w ekipie!`)] });
    if (!sent) i.followUp({ content: '⚠️ Ranga nadana, ale gracz ma zablokowane wiadomości prywatne.', flags: EPHEMERAL }).catch(() => {});
  }

  function rejectModal(i, uid) {
    if (!isAdmin(i)) return i.reply({ content: '❌ Nie masz uprawnień.', flags: EPHEMERAL });
    if (!store.pendingMedia(uid)) return i.reply({ content: 'To podanie zostało już rozpatrzone.', flags: EPHEMERAL });
    const modal = new ModalBuilder().setCustomId(`mediarej:${uid}`).setTitle('Odrzucenie podania – Media').addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('powod').setLabel('Powód odrzucenia (opcjonalnie, zobaczy go gracz)')
          .setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(500),
      ),
    );
    return i.showModal(modal);
  }

  async function handleModal(i) {
    if (!i.customId.startsWith('mediarej:')) return;
    if (!isAdmin(i)) return i.reply({ content: '❌ Nie masz uprawnień.', flags: EPHEMERAL });
    const uid = i.customId.slice('mediarej:'.length);
    const app = store.pendingMedia(uid);
    if (!app) return i.reply({ content: 'To podanie zostało już rozpatrzone.', flags: EPHEMERAL });

    const reason = i.fields.getTextInputValue('powod').trim();
    const until = Date.now() + cooldownMs;
    app.status = 'rejected'; app.decidedBy = i.user.id; app.decidedAt = Date.now(); app.reason = reason || null;
    store.putMedia(app);
    store.setMediaCd(uid, until);

    if (i.isFromMessage()) {
      const embed = setStatus(EmbedBuilder.from(i.message.embeds[0]).setColor(0xed4245), `❌ Odrzucono przez <@${i.user.id}>`);
      if (reason) embed.addFields({ name: 'Powód', value: reason });
      await i.update({ embeds: [embed], components: [] });
    } else {
      await i.reply({ content: '❌ Podanie odrzucone.', flags: EPHEMERAL });
    }

    const s = Math.floor(until / 1000);
    const dmEmbed = new EmbedBuilder().setColor(0xed4245).setTitle('❌ Podanie odrzucone')
      .setDescription([
        `Twoje podanie na **Media** w **${serverName}** zostało odrzucone.`,
        reason ? `\n**Powód:** ${reason}` : '',
        `\nPonownie możesz aplikować po **${cooldownDays} dniach** – <t:${s}:F> (<t:${s}:R>).`,
      ].join(''));
    const sent = await dmUser(uid, { embeds: [dmEmbed] });
    if (!sent) i.followUp({ content: '⚠️ Nie udało się wysłać gracza wiadomości o odrzuceniu (zablokowane PW). Cooldown i tak został ustawiony.', flags: EPHEMERAL }).catch(() => {});
  }

  async function handleButton(i) {
    const [, action, arg] = i.customId.split(':');
    if (action === 'apply') return startApply(i);
    if (action === 'prem') return premiumButton(i, arg === 'yes');
    if (action === 'send') return sendApplication(i);
    if (action === 'cancel') return cancelApplication(i);
    if (action === 'acc') return accept(i, arg);
    if (action === 'rej') return rejectModal(i, arg);
  }

  return {
    commands: [mediaCmd],
    onMessage,
    handleButton,
    handleModal,
    handleCommand: async i => {
      if (i.commandName !== 'media') return;
      if (!isAdmin(i)) return i.reply({ content: '❌ Nie masz uprawnień.', flags: EPHEMERAL });
      return i.reply(panelMessage());
    },
  };
}
