'use strict';

const config = require('../config');
const { Coins } = require('../database/models');
const { handleCoinNotification } = require('./chargeService');

// USDT-TRC20 컨트랙트 (TRON)
const USDT_TRC20 = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

let seenTx = new Set();
let timer = null;

// TRON USDT-TRC20 지갑 폴링 (자동확인). LTC/SOL/USDT-BSC 는 웹훅/수동 승인 사용.
async function pollTronWallet(coin) {
  const wallet = coin.wallet;
  if (!wallet) return;
  try {
    const url = `https://api.trongrid.io/v1/accounts/${wallet}/transactions/trc20?limit=20&contract_address=${USDT_TRC20}`;
    const headers = { accept: 'application/json' };
    if (config.payment.tronGridApiKey) headers['TRON-PRO-API-KEY'] = config.payment.tronGridApiKey;
    const res = await fetch(url, { headers });
    if (!res.ok) return;
    const json = await res.json();
    for (const tx of json.data || []) {
      if (tx.to !== wallet) continue; // 입금만
      const key = `${coin.id}:${tx.transaction_id}`;
      if (seenTx.has(key)) continue;
      seenTx.add(key);
      const decimals = tx.token_info?.decimals ?? 6;
      const amount = Number(tx.value) / Math.pow(10, decimals);
      const amountStr = amount.toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
      handleCoinNotification({
        amount: amountStr,
        symbol: coin.symbol,
        network: coin.network,
        txid: tx.transaction_id,
      });
    }
    if (seenTx.size > 4000) seenTx = new Set([...seenTx].slice(-2000));
  } catch (e) {
    // 네트워크 오류 무시 (다음 주기 재시도)
  }
}

function isTrc20(coin) {
  return String(coin.network).toUpperCase().replace(/\s|-/g, '') === 'TRC20';
}

async function pollAll() {
  const coins = Coins.enabledAll().filter(isTrc20);
  for (const coin of coins) {
    // 순차 폴링 (레이트리밋 회피)
    // eslint-disable-next-line no-await-in-loop
    await pollTronWallet(coin);
  }
}

function start() {
  const trc20 = Coins.enabledAll().filter(isTrc20);
  // 지갑이 없어도 폴러는 항상 켠다 (나중에 서버가 지갑을 등록하면 자동 반영)
  console.log(
    trc20.length
      ? `[coin] TRC20 자동확인 폴링 시작 (${trc20.length}개 지갑) · 그 외 네트워크는 웹훅/수동`
      : '[coin] TRC20 지갑 대기 중 - 등록되면 자동 폴링 (그 외 네트워크는 웹훅/수동)'
  );
  timer = setInterval(pollAll, 30 * 1000);
  pollAll();
}

function stop() {
  if (timer) clearInterval(timer);
}

module.exports = { start, stop };
