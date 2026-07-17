'use strict';

const { Users, Charges, BankNotifications } = require('../database/models');
const { won, parseAmount } = require('../util');

// 봇 인스턴스는 index.js에서 주입 (DM 알림용)
let botClient = null;
function setBotClient(client) {
  botClient = client;
}

async function notifyUser(discordId, embed) {
  if (!botClient) return;
  try {
    const user = await botClient.users.fetch(discordId);
    await user.send({ embeds: [embed] });
  } catch (e) {
    // DM 차단 등 - 무시
  }
}

// 충전요청 승인 → 잔액반영 + 유저 DM 알림. (웹훅 자동/관리자 수동 공용)
function approveCharge(chargeId, memo = '') {
  const charge = Charges.get(chargeId);
  if (!charge) return { ok: false, error: 'NOT_FOUND' };
  if (charge.status !== 'pending')
    return { ok: false, error: 'ALREADY_RESOLVED', charge };

  const after = Users.adjustBalance(
    charge.discord_id,
    charge.amount,
    'charge',
    `${charge.method === 'coin' ? '코인' : '계좌'}충전 #${charge.id}${memo ? ' · ' + memo : ''}`
  );
  Charges.setStatus(chargeId, 'approved', memo || '자동승인');

  notifyUser(charge.discord_id, {
    color: 0x57f287,
    title: '✅ 충전이 완료되었습니다',
    fields: [
      { name: '충전 방식', value: charge.method === 'coin' ? '코인충전' : '계좌충전', inline: true },
      { name: '충전 금액', value: won(charge.amount), inline: true },
      { name: '현재 잔액', value: won(after), inline: true },
    ],
    timestamp: new Date().toISOString(),
  });

  return { ok: true, charge, balance: after };
}

function rejectCharge(chargeId, memo = '반려') {
  const charge = Charges.get(chargeId);
  if (!charge) return { ok: false, error: 'NOT_FOUND' };
  if (charge.status !== 'pending') return { ok: false, error: 'ALREADY_RESOLVED' };
  Charges.setStatus(chargeId, 'rejected', memo);
  notifyUser(charge.discord_id, {
    color: 0xed4245,
    title: '❌ 충전 요청이 반려되었습니다',
    description: memo || '관리자에 의해 반려되었습니다.',
    timestamp: new Date().toISOString(),
  });
  return { ok: true, charge };
}

/**
 * 은행 입금 알림 처리 (PG 미사용 자동충전 핵심)
 * 입금 문자/푸시를 포워딩 앱이 보내오면 입금자명+금액으로 대기중인 충전요청을 매칭해 자동 승인.
 * payload: { raw, depositor, amount }
 */
function handleBankNotification(payload) {
  const depositor = (payload.depositor || '').trim();
  const amount =
    payload.amount != null ? Number(payload.amount) : parseAmount(payload.raw);

  const match =
    amount != null ? Charges.findPendingAccountMatch(depositor, amount) : null;

  BankNotifications.create({
    raw: payload.raw || '',
    depositor,
    amount,
    matched: match ? 1 : 0,
    charge_id: match ? match.id : null,
  });

  if (!match) {
    return { ok: false, matched: false, reason: 'NO_MATCH', amount, depositor };
  }
  const res = approveCharge(match.id, `자동매칭 · 입금자 ${depositor || '미상'}`);
  return { ok: res.ok, matched: true, charge: match, balance: res.balance };
}

/**
 * 코인 입금 알림 처리. payload: { amount, symbol, network, txid }
 * 고유 코인수량(+심볼/네트워크)으로 대기중인 코인 충전요청을 매칭.
 */
function handleCoinNotification(payload) {
  const amountStr = String(payload.amount);
  const match = Charges.findPendingCoinMatch(amountStr, payload.symbol, payload.network);
  if (!match) return { ok: false, matched: false, reason: 'NO_MATCH' };
  const res = approveCharge(
    match.id,
    `${match.coin_symbol}(${match.coin_network}) 자동확인 · ${payload.txid || ''}`
  );
  return { ok: res.ok, matched: true, charge: match, balance: res.balance };
}

module.exports = {
  setBotClient,
  notifyUser,
  approveCharge,
  rejectCharge,
  handleBankNotification,
  handleCoinNotification,
};
