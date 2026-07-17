'use strict';

const config = require('../config');

const OAUTH_SCOPE = 'identify';

function loginUrl(state) {
  const params = new URLSearchParams({
    client_id: config.discord.clientId,
    redirect_uri: `${config.web.baseUrl}/auth/callback`,
    response_type: 'code',
    scope: OAUTH_SCOPE,
    state: state || '',
  });
  return `https://discord.com/oauth2/authorize?${params}`;
}

async function exchangeCode(code) {
  const body = new URLSearchParams({
    client_id: config.discord.clientId,
    client_secret: config.discord.clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: `${config.web.baseUrl}/auth/callback`,
  });
  const res = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error('token exchange failed: ' + (await res.text()));
  return res.json();
}

async function fetchUser(accessToken) {
  const res = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error('user fetch failed');
  return res.json();
}

// 관리자 로그인 필수 미들웨어
function requireAdmin(req, res, next) {
  if (req.session && req.session.user && config.isAdmin(req.session.user.id)) {
    return next();
  }
  if (req.accepts('html')) return res.redirect('/login');
  return res.status(401).json({ error: 'unauthorized' });
}

module.exports = { loginUrl, exchangeCode, fetchUser, requireAdmin, OAUTH_SCOPE };
