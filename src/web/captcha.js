'use strict';

// 로그인 전 캡차 게이트
// - 기본: 자체 SVG 캡차 (외부 서비스/키 불필요, 세션 저장 + 일회용)
// - TURNSTILE_SITE_KEY/SECRET_KEY 설정 시: Cloudflare Turnstile 로 자동 전환

const crypto = require('crypto');
const config = require('../config');

const CODE_TTL = 5 * 60 * 1000; // 코드 유효 5분
const PASS_TTL = 10 * 60 * 1000; // 캡차 통과 후 OAuth 완료까지 10분

// 헷갈리는 문자 제외 (0/O, 1/I/l, 5/S ...)
const CHARS = 'ABCDEFGHJKMNPQRTUVWXY346789';

function mode() {
  return config.captcha.turnstileSiteKey && config.captcha.turnstileSecretKey
    ? 'turnstile'
    : 'local';
}

/* ---------------- 자체 SVG 캡차 ---------------- */
function generate(req) {
  let code = '';
  for (let i = 0; i < 5; i++) code += CHARS[crypto.randomInt(CHARS.length)];
  req.session.captcha = { code, exp: Date.now() + CODE_TTL };
  return code;
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

// 세션의 현재 코드를 왜곡된 SVG 로 렌더 (코드 없으면 새로 생성)
function svg(req) {
  const c = req.session.captcha;
  const code = c && c.exp > Date.now() ? c.code : generate(req);
  const W = 190;
  const H = 64;

  let noise = '';
  for (let i = 0; i < 6; i++) {
    noise += `<path d="M${rand(-10, 30).toFixed(1)} ${rand(5, H - 5).toFixed(1)} C ${rand(30, 80).toFixed(1)} ${rand(-10, H + 10).toFixed(1)}, ${rand(90, 150).toFixed(1)} ${rand(-10, H + 10).toFixed(1)}, ${rand(160, 200).toFixed(1)} ${rand(5, H - 5).toFixed(1)}" stroke="rgba(62,224,127,${rand(0.15, 0.4).toFixed(2)})" stroke-width="${rand(1, 2).toFixed(1)}" fill="none"/>`;
  }
  let dots = '';
  for (let i = 0; i < 24; i++) {
    dots += `<circle cx="${rand(0, W).toFixed(1)}" cy="${rand(0, H).toFixed(1)}" r="${rand(0.7, 1.6).toFixed(1)}" fill="rgba(127,139,131,${rand(0.2, 0.55).toFixed(2)})"/>`;
  }

  let chars = '';
  const step = (W - 40) / code.length;
  for (let i = 0; i < code.length; i++) {
    const x = 24 + i * step + rand(-4, 4);
    const y = H / 2 + rand(-4, 6);
    const rot = rand(-24, 24).toFixed(1);
    const size = rand(26, 32).toFixed(0);
    chars += `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" transform="rotate(${rot} ${x.toFixed(1)} ${y.toFixed(1)})" font-family="Georgia, 'Times New Roman', serif" font-size="${size}" font-weight="700" fill="#eef1ef" dominant-baseline="middle" text-anchor="middle">${code[i]}</text>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" rx="12" fill="#0e1512"/>${noise}${chars}${dots}</svg>`;
}

// 입력 검증 (일회용: 성공/실패와 무관하게 코드 소모)
function verifyLocal(req, input) {
  const c = req.session.captcha;
  req.session.captcha = null;
  if (!c || c.exp < Date.now()) return { ok: false, error: '캡차가 만료되었습니다. 다시 시도해 주세요.' };
  const norm = String(input || '').trim().toUpperCase();
  if (norm !== c.code) return { ok: false, error: '캡차 문자가 일치하지 않습니다.' };
  return { ok: true };
}

/* ---------------- Cloudflare Turnstile ---------------- */
async function verifyTurnstile(token, ip) {
  if (!token) return { ok: false, error: '캡차 인증을 완료해 주세요.' };
  try {
    const body = new URLSearchParams({
      secret: config.captcha.turnstileSecretKey,
      response: String(token),
    });
    if (ip) body.set('remoteip', ip);
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const json = await res.json();
    return json.success
      ? { ok: true }
      : { ok: false, error: '캡차 인증에 실패했습니다. 다시 시도해 주세요.' };
  } catch (e) {
    return { ok: false, error: '캡차 서버 연결에 실패했습니다. 잠시 후 다시 시도해 주세요.' };
  }
}

/* ---------------- 공용 ---------------- */
async function verify(req) {
  if (mode() === 'turnstile') {
    return verifyTurnstile(req.body['cf-turnstile-response'], req.ip);
  }
  return verifyLocal(req, req.body.captcha);
}

function markPassed(req) {
  req.session.captchaPassed = Date.now();
}
function hasPassed(req) {
  return !!(req.session.captchaPassed && Date.now() - req.session.captchaPassed < PASS_TTL);
}
function clearPassed(req) {
  req.session.captchaPassed = null;
}

module.exports = { mode, generate, svg, verify, markPassed, hasPassed, clearPassed };
