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
  stats,
} = require('../database/models');
const { approveCharge, rejectCharge } = require('../payments/chargeService');
const { won } = require('../util');
const { requireAdmin } = require('./auth');

// refreshPanel 은 index.js에서 주입 (봇 없이 웹만 켤 수도 있으므로)
let refreshPanel = async () => false;
function setPanelRefresher(fn) {
  refreshPanel = fn;
}

const router = express.Router();
router.use(requireAdmin);

const render = (res, view, extra = {}) =>
  res.render(view, { settings: getAllSettings(), won, ...extra });

/* ---------------- 대시보드 ---------------- */
router.get('/', (req, res) => {
  render(res, 'dashboard', {
    active: 'dashboard',
    stat: stats(),
    pending: Charges.pending().slice(0, 8),
    recentPurchases: Purchases.recent(8),
    user: req.session.user,
  });
});

/* ---------------- 설정 (상점명/설명/임베드/계좌/코인) ---------------- */
router.get('/settings', (req, res) => {
  render(res, 'settings', { active: 'settings', user: req.session.user, saved: req.query.saved });
});

router.post('/settings', async (req, res) => {
  const keys = [
    'shop_name', 'shop_description', 'embed_color', 'embed_image', 'embed_thumbnail',
    'embed_footer', 'bank_name', 'bank_account', 'bank_holder', 'charge_min',
    'charge_expire_minutes', 'coin_symbol', 'coin_network', 'coin_wallet', 'coin_krw_rate',
  ];
  const patch = {};
  for (const k of keys) if (req.body[k] !== undefined) patch[k] = req.body[k];
  setSettings(patch);
  await refreshPanel(); // 패널 임베드 즉시 갱신
  res.redirect('/settings?saved=1');
});

/* ---------------- 카테고리 ---------------- */
router.get('/categories', (req, res) => {
  render(res, 'categories', { active: 'categories', user: req.session.user, categories: Categories.all() });
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
  });
  res.redirect('/products');
});
router.post('/products/:id/delete', (req, res) => {
  Products.remove(parseInt(req.params.id, 10));
  res.redirect('/products');
});

/* ---------------- 재고 ---------------- */
router.get('/products/:id/stock', (req, res) => {
  const product = Products.get(parseInt(req.params.id, 10));
  if (!product) return res.redirect('/products');
  render(res, 'stock', {
    active: 'products',
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

/* ---------------- 충전 요청 관리 ---------------- */
router.get('/charges', (req, res) => {
  const list = Charges.all(200).map((c) => ({ ...c, userObj: Users.get(c.discord_id) }));
  render(res, 'charges', {
    active: 'charges',
    user: req.session.user,
    charges: list,
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

/* ---------------- 유저 관리 ---------------- */
router.get('/users', (req, res) => {
  render(res, 'users', { active: 'users', user: req.session.user, users: Users.all() });
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

/* ---------------- 패널 설치/갱신 ---------------- */
router.post('/panel/refresh', async (req, res) => {
  const ok = await refreshPanel();
  res.redirect('/settings?saved=' + (ok ? 'panel' : 'panelfail'));
});

module.exports = { router, setPanelRefresher };
