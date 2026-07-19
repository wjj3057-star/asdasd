'use strict';

const config = require('../config');
const { Guilds } = require('../database/models');

const OAUTH_SCOPE = 'identify';

// 로그인 사용자가 관리할 수 있는 길드 목록 (소유자=전체, 그 외=자신이 등록한 서버)
function manageableGuilds(userId) {
  if (config.isOwner(userId)) return Guilds.all();
  return Guilds.forManager(userId);
}
function canManage(userId, gid) {
  if (config.isOwner(userId)) return true;
  return manageableGuilds(userId).some((g) => g.guild_id === gid);
}

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

// 로그인 필수 미들웨어 (소유자 또는 최소 1개 서버 관리자)
function requireAdmin(req, res, next) {
  const u = req.session && req.session.user;
  if (u && (config.isOwner(u.id) || manageableGuilds(u.id).length > 0)) {
    return next();
  }
  if (u) return res.redirect('/no-access');
  if (req.accepts('html')) return res.redirect('/login');
  return res.status(401).json({ error: 'unauthorized' });
}

module.exports = {
  loginUrl, exchangeCode, fetchUser, requireAdmin, OAUTH_SCOPE,
  manageableGuilds, canManage,
};
