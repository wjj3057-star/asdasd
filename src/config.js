'use strict';

require('dotenv').config();

function required(name) {
  const v = process.env[name];
  if (!v) {
    console.warn(`[config] 환경변수 ${name} 가 설정되지 않았습니다. .env 파일을 확인하세요.`);
  }
  return v || '';
}

const config = {
  discord: {
    token: required('DISCORD_TOKEN'),
    clientId: required('DISCORD_CLIENT_ID'),
    clientSecret: process.env.DISCORD_CLIENT_SECRET || '',
    guildId: process.env.GUILD_ID || '',
  },
  adminIds: (process.env.ADMIN_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  web: {
    port: parseInt(process.env.WEB_PORT || '3000', 10),
    baseUrl: (process.env.WEB_BASE_URL || 'http://localhost:3000').replace(/\/$/, ''),
    sessionSecret: process.env.SESSION_SECRET || 'insecure-dev-secret',
  },
  payment: {
    webhookSecret: process.env.PAYMENT_WEBHOOK_SECRET || '',
    coinWalletAddress: process.env.COIN_WALLET_ADDRESS || '',
    tronGridApiKey: process.env.TRONGRID_API_KEY || '',
  },
};

config.isAdmin = (discordId) => config.adminIds.includes(String(discordId));

module.exports = config;
