'use strict';

const express = require('express');
const config = require('../config');
const {
  handleBankNotification,
  handleCoinNotification,
} = require('../payments/chargeService');
const { parseAmount, sanitizeName } = require('../util');

const router = express.Router();

// 웹훅 시크릿 검증 (헤더 또는 body/query 의 secret)
function checkSecret(req, res, next) {
  const provided =
    req.get('x-webhook-secret') || req.body.secret || req.query.secret;
  if (!config.payment.webhookSecret || provided !== config.payment.webhookSecret) {
    return res.status(403).json({ ok: false, error: 'forbidden' });
  }
  next();
}

/**
 * 은행 입금 알림 수신 (PG 미사용 자동충전)
 * 스마트폰의 문자/알림 포워딩 앱(예: MacroDroid, Tasker, 자동문자)에서
 * 은행 입금 알림을 이 엔드포인트로 POST 하도록 설정.
 *
 * 지원 형식:
 *  A) 파싱된 형태: { depositor: "홍길동", amount: 10000 }
 *  B) 원문 문자:   { text: "[Web발신] KB국민 홍길동님 10,000원 입금" }
 */
router.post('/webhook/bank', checkSecret, (req, res) => {
  let { depositor, amount, text, raw } = req.body;
  const rawText = text || raw || '';

  if ((!depositor || amount == null) && rawText) {
    const parsed = parseKoreanBankSms(rawText);
    depositor = depositor || parsed.depositor;
    amount = amount != null ? amount : parsed.amount;
  }

  const result = handleBankNotification({
    depositor: sanitizeName(depositor),
    amount: amount != null ? Number(amount) : parseAmount(rawText),
    raw: rawText || JSON.stringify(req.body),
  });

  return res.json(result);
});

/**
 * 코인 입금 알림 수신 (웹훅 방식) — LTC / SOL / USDT(TRC20·BSC) 등 공통
 * { amount: "7.145321", symbol: "USDT", network: "BEP20", txid: "..." }
 */
router.post('/webhook/coin', checkSecret, (req, res) => {
  const { amount, symbol, network, txid } = req.body;
  if (amount == null) return res.status(400).json({ ok: false, error: 'amount required' });
  const result = handleCoinNotification({ amount, symbol, network, txid });
  return res.json(result);
});

/* =========================================================
 * 로블록스 배송 처리 API (꼭두각시 운영 워커/오퍼레이터용)
 * ※ 게임 클라이언트 자동제어(트레이드 봇)는 로블록스 ToS 위반이라 포함하지 않습니다.
 *   이 API는 사람이 운영하거나, 본인이 책임지는 외부 도구가 배송 큐를 받아
 *   완료/실패를 보고하도록 하는 오케스트레이션 인터페이스입니다.
 * =======================================================*/
const { Deliveries, VipServers } = require('../database/models');
const deliveryService = require('../roblox/deliveryService');

// 처리 대기열 조회 (전 서버 통합 · guild_id 로 구분)
router.get('/roblox/queue', checkSecret, (req, res) => {
  let list = Deliveries.queueAll();
  if (req.query.guild_id) list = list.filter((d) => d.guild_id === req.query.guild_id);
  const items = list.map((d) => {
    const s = d.vip_server_id ? VipServers.get(d.vip_server_id) : null;
    return {
      id: d.id,
      guild_id: d.guild_id,
      discord_id: d.discord_id,
      product: d.product_name,
      item: d.roblox_item,
      quantity: d.quantity,
      roblox_username: d.roblox_username,
      roblox_userid: d.roblox_userid,
      status: d.status,
      vip_server: s ? { id: s.id, name: s.name, vip_link: s.vip_link, puppet_name: s.puppet_name } : null,
      created_at: d.created_at,
    };
  });
  res.json({ ok: true, count: items.length, items });
});

// 오퍼레이터가 클레임 (담당자 표기)
router.post('/roblox/deliveries/:id/claim', checkSecret, (req, res) => {
  const d = Deliveries.get(parseInt(req.params.id, 10));
  if (!d) return res.status(404).json({ ok: false, error: 'not_found' });
  Deliveries.setStatus(d.id, d.status === 'queued' ? 'joined' : d.status, {
    operator: req.body.operator || 'worker',
  });
  res.json({ ok: true });
});

// 유저 접속 확인(선택)
router.post('/roblox/deliveries/:id/joined', checkSecret, (req, res) => {
  const d = Deliveries.get(parseInt(req.params.id, 10));
  if (!d) return res.status(404).json({ ok: false, error: 'not_found' });
  Deliveries.setStatus(d.id, 'joined', { operator: req.body.operator });
  res.json({ ok: true });
});

// 배송 완료 → 유저 DM
router.post('/roblox/deliveries/:id/complete', checkSecret, async (req, res) => {
  const r = await deliveryService.completeDelivery(parseInt(req.params.id, 10), req.body.operator || 'worker');
  res.status(r.ok ? 200 : 400).json(r);
});

// 배송 실패 → (옵션)환불 + 유저 DM
router.post('/roblox/deliveries/:id/fail', checkSecret, async (req, res) => {
  const refund = req.body.refund === undefined ? true : !!req.body.refund;
  const r = await deliveryService.failDelivery(parseInt(req.params.id, 10), req.body.reason || '', refund);
  res.status(r.ok ? 200 : 400).json(r);
});

router.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// 한국 은행 입금 문자 간이 파서
function parseKoreanBankSms(text) {
  const t = String(text).replace(/\s+/g, ' ');
  const amount = parseAmount((t.match(/([\d,]+)\s*원/) || [])[1] || t);
  // "홍길동님", "홍길동 입금" 등에서 이름 추출 (완벽하지 않음 - 관리자 검토 권장)
  let depositor = '';
  const m =
    t.match(/([가-힣]{2,4})\s*님/) ||
    t.match(/([가-힣]{2,4})\s*(?:입금|송금)/);
  if (m) depositor = m[1];
  return { depositor, amount };
}

module.exports = router;
