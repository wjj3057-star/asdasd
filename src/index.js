'use strict';

const config = require('./config');
const web = require('./web/server');
const chargeService = require('./payments/chargeService');
const coinPoller = require('./payments/coinPoller');
const { Charges } = require('./database/models');

async function main() {
  console.log('=== MungChi Market 자판기 봇 시작 ===');

  // 1) 디스코드 봇 로그인 (토큰 있을 때만)
  let botClient = null;
  let refreshPanel = async () => false;
  try {
    const bot = require('./bot/client');
    botClient = await bot.login();
    refreshPanel = bot.refreshPanel;
    if (botClient) chargeService.setBotClient(botClient);
  } catch (e) {
    console.error('봇 시작 실패(웹 대시보드만 실행):', e.message);
  }

  // 2) 웹 대시보드 시작
  web.start(refreshPanel);

  // 3) 코인 자동확인 폴러
  coinPoller.start();

  // 4) 만료된 충전요청 정리 (5분마다)
  setInterval(() => {
    try {
      Charges.expireOld();
    } catch (e) {
      /* ignore */
    }
  }, 5 * 60 * 1000);

  console.log('✅ 모든 서비스 준비 완료');
}

process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));
process.on('uncaughtException', (e) => console.error('[uncaughtException]', e));

main();
