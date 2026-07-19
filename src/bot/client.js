'use strict';

const {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  REST,
  Routes,
  EmbedBuilder,
} = require('discord.js');
const config = require('../config');
const { commands } = require('./commands');
const { handleInteraction } = require('./router');
const { buildPanel } = require('./embeds');
const { setSetting, getSetting, getAllSettings, Users, Guilds, LicenseKeys } = require('../database/models');
const { won } = require('../util');

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  partials: [Partials.Channel],
});

client.once(Events.ClientReady, async (c) => {
  console.log(`🤖 봇 로그인: ${c.user.tag}`);
  c.user.setActivity('자판기 · /인증');
  // 이미 들어가 있는 서버들 등록
  for (const [, g] of c.guilds.cache) Guilds.ensure(g.id, g.name);
  // 커맨드 등록 (글로벌 + 지정 길드)
  try {
    const rest = new REST({ version: '10' }).setToken(config.discord.token);
    await rest.put(Routes.applicationCommands(config.discord.clientId), { body: commands });
    if (config.discord.guildId) {
      await rest.put(
        Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId),
        { body: commands }
      );
    }
    console.log('✅ 슬래시 커맨드 등록 완료');
  } catch (e) {
    console.warn('커맨드 자동등록 실패(수동 npm run register 필요):', e.message);
  }
});

// 새 서버 초대 시 등록
client.on(Events.GuildCreate, (guild) => {
  Guilds.ensure(guild.id, guild.name);
  console.log(`➕ 새 서버 추가: ${guild.name} (${guild.id})`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isChatInputCommand()) {
    return handleSlash(interaction);
  }
  return handleInteraction(interaction);
});

async function handleSlash(interaction) {
  const name = interaction.commandName;
  const gid = interaction.guildId;
  if (gid) Guilds.ensure(gid, interaction.guild?.name || '');

  /* ---- 라이선스: 소유자 키 발급 ---- */
  if (name === '키생성') {
    if (!config.isOwner(interaction.user.id)) {
      return interaction.reply({ content: '⛔ 봇 소유자만 사용할 수 있습니다.', ephemeral: true });
    }
    const plan = interaction.options.getString('요금제');
    const count = Math.max(1, Math.min(20, interaction.options.getInteger('수량') || 1));
    const memo = interaction.options.getString('메모') || '';
    const keys = LicenseKeys.createBatch(plan, count, interaction.user.id, memo);
    const label = config.plans[plan]?.label || plan;
    const body = keys.map((k) => `\`${k}\``).join('\n');
    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle(`🔑 ${label} 라이선스 키 ${count}개 발급`)
      .setDescription(`${body}\n\n서버 관리자가 해당 서버에서 \`/인증 <키>\` 로 등록하면 활성화됩니다.`)
      .setFooter({ text: '일회용 · 등록 시 소멸' });
    try {
      await interaction.user.send({ embeds: [embed] });
      return interaction.reply({ content: `✅ ${count}개 키를 DM으로 보냈습니다.`, ephemeral: true });
    } catch (e) {
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
  }

  /* ---- 라이선스: 서버 인증(키 등록) ---- */
  if (name === '인증') {
    if (!isAdmin(interaction)) return interaction.reply({ content: '서버 관리자만 사용할 수 있습니다.', ephemeral: true });
    const key = interaction.options.getString('키');
    const r = LicenseKeys.redeem(key, gid, interaction.user.id, interaction.guild?.name || '');
    if (!r.ok) {
      const msg = {
        FORMAT: '⚠️ 키는 15자리 숫자입니다. 다시 확인해 주세요.',
        INVALID: '❌ 존재하지 않는 키입니다.',
        USED: '❌ 이미 사용된 키입니다.',
        BAD_PLAN: '⚠️ 알 수 없는 요금제입니다.',
      }[r.error] || '⚠️ 처리 중 오류가 발생했습니다.';
      return interaction.reply({ content: msg, ephemeral: true });
    }
    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle('✅ 구독이 활성화되었습니다')
      .setDescription('이제 이 서버에서 자판기 기능을 사용할 수 있습니다.\n`/패널` 로 자판기를 설치하세요.')
      .addFields(
        { name: '요금제', value: r.planLabel, inline: true },
        { name: '만료일', value: `<t:${Math.floor(r.expires_at / 1000)}:F>`, inline: true }
      );
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  /* ---- 라이선스: 구독 상태 ---- */
  if (name === '구독') {
    const g = Guilds.get(gid);
    const active = Guilds.isActive(gid);
    const embed = new EmbedBuilder()
      .setColor(active ? 0x57f287 : 0xed4245)
      .setTitle(active ? '🟢 구독 활성' : '🔴 구독 없음/만료')
      .setDescription(active
        ? '이 서버는 자판기 기능을 사용할 수 있습니다.'
        : '`/인증 <키>` 로 라이선스를 등록해 주세요.');
    if (g && g.expires_at) {
      embed.addFields(
        { name: '요금제', value: config.plans[g.plan]?.label || g.plan || '-', inline: true },
        { name: '만료', value: `<t:${Math.floor(g.expires_at / 1000)}:R>`, inline: true }
      );
    }
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  // 이하 자판기 기능 — 구독 필요
  const needLicense = ['패널', '패널갱신', '충전지급'];
  if (needLicense.includes(name) && !Guilds.isActive(gid)) {
    return interaction.reply({ content: '🔒 구독이 필요합니다. `/인증 <키>` 로 라이선스를 먼저 등록하세요.', ephemeral: true });
  }

  if (name === '패널') {
    if (!isAdmin(interaction)) return interaction.reply({ content: '관리자만 사용할 수 있습니다.', ephemeral: true });
    const panel = buildPanel(gid);
    const msg = await interaction.channel.send(panel);
    setSetting(gid, 'panel_channel_id', interaction.channel.id);
    setSetting(gid, 'panel_message_id', msg.id);
    return interaction.reply({ content: '✅ 자판기 패널을 설치했습니다.', ephemeral: true });
  }

  if (name === '패널갱신') {
    if (!isAdmin(interaction)) return interaction.reply({ content: '관리자만 사용할 수 있습니다.', ephemeral: true });
    const ok = await refreshPanel(gid);
    return interaction.reply({ content: ok ? '✅ 패널을 갱신했습니다.' : '⚠️ 설치된 패널이 없습니다. /패널 로 먼저 설치하세요.', ephemeral: true });
  }

  if (name === '잔액') {
    const u = Users.ensure(gid, interaction.user.id, interaction.user.username);
    return interaction.reply({
      embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('💰 내 잔액').setDescription(`**${won(u.balance)}**`)],
      ephemeral: true,
    });
  }

  if (name === '충전지급') {
    if (!isAdmin(interaction)) return interaction.reply({ content: '관리자만 사용할 수 있습니다.', ephemeral: true });
    const target = interaction.options.getUser('유저');
    const amount = interaction.options.getInteger('금액');
    const memo = interaction.options.getString('메모') || '관리자 지급';
    try {
      const after = Users.adjustBalance(gid, target.id, amount, 'admin', memo);
      return interaction.reply({
        content: `✅ <@${target.id}> 잔액 ${amount > 0 ? '+' : ''}${won(amount)} 처리. 현재 잔액 ${won(after)}`,
        ephemeral: true,
      });
    } catch (e) {
      return interaction.reply({ content: '⚠️ 잔액이 부족하여 차감할 수 없습니다.', ephemeral: true });
    }
  }
}

function isAdmin(interaction) {
  return (
    config.isOwner(interaction.user.id) ||
    interaction.memberPermissions?.has('Administrator')
  );
}

// 설치된 패널 메시지 갱신 (길드별)
async function refreshPanel(gid) {
  if (!gid) return false;
  const channelId = getSetting(gid, 'panel_channel_id');
  const messageId = getSetting(gid, 'panel_message_id');
  if (!channelId || !messageId) return false;
  try {
    const channel = await client.channels.fetch(channelId);
    const msg = await channel.messages.fetch(messageId);
    await msg.edit(buildPanel(gid));
    return true;
  } catch (e) {
    console.warn('패널 갱신 실패:', e.message);
    return false;
  }
}

async function login() {
  if (!config.discord.token) {
    console.error('❌ DISCORD_TOKEN 미설정 - 봇을 시작할 수 없습니다.');
    return null;
  }
  await client.login(config.discord.token);
  return client;
}

module.exports = { client, login, refreshPanel };
