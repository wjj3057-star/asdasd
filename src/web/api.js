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
 * 코인 입금 알림 수신 (웹훅 방식)
 * { amount: "7.145321", symbol: "USDT", txid: "..." }
 */
router.post('/webhook/coin', checkSecret, (req, res) => {
  const { amount, symbol, txid } = req.body;
  if (amount == null) return res.status(400).json({ ok: false, error: 'amount required' });
  const result = handleCoinNotification({ amount, symbol, txid });
  return res.json(result);
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
