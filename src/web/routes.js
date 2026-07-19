'use strict';

const express = require('express');
const config = require('../config');
const {
  getAllSettings,
  setSettings,
  Guilds,
  LicenseKeys,
  Categories,
  Products,
  Stock,
  Users,
  Charges,
  Purchases,
  BankNotifications,
  Coins,
  VipServers,
  Deliveries,
  dashboard,
  ownerOverview,
} = require('../database/models');
const { approveCharge, rejectCharge } = require('../payments/chargeService');
const deliveryService = require('../roblox/deliveryService');
const roblox = require('../roblox');
const { won } = require('../util');
const { requireAdmin, manageableGuilds, canManage } = require('./auth');

// refreshPanel(gid) 은 index.js에서 주입
let refreshPanel = async () => false;
function setPanelRefresher(fn) {
  refreshPanel = fn;
}

const router = express.Router();
router.use(requireAdmin);

// 공통 컨텍스트: 관리 가능한 길드 + 현재 선택 길드
router.use((req, res, next) => {
  const uid = req.session.user.id;
  const guilds = manageableGuilds(uid);
  res.locals.guilds = guilds;
  res.locals.isOwner = config.isOwner(uid);
  res.locals.user = req.session.user;
  res.locals.sync = req.query.sync;

  // 길드 자동/세션 선택
  let gid = req.session.guildId;
  if (!gid || !canManage(uid, gid)) {
    gid = guilds.length === 1 ? guilds[0].guild_id : null;
    req.session.guildId = gid;
  }
  req.gid = gid;
  res.locals.gid = gid;
  res.locals.currentGuild = gid ? Guilds.get(gid) : null;

  // 길드 선택이 필요 없는 경로
  const path = req.path;
  const skip = path === '/select-guild' || path.startsWith('/select-guild/') || path.startsWith('/owner') || path === '/logout';
  if (!gid && !skip) return res.redirect('/select-guild');
  next();
});

const render = (req, res, view, extra = {}) =>
  res.render(view, { settings: getAllSettings(req.gid), won, ...extra });

/* ---------------- 길드 선택 ---------------- */
router.get('/select-guild', (req, res) => {
  res.render('select_guild', {
    user: req.session.user,
    guilds: res.locals.guilds,
    isOwner: res.locals.isOwner,
  });
});
router.get('/select-guild/:gid', (req, res) => {
  if (canManage(req.session.user.id, req.params.gid)) req.session.guildId = req.params.gid;
  res.redirect('/');
});

/* ---------------- 소유자: 라이선스 키 관리 ---------------- */
router.get('/owner/licenses', (req, res) => {
  if (!res.locals.isOwner) return res.redirect('/');
  const keys = LicenseKeys.all(300);
  const guildMap = {};
  for (const g of Guilds.all()) guildMap[g.guild_id] = g;
  res.render('licenses', {
    title: '라이선스 관리',
    active: 'owner',
    settings: getAllSettings(req.gid),
    user: req.session.user,
    guilds: res.locals.guilds,
    isOwner: true,
    currentGuild: res.locals.currentGuild,
    plans: config.plans,
    keys,
    guildMap,
    generated: req.session.generatedKeys || null,
    unused: LicenseKeys.unusedCount(),
    allGuilds: Guilds.all(),
    won,
  });
  req.session.generatedKeys = null;
});
router.post('/owner/licenses', (req, res) => {
  if (!res.locals.isOwner) return res.redirect('/');
  const plan = config.plans[req.body.plan] ? req.body.plan : '1m';
  const count = Math.max(1, Math.min(50, parseInt(req.body.count || '1', 10)));
  const keys = LicenseKeys.createBatch(plan, count, req.session.user.id, req.body.memo || '');
  req.session.generatedKeys = { plan, keys };
  res.redirect('/owner/licenses');
});
router.post('/owner/licenses/:id/delete', (req, res) => {
  if (!res.locals.isOwner) return res.redirect('/');
  LicenseKeys.remove(parseInt(req.params.id, 10));
  res.redirect('/owner/licenses');
});

/* ---------------- 소유자: 통합 통계 ---------------- */
router.get('/owner/stats', (req, res) => {
  if (!res.locals.isOwner) return res.redirect('/');
  res.render('owner_stats', {
    title: '통합 통계',
    active: 'ownerstats',
    settings: getAllSettings(req.gid),
    user: req.session.user,
    guilds: res.locals.guilds,
    isOwner: true,
    currentGuild: res.locals.currentGuild,
    plans: config.plans,
    ov: ownerOverview(),
    won,
  });
});

/* ---------------- 대시보드 ---------------- */
router.get('/', (req, res) => {
  const dash = dashboard(req.gid);
  const userMap = {};
  for (const u of Users.all(req.gid)) userMap[u.discord_id] = u;
  render(req, res, 'dashboard', {
    active: 'dashboard', title: '대시보드', dash, sys: botStatus(), userMap,
    user: req.session.user, sub: subInfo(req.gid),
  });
});

/* ---------------- 설정 ---------------- */
router.get('/settings', (req, res) => {
  render(req, res, 'settings', {
    active: 'settings', title: '상점 설정', user: req.session.user,
    saved: req.query.saved, coins: Coins.all(req.gid),
  });
});
router.post('/settings', async (req, res) => {
  const keys = ['shop_name', 'shop_description', 'embed_color', 'embed_image', 'embed_thumbnail',
    'embed_footer', 'bank_name', 'bank_account', 'bank_holder', 'charge_min',
    'charge_expire_minutes', 'coin_krw_rate'];
  const patch = {};
  for (const k of keys) if (req.body[k] !== undefined) patch[k] = req.body[k];
  setSettings(req.gid, patch);
  await refreshPanel(req.gid);
  res.redirect('/settings?saved=1');
});

/* ---------------- 코인 ---------------- */
router.post('/coins', (req, res) => {
  Coins.create(req.gid, req.body);
  res.redirect('/settings?saved=coin');
});
router.post('/coins/:id/update', (req, res) => {
  if (guildOwnsCoin(req.gid, req.params.id)) Coins.update(parseInt(req.params.id, 10), req.body);
  res.redirect('/settings?saved=coin');
});
router.post('/coins/:id/delete', (req, res) => {
  if (guildOwnsCoin(req.gid, req.params.id)) Coins.remove(parseInt(req.params.id, 10));
  res.redirect('/settings?saved=coin');
});

/* ---------------- 카테고리 ---------------- */
router.get('/categories', (req, res) => {
  const categories = Categories.all(req.gid).map((c) => ({ ...c, productCount: Products.byCategory(c.id, false).length }));
  render(req, res, 'categories', { active: 'categories', title: '카테고리', user: req.session.user, categories });
});
router.post('/categories', (req, res) => {
  Categories.create(req.gid, {
    name: req.body.name, description: req.body.description, emoji: req.body.emoji,
    position: parseInt(req.body.position || '0', 10),
  });
  res.redirect('/categories');
});
router.post('/categories/:id/update', (req, res) => {
  if (owns(Categories.get(req.params.id), req.gid))
    Categories.update(parseInt(req.params.id, 10), {
      name: req.body.name, description: req.body.description, emoji: req.body.emoji,
      position: parseInt(req.body.position || '0', 10),
    });
  res.redirect('/categories');
});
router.post('/categories/:id/delete', (req, res) => {
  if (owns(Categories.get(req.params.id), req.gid)) Categories.remove(parseInt(req.params.id, 10));
  res.redirect('/categories');
});

/* ---------------- 제품 ---------------- */
router.get('/products', (req, res) => {
  const products = Products.all(req.gid).map((p) => ({
    ...p, category: Categories.get(p.category_id), stock: Products.stockCount(p.id),
  }));
  render(req, res, 'products', {
    active: 'products', title: '상품 관리', user: req.session.user, products, categories: Categories.all(req.gid),
  });
});
function productBody(req) {
  return {
    category_id: parseInt(req.body.category_id, 10),
    name: req.body.name, description: req.body.description, emoji: req.body.emoji,
    price: parseInt(req.body.price || '0', 10), position: parseInt(req.body.position || '0', 10),
    is_active: req.body.is_active ? 1 : 0,
    delivery_type: req.body.delivery_type || 'stock',
    roblox_item: req.body.roblox_item || '', roblox_game: req.body.roblox_game || 'Grow a Garden 2',
  };
}
router.post('/products', (req, res) => {
  const cat = Categories.get(parseInt(req.body.category_id, 10));
  if (owns(cat, req.gid)) Products.create(req.gid, productBody(req));
  res.redirect('/products');
});
router.post('/products/:id/update', (req, res) => {
  if (owns(Products.get(req.params.id), req.gid)) Products.update(parseInt(req.params.id, 10), productBody(req));
  res.redirect('/products');
});
router.post('/products/:id/delete', (req, res) => {
  if (owns(Products.get(req.params.id), req.gid)) Products.remove(parseInt(req.params.id, 10));
  res.redirect('/products');
});

/* ---------------- 재고 ---------------- */
router.get('/inventory', (req, res) => {
  const products = Products.all(req.gid).map((p) => ({
    ...p, category: Categories.get(p.category_id), stock: Products.stockCount(p.id),
  }));
  render(req, res, 'inventory', { active: 'inventory', title: '재고 관리', user: req.session.user, products });
});
router.get('/products/:id/stock', (req, res) => {
  const product = Products.get(parseInt(req.params.id, 10));
  if (!owns(product, req.gid)) return res.redirect('/inventory');
  render(req, res, 'stock', {
    active: 'inventory', title: '재고 관리', user: req.session.user, product,
    category: Categories.get(product.category_id), stock: Stock.listByProduct(product.id), added: req.query.added,
  });
});
router.post('/products/:id/stock', (req, res) => {
  const product = Products.get(parseInt(req.params.id, 10));
  if (!owns(product, req.gid)) return res.redirect('/inventory');
  const lines = String(req.body.contents || '').split('\n').map((s) => s.trim()).filter(Boolean);
  if (lines.length) Stock.addBulk(req.gid, product.id, lines);
  res.redirect(`/products/${product.id}/stock?added=${lines.length}`);
});
router.post('/stock/:sid/delete', (req, res) => {
  Stock.remove(parseInt(req.params.sid, 10));
  res.redirect(`/products/${req.body.product_id}/stock`);
});

/* ---------------- 주문 ---------------- */
router.get('/orders', (req, res) => {
  const orders = Purchases.recent(req.gid, 200);
  const userMap = {};
  for (const u of Users.all(req.gid)) userMap[u.discord_id] = u;
  render(req, res, 'orders', { active: 'orders', title: '주문 내역', user: req.session.user, orders, userMap });
});

/* ---------------- 충전 ---------------- */
router.get('/charges', (req, res) => {
  const list = Charges.all(req.gid, 200).map((c) => ({ ...c, userObj: Users.get(req.gid, c.discord_id) }));
  render(req, res, 'charges', {
    active: 'charges', title: '충전 관리', user: req.session.user, charges: list,
    pendingCount: Charges.pending(req.gid).length, coins: Coins.all(req.gid), notifications: BankNotifications.recent(req.gid, 20),
  });
});
router.post('/charges/:id/approve', async (req, res) => {
  const c = Charges.get(parseInt(req.params.id, 10));
  if (c && c.guild_id === req.gid) approveCharge(c.id, '관리자 수동승인');
  res.redirect('/charges');
});
router.post('/charges/:id/reject', (req, res) => {
  const c = Charges.get(parseInt(req.params.id, 10));
  if (c && c.guild_id === req.gid) rejectCharge(c.id, req.body.memo || '관리자 반려');
  res.redirect('/charges');
});

/* ---------------- 고객 ---------------- */
router.get('/users', (req, res) => {
  const users = Users.all(req.gid).map((u) => ({ ...u, purchaseCount: Purchases.byUser(req.gid, u.discord_id, 9999).length }));
  render(req, res, 'users', { active: 'users', title: '고객 관리', user: req.session.user, users });
});
router.post('/users/:id/adjust', (req, res) => {
  const amount = parseInt(req.body.amount || '0', 10);
  try {
    Users.adjustBalance(req.gid, req.params.id, amount, 'admin', req.body.memo || '관리자 조정');
  } catch (e) { /* 잔액부족 무시 */ }
  res.redirect('/users');
});

/* ---------------- 로블록스 배송 ---------------- */
router.get('/roblox', (req, res) => {
  const servers = VipServers.all(req.gid);
  const serverMap = {};
  for (const s of servers) serverMap[s.id] = s;
  const deliveries = Deliveries.all(req.gid, 200).map((d) => ({
    ...d, userObj: Users.get(req.gid, d.discord_id), server: d.vip_server_id ? serverMap[d.vip_server_id] : null,
    avatar: d.roblox_userid ? roblox.avatarUrl(d.roblox_userid) : '', profile: d.roblox_userid ? roblox.profileUrl(d.roblox_userid) : '',
  }));
  render(req, res, 'roblox', {
    active: 'roblox', title: '로블록스 배송', user: req.session.user, deliveries, servers, pending: Deliveries.pendingCount(req.gid),
  });
});
router.post('/roblox/:id/complete', async (req, res) => {
  const d = Deliveries.get(parseInt(req.params.id, 10));
  if (d && d.guild_id === req.gid) await deliveryService.completeDelivery(d.id, req.session.user.username);
  res.redirect('/roblox');
});
router.post('/roblox/:id/fail', async (req, res) => {
  const d = Deliveries.get(parseInt(req.params.id, 10));
  if (d && d.guild_id === req.gid) await deliveryService.failDelivery(d.id, req.body.reason || '관리자 실패 처리', !!req.body.refund);
  res.redirect('/roblox');
});
router.post('/roblox/:id/resend', async (req, res) => {
  const d = Deliveries.get(parseInt(req.params.id, 10));
  if (d && d.guild_id === req.gid) await deliveryService.resendLink(d.id);
  res.redirect('/roblox');
});
router.post('/roblox/:id/assign', async (req, res) => {
  const d = Deliveries.get(parseInt(req.params.id, 10));
  const serverId = parseInt(req.body.server_id, 10);
  const server = VipServers.get(serverId);
  if (d && d.guild_id === req.gid && server && server.guild_id === req.gid) {
    Deliveries.assignServer(d.id, serverId);
    if (d.status !== 'awaiting_username') Deliveries.setStatus(d.id, 'queued');
    await deliveryService.resendLink(d.id);
  }
  res.redirect('/roblox');
});

/* ---------------- VIP 서버 ---------------- */
router.post('/vip-servers', (req, res) => {
  VipServers.create(req.gid, req.body);
  res.redirect('/roblox');
});
router.post('/vip-servers/:id/update', (req, res) => {
  if (owns(VipServers.get(req.params.id), req.gid)) VipServers.update(parseInt(req.params.id, 10), req.body);
  res.redirect('/roblox');
});
router.post('/vip-servers/:id/delete', (req, res) => {
  if (owns(VipServers.get(req.params.id), req.gid)) VipServers.remove(parseInt(req.params.id, 10));
  res.redirect('/roblox');
});

/* ---------------- 패널 동기화 ---------------- */
router.post('/panel/refresh', async (req, res) => {
  const ok = await refreshPanel(req.gid);
  const back = req.get('Referer') || '/';
  const sep = back.includes('?') ? '&' : '?';
  res.redirect(`${back}${sep}sync=${ok ? 'ok' : 'fail'}`);
});

/* ---------------- 헬퍼 ---------------- */
function owns(row, gid) {
  return row && row.guild_id === gid;
}
function guildOwnsCoin(gid, coinId) {
  const c = Coins.get(parseInt(coinId, 10));
  return c && c.guild_id === gid;
}
function subInfo(gid) {
  const g = Guilds.get(gid);
  if (!g || !g.expires_at) return { active: false };
  return {
    active: g.expires_at > Date.now(),
    plan: config.plans[g.plan]?.label || g.plan,
    expires_at: g.expires_at,
    daysLeft: Math.max(0, Math.ceil((g.expires_at - Date.now()) / (24 * 60 * 60 * 1000))),
  };
}
function botStatus() {
  try {
    const { client } = require('../bot/client');
    if (client && client.isReady && client.isReady()) return { botOnline: true, ping: Math.max(0, Math.round(client.ws.ping)) };
  } catch (e) { /* 봇 미기동 */ }
  return { botOnline: false, ping: 0 };
}

module.exports = { router, setPanelRefresher };
