'use strict';

const express = require('express');
const {
  getAllSettings,
  setSettings,
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
  stats,
  dashboard,
} = require('../database/models');
const { approveCharge, rejectCharge } = require('../payments/chargeService');
const deliveryService = require('../roblox/deliveryService');
const roblox = require('../roblox');
const { won } = require('../util');
const { requireAdmin } = require('./auth');

// refreshPanel 은 index.js에서 주입 (봇 없이 웹만 켤 수도 있으므로)
let refreshPanel = async () => false;
function setPanelRefresher(fn) {
  refreshPanel = fn;
}

// 봇 상태 (라이브 상태 카드용)
function botStatus() {
  try {
    const { client } = require('../bot/client');
    if (client && client.isReady && client.isReady()) {
      return { botOnline: true, ping: Math.max(0, Math.round(client.ws.ping)) };
    }
  } catch (e) {
    /* 봇 미기동 */
  }
  return { botOnline: false, ping: 0 };
}

const router = express.Router();
router.use(requireAdmin);

// 모든 뷰에서 접근 가능한 공통 로컬 (동기화 결과 배너 등)
router.use((req, res, next) => {
  res.locals.sync = req.query.sync;
  next();
});

const render = (res, view, extra = {}) =>
  res.render(view, { settings: getAllSettings(), won, ...extra });

/* ---------------- 대시보드 ---------------- */
router.get('/', (req, res) => {
  const dash = dashboard();
  const userMap = {};
  for (const u of Users.all()) userMap[u.discord_id] = u;
  render(res, 'dashboard', {
    active: 'dashboard',
    title: '대시보드',
    dash,
    sys: botStatus(),
    userMap,
    user: req.session.user,
  });
});

/* ---------------- 설정 (상점명/설명/임베드/계좌/코인) ---------------- */
router.get('/settings', (req, res) => {
  render(res, 'settings', {
    active: 'settings',
    title: '상점 설정',
    user: req.session.user,
    saved: req.query.saved,
    coins: Coins.all(),
  });
});

router.post('/settings', async (req, res) => {
  const keys = [
    'shop_name', 'shop_description', 'embed_color', 'embed_image', 'embed_thumbnail',
    'embed_footer', 'bank_name', 'bank_account', 'bank_holder', 'charge_min',
    'charge_expire_minutes', 'coin_krw_rate',
  ];
  const patch = {};
  for (const k of keys) if (req.body[k] !== undefined) patch[k] = req.body[k];
  setSettings(patch);
  await refreshPanel(); // 패널 임베드 즉시 갱신
  res.redirect('/settings?saved=1');
});

/* ---------------- 코인 관리 ---------------- */
router.post('/coins', (req, res) => {
  Coins.create({
    symbol: req.body.symbol,
    network: req.body.network,
    wallet: req.body.wallet,
    krw_rate: req.body.krw_rate,
    decimals: req.body.decimals,
    enabled: req.body.enabled ? 1 : 0,
    position: req.body.position,
  });
  res.redirect('/settings?saved=coin');
});
router.post('/coins/:id/update', (req, res) => {
  Coins.update(parseInt(req.params.id, 10), {
    symbol: req.body.symbol,
    network: req.body.network,
    wallet: req.body.wallet,
    krw_rate: req.body.krw_rate,
    decimals: req.body.decimals,
    enabled: req.body.enabled ? 1 : 0,
    position: req.body.position,
  });
  res.redirect('/settings?saved=coin');
});
router.post('/coins/:id/delete', (req, res) => {
  Coins.remove(parseInt(req.params.id, 10));
  res.redirect('/settings?saved=coin');
});

/* ---------------- 카테고리 ---------------- */
router.get('/categories', (req, res) => {
  const categories = Categories.all().map((c) => ({
    ...c,
    productCount: Products.byCategory(c.id, false).length,
  }));
  render(res, 'categories', {
    active: 'categories',
    title: '카테고리',
    user: req.session.user,
    categories,
  });
});
router.post('/categories', (req, res) => {
  Categories.create({
    name: req.body.name,
    description: req.body.description,
    emoji: req.body.emoji,
    position: parseInt(req.body.position || '0', 10),
  });
  res.redirect('/categories');
});
router.post('/categories/:id/update', (req, res) => {
  Categories.update(parseInt(req.params.id, 10), {
    name: req.body.name,
    description: req.body.description,
    emoji: req.body.emoji,
    position: parseInt(req.body.position || '0', 10),
  });
  res.redirect('/categories');
});
router.post('/categories/:id/delete', (req, res) => {
  Categories.remove(parseInt(req.params.id, 10));
  res.redirect('/categories');
});

/* ---------------- 제품 ---------------- */
router.get('/products', (req, res) => {
  const products = Products.all().map((p) => ({
    ...p,
    category: Categories.get(p.category_id),
    stock: Products.stockCount(p.id),
  }));
  render(res, 'products', {
    active: 'products',
    title: '상품 관리',
    user: req.session.user,
    products,
    categories: Categories.all(),
  });
});
router.post('/products', (req, res) => {
  Products.create({
    category_id: parseInt(req.body.category_id, 10),
    name: req.body.name,
    description: req.body.description,
    emoji: req.body.emoji,
    price: parseInt(req.body.price || '0', 10),
    position: parseInt(req.body.position || '0', 10),
    is_active: req.body.is_active ? 1 : 0,
    delivery_type: req.body.delivery_type || 'stock',
    roblox_item: req.body.roblox_item || '',
    roblox_game: req.body.roblox_game || 'Grow a Garden 2',
  });
  res.redirect('/products');
});
router.post('/products/:id/update', (req, res) => {
  Products.update(parseInt(req.params.id, 10), {
    category_id: parseInt(req.body.category_id, 10),
    name: req.body.name,
    description: req.body.description,
    emoji: req.body.emoji,
    price: parseInt(req.body.price || '0', 10),
    position: parseInt(req.body.position || '0', 10),
    is_active: req.body.is_active ? 1 : 0,
    delivery_type: req.body.delivery_type || 'stock',
    roblox_item: req.body.roblox_item || '',
    roblox_game: req.body.roblox_game || 'Grow a Garden 2',
  });
  res.redirect('/products');
});
router.post('/products/:id/delete', (req, res) => {
  Products.remove(parseInt(req.params.id, 10));
  res.redirect('/products');
});

/* ---------------- 재고 관리 (전체 개요) ---------------- */
router.get('/inventory', (req, res) => {
  const products = Products.all().map((p) => ({
    ...p,
    category: Categories.get(p.category_id),
    stock: Products.stockCount(p.id),
  }));
  render(res, 'inventory', {
    active: 'inventory',
    title: '재고 관리',
    user: req.session.user,
    products,
  });
});

/* ---------------- 재고 (제품별 상세) ---------------- */
router.get('/products/:id/stock', (req, res) => {
  const product = Products.get(parseInt(req.params.id, 10));
  if (!product) return res.redirect('/inventory');
  render(res, 'stock', {
    active: 'inventory',
    title: '재고 관리',
    user: req.session.user,
    product,
    category: Categories.get(product.category_id),
    stock: Stock.listByProduct(product.id),
    added: req.query.added,
  });
});
router.post('/products/:id/stock', (req, res) => {
  const productId = parseInt(req.params.id, 10);
  const lines = String(req.body.contents || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  if (lines.length) Stock.addBulk(productId, lines);
  res.redirect(`/products/${productId}/stock?added=${lines.length}`);
});
router.post('/stock/:sid/delete', (req, res) => {
  const pid = req.body.product_id;
  Stock.remove(parseInt(req.params.sid, 10));
  res.redirect(`/products/${pid}/stock`);
});

/* ---------------- 주문 내역 ---------------- */
router.get('/orders', (req, res) => {
  const orders = Purchases.recent(200);
  const userMap = {};
  for (const u of Users.all()) userMap[u.discord_id] = u;
  render(res, 'orders', {
    active: 'orders',
    title: '주문 내역',
    user: req.session.user,
    orders,
    userMap,
  });
});

/* ---------------- 충전 요청 관리 ---------------- */
router.get('/charges', (req, res) => {
  const list = Charges.all(200).map((c) => ({ ...c, userObj: Users.get(c.discord_id) }));
  render(res, 'charges', {
    active: 'charges',
    title: '충전 관리',
    user: req.session.user,
    charges: list,
    pendingCount: Charges.pending().length,
    coins: Coins.all(),
    notifications: BankNotifications.recent(20),
  });
});
router.post('/charges/:id/approve', async (req, res) => {
  approveCharge(parseInt(req.params.id, 10), '관리자 수동승인');
  res.redirect('/charges');
});
router.post('/charges/:id/reject', (req, res) => {
  rejectCharge(parseInt(req.params.id, 10), req.body.memo || '관리자 반려');
  res.redirect('/charges');
});

/* ---------------- 고객 관리 ---------------- */
router.get('/users', (req, res) => {
  const users = Users.all().map((u) => ({
    ...u,
    purchaseCount: Purchases.byUser(u.discord_id, 9999).length,
  }));
  render(res, 'users', { active: 'users', title: '고객 관리', user: req.session.user, users });
});
router.post('/users/:id/adjust', (req, res) => {
  const amount = parseInt(req.body.amount || '0', 10);
  try {
    Users.adjustBalance(req.params.id, amount, 'admin', req.body.memo || '관리자 조정');
  } catch (e) {
    /* 잔액부족 무시 */
  }
  res.redirect('/users');
});

/* ---------------- 로블록스 배송 관리 ---------------- */
router.get('/roblox', (req, res) => {
  const servers = VipServers.all();
  const serverMap = {};
  for (const s of servers) serverMap[s.id] = s;
  const deliveries = Deliveries.all(200).map((d) => ({
    ...d,
    userObj: Users.get(d.discord_id),
    server: d.vip_server_id ? serverMap[d.vip_server_id] : null,
    avatar: d.roblox_userid ? roblox.avatarUrl(d.roblox_userid) : '',
    profile: d.roblox_userid ? roblox.profileUrl(d.roblox_userid) : '',
  }));
  render(res, 'roblox', {
    active: 'roblox',
    title: '로블록스 배송',
    user: req.session.user,
    deliveries,
    servers,
    pending: Deliveries.pendingCount(),
  });
});

router.post('/roblox/:id/complete', async (req, res) => {
  await deliveryService.completeDelivery(parseInt(req.params.id, 10), req.session.user.username);
  res.redirect('/roblox');
});
router.post('/roblox/:id/fail', async (req, res) => {
  const refund = req.body.refund ? true : false;
  await deliveryService.failDelivery(parseInt(req.params.id, 10), req.body.reason || '관리자 실패 처리', refund);
  res.redirect('/roblox');
});
router.post('/roblox/:id/resend', async (req, res) => {
  await deliveryService.resendLink(parseInt(req.params.id, 10));
  res.redirect('/roblox');
});
router.post('/roblox/:id/assign', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const serverId = parseInt(req.body.server_id, 10);
  if (serverId) {
    Deliveries.assignServer(id, serverId);
    const d = Deliveries.get(id);
    if (d && d.status === 'awaiting_username') {
      // 닉네임 있으면 대기열로, 없으면 그대로 둠
    } else {
      Deliveries.setStatus(id, 'queued');
    }
    await deliveryService.resendLink(id);
  }
  res.redirect('/roblox');
});

/* ---------------- VIP 서버 / 꼭두각시 관리 ---------------- */
router.post('/vip-servers', (req, res) => {
  VipServers.create({
    name: req.body.name,
    game: req.body.game,
    vip_link: req.body.vip_link,
    puppet_name: req.body.puppet_name,
    capacity: req.body.capacity,
    status: req.body.status || 'active',
    notes: req.body.notes,
  });
  res.redirect('/roblox');
});
router.post('/vip-servers/:id/update', (req, res) => {
  VipServers.update(parseInt(req.params.id, 10), {
    name: req.body.name,
    game: req.body.game,
    vip_link: req.body.vip_link,
    puppet_name: req.body.puppet_name,
    capacity: req.body.capacity,
    status: req.body.status || 'active',
    notes: req.body.notes,
  });
  res.redirect('/roblox');
});
router.post('/vip-servers/:id/delete', (req, res) => {
  VipServers.remove(parseInt(req.params.id, 10));
  res.redirect('/roblox');
});

/* ---------------- 패널 설치/갱신 (상점 메시지 동기화) ---------------- */
router.post('/panel/refresh', async (req, res) => {
  const ok = await refreshPanel();
  const back = req.get('Referer') || '/';
  const sep = back.includes('?') ? '&' : '?';
  res.redirect(`${back}${sep}sync=${ok ? 'ok' : 'fail'}`);
});

module.exports = { router, setPanelRefresher };
