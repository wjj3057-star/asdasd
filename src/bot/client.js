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
const { setSetting, getSetting, Users } = require('../database/models');
const { won } = require('../util');

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  partials: [Partials.Channel],
});

client.once(Events.ClientReady, async (c) => {
  console.log(`🤖 봇 로그인: ${c.user.tag}`);
  c.user.setActivity('자판기 · /패널');
  // 커맨드 자동 등록 (길드 지정 시)
  try {
    const rest = new REST({ version: '10' }).setToken(config.discord.token);
    if (config.discord.guildId) {
      await rest.put(
        Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId),
        { body: commands }
      );
      console.log('✅ 슬래시 커맨드 등록 완료');
    }
  } catch (e) {
    console.warn('커맨드 자동등록 실패(수동 npm run register 필요):', e.message);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isChatInputCommand()) {
    return handleSlash(interaction);
  }
  return handleInteraction(interaction);
});

async function handleSlash(interaction) {
  const name = interaction.commandName;

  if (name === '패널') {
    if (!isAdmin(interaction)) return interaction.reply({ content: '관리자만 사용할 수 있습니다.', ephemeral: true });
    const panel = buildPanel();
    const msg = await interaction.channel.send(panel);
    setSetting('panel_channel_id', interaction.channel.id);
    setSetting('panel_message_id', msg.id);
    return interaction.reply({ content: '✅ 자판기 패널을 설치했습니다.', ephemeral: true });
  }

  if (name === '패널갱신') {
    if (!isAdmin(interaction)) return interaction.reply({ content: '관리자만 사용할 수 있습니다.', ephemeral: true });
    await refreshPanel(client);
    return interaction.reply({ content: '✅ 패널을 갱신했습니다.', ephemeral: true });
  }

  if (name === '잔액') {
    const u = Users.ensure(interaction.user.id, interaction.user.username);
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
      const after = Users.adjustBalance(target.id, amount, 'admin', memo);
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
    config.isAdmin(interaction.user.id) ||
    interaction.memberPermissions?.has('Administrator')
  );
}

// 설치된 패널 메시지 갱신 (웹 대시보드에서 설정 변경 시 호출)
async function refreshPanel(cl = client) {
  const channelId = getSetting('panel_channel_id');
  const messageId = getSetting('panel_message_id');
  if (!channelId || !messageId) return false;
  try {
    const channel = await cl.channels.fetch(channelId);
    const msg = await channel.messages.fetch(messageId);
    await msg.edit(buildPanel());
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
