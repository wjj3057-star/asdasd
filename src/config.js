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
  // 봇 소유자(슈퍼관리자) - 라이선스 키 발급 권한. 미지정 시 ADMIN_IDS 로 폴백.
  ownerIds: (process.env.OWNER_IDS || process.env.ADMIN_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  // 요금제 정의 (일수 + 판매가는 통계 추정용 · 환경변수로 조정 가능)
  plans: {
    '1m': { label: '1개월', days: 30, price: parseInt(process.env.PLAN_1M_PRICE || '10000', 10) },
    '3m': { label: '3개월', days: 90, price: parseInt(process.env.PLAN_3M_PRICE || '27000', 10) },
  },
  web: {
    // Pterodactyl/Docker 계열 호스팅(fps.ms 등)은 포트를 SERVER_PORT 로 주입한다.
    // WEB_PORT 를 직접 지정하지 않아도 자동 할당 포트를 쓰도록 폴백한다.
    port: parseInt(process.env.WEB_PORT || process.env.SERVER_PORT || '3000', 10),
    baseUrl: (process.env.WEB_BASE_URL || 'http://localhost:3000').replace(/\/$/, ''),
    sessionSecret: process.env.SESSION_SECRET || 'insecure-dev-secret',
  },
  payment: {
    webhookSecret: process.env.PAYMENT_WEBHOOK_SECRET || '',
    coinWalletAddress: process.env.COIN_WALLET_ADDRESS || '',
    tronGridApiKey: process.env.TRONGRID_API_KEY || '',
  },
  // 로그인 캡차: 키 미설정 시 자체 SVG 캡차, 설정 시 Cloudflare Turnstile
  captcha: {
    turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || '',
    turnstileSecretKey: process.env.TURNSTILE_SECRET_KEY || '',
  },
};

config.isAdmin = (discordId) => config.adminIds.includes(String(discordId));
config.isOwner = (discordId) => config.ownerIds.includes(String(discordId));

module.exports = config;
