'use strict';

// 슬래시 커맨드 등록 스크립트 (npm run register)
const { REST, Routes } = require('discord.js');
const config = require('../config');
const { commands } = require('./commands');

async function register() {
  if (!config.discord.token || !config.discord.clientId) {
    console.error('DISCORD_TOKEN / DISCORD_CLIENT_ID 가 필요합니다.');
    process.exit(1);
  }
  const rest = new REST({ version: '10' }).setToken(config.discord.token);
  try {
    if (config.discord.guildId) {
      await rest.put(
        Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId),
        { body: commands }
      );
      console.log(`✅ 길드(${config.discord.guildId}) 커맨드 등록 완료`);
    } else {
      await rest.put(Routes.applicationCommands(config.discord.clientId), { body: commands });
      console.log('✅ 글로벌 커맨드 등록 완료 (반영까지 최대 1시간)');
    }
  } catch (e) {
    console.error('커맨드 등록 실패:', e);
    process.exit(1);
  }
}

register();

module.exports = { register };
