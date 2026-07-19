'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const SqliteStore = require('./sessionStore');
const config = require('../config');
const auth = require('./auth');
const { router: dashboardRouter, setPanelRefresher } = require('./routes');
const apiRouter = require('./api');

function createApp() {
  const app = express();

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.use('/static', express.static(path.join(__dirname, 'public')));
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());

  app.use(
    session({
      store: new SqliteStore(),
      secret: config.web.sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: { maxAge: 7 * 24 * 60 * 60 * 1000, httpOnly: true },
    })
  );

  // ---- 결제 웹훅 (인증 불필요, 자체 시크릿 검증) ----
  app.use('/api', apiRouter);

  // ---- OAuth 로그인 ----
  app.get('/login', (req, res) => {
    if (req.session.user && config.isAdmin(req.session.user.id)) return res.redirect('/');
    const state = crypto.randomBytes(16).toString('hex');
    req.session.oauthState = state;
    res.render('login', { loginUrl: auth.loginUrl(state), error: req.query.error });
  });

  app.get('/auth/callback', async (req, res) => {
    try {
      const { code, state } = req.query;
      if (!code || state !== req.session.oauthState) {
        return res.redirect('/login?error=' + encodeURIComponent('세션이 만료되었습니다. 다시 시도해 주세요.'));
      }
      const token = await auth.exchangeCode(code);
      const user = await auth.fetchUser(token.access_token);
      req.session.user = {
        id: user.id,
        username: user.global_name || user.username,
        avatar: user.avatar
          ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
          : null,
      };
      // 소유자 또는 서버 관리자만 접근 가능
      if (!config.isOwner(user.id) && auth.manageableGuilds(user.id).length === 0) {
        return res.redirect('/no-access');
      }
      res.redirect('/');
    } catch (e) {
      console.error('[oauth] 콜백 오류:', e.message);
      res.redirect('/login?error=' + encodeURIComponent('로그인 처리 중 오류가 발생했습니다.'));
    }
  });

  app.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/login'));
  });

  app.get('/no-access', (req, res) => {
    res.render('no_access', { user: req.session.user });
  });

  // ---- 대시보드 ----
  app.use('/', dashboardRouter);

  return app;
}

function start(refreshPanelFn) {
  if (refreshPanelFn) setPanelRefresher(refreshPanelFn);
  const app = createApp();
  // 0.0.0.0 바인딩: Pterodactyl/Docker 계열에서 외부 접속이 되려면 필수
  app.listen(config.web.port, '0.0.0.0', () => {
    console.log(`🌐 웹 대시보드: ${config.web.baseUrl} (포트 ${config.web.port})`);
  });
  return app;
}

module.exports = { createApp, start };
