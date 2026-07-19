'use strict';

function won(n) {
  return `${Number(n || 0).toLocaleString('ko-KR')}원`;
}

// 계좌충전 고유금액 매칭: 요청금액에 1~99원의 랜덤 꼬리를 붙여 동시요청 구분
function makeUniqueAmount(baseAmount, existingAmounts = []) {
  const taken = new Set(existingAmounts.map(Number));
  for (let i = 0; i < 99; i++) {
    const tail = Math.floor(Math.random() * 99) + 1; // 1~99
    const candidate = baseAmount + tail;
    if (!taken.has(candidate)) return candidate;
  }
  return baseAmount + Math.floor(Math.random() * 900) + 100;
}

// 문자열에서 금액(숫자) 추출: "10,000원", "10000" 등
function parseAmount(text) {
  if (text == null) return null;
  const m = String(text).replace(/[, ]/g, '').match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

function sanitizeName(text) {
  return String(text || '').trim().slice(0, 20);
}

module.exports = { won, makeUniqueAmount, parseAmount, sanitizeName };
