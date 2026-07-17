'use strict';

const config = require('../config');
const { getSetting } = require('../database/models');
const { handleCoinNotification } = require('./chargeService');

// USDT-TRC20 컨트랙트 (TRON)
const USDT_TRC20 = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

let seenTx = new Set();
let timer = null;

async function pollTron() {
  const wallet = config.payment.coinWalletAddress || getSetting('coin_wallet');
  if (!wallet) return;
  try {
    const url = `https://api.trongrid.io/v1/accounts/${wallet}/transactions/trc20?limit=20&contract_address=${USDT_TRC20}`;
    const headers = { accept: 'application/json' };
    if (config.payment.tronGridApiKey)
      headers['TRON-PRO-API-KEY'] = config.payment.tronGridApiKey;
    const res = await fetch(url, { headers });
    if (!res.ok) return;
    const json = await res.json();
    for (const tx of json.data || []) {
      if (tx.to !== wallet) continue; // 입금만
      if (seenTx.has(tx.transaction_id)) continue;
      seenTx.add(tx.transaction_id);
      const decimals = tx.token_info?.decimals ?? 6;
      const amount = Number(tx.value) / Math.pow(10, decimals);
      // 소수점 정리 (요청 시 붙인 고유 꼬리와 매칭)
      const amountStr = amount.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
      handleCoinNotification({
        amount: amountStr,
        symbol: 'USDT',
        txid: tx.transaction_id,
      });
    }
    // 메모리 관리
    if (seenTx.size > 2000) seenTx = new Set([...seenTx].slice(-1000));
  } catch (e) {
    // 네트워크 오류 무시 (다음 주기 재시도)
  }
}

function start() {
  const wallet = config.payment.coinWalletAddress || getSetting('coin_wallet');
  if (!wallet) {
    console.log('[coin] 지갑 주소 미설정 - 코인 자동 폴링 비활성화 (웹훅/수동 승인만 사용)');
    return;
  }
  console.log(`[coin] TRON USDT 자동확인 폴링 시작 (지갑 ${wallet.slice(0, 8)}...)`);
  timer = setInterval(pollTron, 30 * 1000);
  pollTron();
}

function stop() {
  if (timer) clearInterval(timer);
}

module.exports = { start, stop };
