'use strict';

const db = require('./db');
const config = require('../config');

const now = () => Date.now();

/* =========================================================
 * Settings (길드별)
 * =======================================================*/
const DEFAULT_SETTINGS = {
  shop_name: 'MungChi Market',
  shop_description:
    '📢 **자판기 이용 안내**\n• 아래 버튼으로 구매 / 충전하실 수 있습니다.\n• 충전은 **자동 잔액충전** 시스템으로 즉시 반영됩니다.\n\n🚨 **충전 시 주의 사항**\n• 최초 입력한 입금자명으로 고정됩니다.\n\n📌 **규정 확인**\n• 구매 및 충전 시 위 내용을 모두 숙지한 것으로 간주합니다.',
  embed_color: '#57F287',
  embed_image: '',
  embed_thumbnail: '',
  embed_footer: 'MungChi Market · 자동 자판기',
  panel_channel_id: '',
  panel_message_id: '',
  bank_name: '',
  bank_account: '',
  bank_holder: '',
  charge_min: '1000',
  charge_expire_minutes: '30',
  coin_krw_rate: '1400',
};

function getSetting(gid, key) {
  const row = db.prepare('SELECT value FROM guild_settings WHERE guild_id=? AND key=?').get(gid, key);
  if (row) return row.value;
  return DEFAULT_SETTINGS[key] !== undefined ? DEFAULT_SETTINGS[key] : '';
}

function getAllSettings(gid) {
  const out = { ...DEFAULT_SETTINGS };
  for (const row of db.prepare('SELECT key, value FROM guild_settings WHERE guild_id=?').all(gid)) {
    out[row.key] = row.value;
  }
  return out;
}

const setSettingStmt = db.prepare(
  'INSERT INTO guild_settings (guild_id, key, value) VALUES (?,?,?) ON CONFLICT(guild_id, key) DO UPDATE SET value=excluded.value'
);
function setSetting(gid, key, value) {
  setSettingStmt.run(gid, key, value == null ? '' : String(value));
}
function setSettings(gid, obj) {
  const tx = db.transaction((entries) => {
    for (const [k, v] of entries) setSetting(gid, k, v);
  });
  tx(Object.entries(obj));
}

/* =========================================================
 * Guilds & 라이선스(구독)
 * =======================================================*/
const Guilds = {
  get(gid) {
    return db.prepare('SELECT * FROM guilds WHERE guild_id=?').get(gid);
  },
  ensure(gid, name = '') {
    let g = Guilds.get(gid);
    if (!g) {
      db.prepare('INSERT INTO guilds (guild_id, name, created_at) VALUES (?,?,?)').run(gid, name, now());
      g = Guilds.get(gid);
    } else if (name && g.name !== name) {
      db.prepare('UPDATE guilds SET name=? WHERE guild_id=?').run(name, gid);
    }
    return g;
  },
  all() {
    return db.prepare('SELECT * FROM guilds ORDER BY created_at DESC').all();
  },
  forManager(userId) {
    return db.prepare('SELECT * FROM guilds WHERE manager_id=? ORDER BY created_at DESC').all(userId);
  },
  isActive(gid) {
    const g = Guilds.get(gid);
    return !!(g && g.expires_at && g.expires_at > now());
  },
  // 라이선스 적용 (기존 만료일에 이어붙임) — 알림 단계도 초기화
  activate(gid, plan, days, key, userId, guildName = '') {
    const g = Guilds.ensure(gid, guildName);
    const base = Math.max(now(), g.expires_at || 0);
    const expires = base + days * 24 * 60 * 60 * 1000;
    db.prepare(
      "UPDATE guilds SET plan=?, activated_at=?, expires_at=?, last_key=?, notify_stage='', manager_id=COALESCE(NULLIF(manager_id,''), ?) WHERE guild_id=?"
    ).run(plan, now(), expires, key, userId, gid);
    // 최초 활성화 시 기본 코인 시드
    seedCoinsForGuild(gid);
    return Guilds.get(gid);
  },
  setNotifyStage(gid, stage) {
    db.prepare('UPDATE guilds SET notify_stage=? WHERE guild_id=?').run(stage, gid);
  },
  // 구독 이력이 있는(만료일이 설정된) 길드 — 만료 알림 대상
  withSubscription() {
    return db.prepare('SELECT * FROM guilds WHERE expires_at > 0').all();
  },
};

const LicenseKeys = {
  gen15() {
    let k = '';
    for (let i = 0; i < 15; i++) k += Math.floor(Math.random() * 10);
    return k;
  },
  create(plan, createdBy = '', memo = '') {
    let key;
    for (let i = 0; i < 50; i++) {
      key = LicenseKeys.gen15();
      if (!db.prepare('SELECT 1 FROM license_keys WHERE key=?').get(key)) break;
    }
    db.prepare(
      'INSERT INTO license_keys (key, plan, created_by, memo, created_at) VALUES (?,?,?,?,?)'
    ).run(key, plan, createdBy, memo, now());
    return key;
  },
  createBatch(plan, count, createdBy = '', memo = '') {
    const keys = [];
    const tx = db.transaction(() => {
      for (let i = 0; i < count; i++) keys.push(LicenseKeys.create(plan, createdBy, memo));
    });
    tx();
    return keys;
  },
  get(key) {
    return db.prepare('SELECT * FROM license_keys WHERE key=?').get(key);
  },
  all(limit = 200) {
    return db.prepare('SELECT * FROM license_keys ORDER BY id DESC LIMIT ?').all(limit);
  },
  unusedCount() {
    return db.prepare('SELECT COUNT(*) c FROM license_keys WHERE used=0').get().c;
  },
  remove(id) {
    db.prepare('DELETE FROM license_keys WHERE id=? AND used=0').run(id);
  },
  // 키 등록 → 구독 활성화 (원자적)
  redeem(rawKey, gid, userId, guildName = '') {
    const key = String(rawKey || '').replace(/\D/g, '');
    if (key.length !== 15) return { ok: false, error: 'FORMAT' };
    const tx = db.transaction(() => {
      const row = LicenseKeys.get(key);
      if (!row) return { ok: false, error: 'INVALID' };
      if (row.used) return { ok: false, error: 'USED' };
      const plan = config.plans[row.plan];
      if (!plan) return { ok: false, error: 'BAD_PLAN' };
      db.prepare(
        'UPDATE license_keys SET used=1, used_by_guild=?, used_by_user=?, used_at=? WHERE id=?'
      ).run(gid, userId, now(), row.id);
      const g = Guilds.activate(gid, row.plan, plan.days, key, userId, guildName);
      return { ok: true, plan: row.plan, planLabel: plan.label, expires_at: g.expires_at, guild: g };
    });
    return tx();
  },
};

/* =========================================================
 * Categories
 * =======================================================*/
const Categories = {
  all(gid) {
    return db.prepare('SELECT * FROM categories WHERE guild_id=? ORDER BY position ASC, id ASC').all(gid);
  },
  get(id) {
    return db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
  },
  create(gid, { name, description = '', emoji = '', position = 0 }) {
    const info = db
      .prepare('INSERT INTO categories (guild_id, name, description, emoji, position, created_at) VALUES (?,?,?,?,?,?)')
      .run(gid, name, description, emoji, position, now());
    return info.lastInsertRowid;
  },
  update(id, { name, description, emoji, position }) {
    db.prepare('UPDATE categories SET name=?, description=?, emoji=?, position=? WHERE id=?')
      .run(name, description, emoji, position, id);
  },
  remove(id) {
    db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  },
};

/* =========================================================
 * Products
 * =======================================================*/
const Products = {
  all(gid) {
    return db.prepare('SELECT * FROM products WHERE guild_id=? ORDER BY position ASC, id ASC').all(gid);
  },
  byCategory(categoryId, onlyActive = true) {
    const q = onlyActive
      ? 'SELECT * FROM products WHERE category_id=? AND is_active=1 ORDER BY position ASC, id ASC'
      : 'SELECT * FROM products WHERE category_id=? ORDER BY position ASC, id ASC';
    return db.prepare(q).all(categoryId);
  },
  get(id) {
    return db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  },
  create(gid, p) {
    const info = db
      .prepare(
        `INSERT INTO products (guild_id, category_id, name, description, emoji, price, min_role_id, position, is_active, delivery_type, roblox_item, roblox_game, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        gid, p.category_id, p.name, p.description || '', p.emoji || '', p.price || 0,
        p.min_role_id || '', p.position || 0, p.is_active === undefined ? 1 : p.is_active,
        p.delivery_type || 'stock', p.roblox_item || '', p.roblox_game || 'Grow a Garden 2', now()
      );
    return info.lastInsertRowid;
  },
  update(id, p) {
    db.prepare(
      `UPDATE products SET category_id=?, name=?, description=?, emoji=?, price=?, min_role_id=?, position=?, is_active=?, delivery_type=?, roblox_item=?, roblox_game=? WHERE id=?`
    ).run(
      p.category_id, p.name, p.description || '', p.emoji || '', p.price || 0, p.min_role_id || '',
      p.position || 0, p.is_active === undefined ? 1 : p.is_active,
      p.delivery_type || 'stock', p.roblox_item || '', p.roblox_game || 'Grow a Garden 2', id
    );
  },
  remove(id) {
    db.prepare('DELETE FROM products WHERE id = ?').run(id);
  },
  stockCount(productId) {
    return db.prepare("SELECT COUNT(*) c FROM stock WHERE product_id=? AND status='available'").get(productId).c;
  },
};

/* =========================================================
 * Stock
 * =======================================================*/
const Stock = {
  listByProduct(productId) {
    return db.prepare('SELECT * FROM stock WHERE product_id=? ORDER BY id ASC').all(productId);
  },
  addBulk(gid, productId, contents) {
    const stmt = db.prepare(
      "INSERT INTO stock (guild_id, product_id, content, status, created_at) VALUES (?,?,?,'available',?)"
    );
    const tx = db.transaction((list) => {
      for (const c of list) {
        const trimmed = String(c).trim();
        if (trimmed) stmt.run(gid, productId, trimmed, now());
      }
    });
    tx(contents);
  },
  remove(id) {
    db.prepare("DELETE FROM stock WHERE id=? AND status<>'sold'").run(id);
  },
  reserveOne(productId, buyerId) {
    const tx = db.transaction(() => {
      const item = db
        .prepare("SELECT * FROM stock WHERE product_id=? AND status='available' ORDER BY id ASC LIMIT 1")
        .get(productId);
      if (!item) return null;
      db.prepare("UPDATE stock SET status='sold', sold_to=?, sold_at=? WHERE id=?").run(buyerId, now(), item.id);
      return item;
    });
    return tx();
  },
};

/* =========================================================
 * Users & 잔액 (길드별)
 * =======================================================*/
const Users = {
  get(gid, discordId) {
    return db.prepare('SELECT * FROM users WHERE guild_id=? AND discord_id=?').get(gid, discordId);
  },
  ensure(gid, discordId, username = '') {
    let u = Users.get(gid, discordId);
    if (!u) {
      db.prepare('INSERT INTO users (guild_id, discord_id, username, balance, created_at) VALUES (?,?,?,0,?)')
        .run(gid, discordId, username, now());
      u = Users.get(gid, discordId);
    } else if (username && u.username !== username) {
      db.prepare('UPDATE users SET username=? WHERE guild_id=? AND discord_id=?').run(username, gid, discordId);
    }
    return u;
  },
  all(gid) {
    return db.prepare('SELECT * FROM users WHERE guild_id=? ORDER BY balance DESC, created_at DESC').all(gid);
  },
  setDepositName(gid, discordId, name) {
    db.prepare('UPDATE users SET deposit_name=? WHERE guild_id=? AND discord_id=?').run(name, gid, discordId);
  },
  setRoblox(gid, discordId, username, userId) {
    Users.ensure(gid, discordId);
    db.prepare('UPDATE users SET roblox_username=?, roblox_userid=? WHERE guild_id=? AND discord_id=?')
      .run(username || '', userId || '', gid, discordId);
  },
  adjustBalance(gid, discordId, delta, type, memo = '') {
    const tx = db.transaction(() => {
      Users.ensure(gid, discordId);
      const u = Users.get(gid, discordId);
      const after = u.balance + delta;
      if (after < 0) throw new Error('INSUFFICIENT_BALANCE');
      db.prepare('UPDATE users SET balance=? WHERE guild_id=? AND discord_id=?').run(after, gid, discordId);
      if (delta > 0 && type === 'charge')
        db.prepare('UPDATE users SET total_charged = total_charged + ? WHERE guild_id=? AND discord_id=?').run(delta, gid, discordId);
      if (delta < 0 && type === 'purchase')
        db.prepare('UPDATE users SET total_spent = total_spent + ? WHERE guild_id=? AND discord_id=?').run(-delta, gid, discordId);
      db.prepare('INSERT INTO transactions (guild_id, discord_id, type, amount, balance_after, memo, created_at) VALUES (?,?,?,?,?,?,?)')
        .run(gid, discordId, type, delta, after, memo, now());
      return after;
    });
    return tx();
  },
  transactions(gid, discordId, limit = 20) {
    return db.prepare('SELECT * FROM transactions WHERE guild_id=? AND discord_id=? ORDER BY id DESC LIMIT ?')
      .all(gid, discordId, limit);
  },
};

/* =========================================================
 * Purchases
 * =======================================================*/
const Purchases = {
  create(gid, rec) {
    const info = db.prepare(
      `INSERT INTO purchases (guild_id, discord_id, product_id, product_name, stock_id, price, content, created_at)
       VALUES (?,?,?,?,?,?,?,?)`
    ).run(gid, rec.discord_id, rec.product_id, rec.product_name, rec.stock_id, rec.price, rec.content, now());
    return info.lastInsertRowid;
  },
  byUser(gid, discordId, limit = 20) {
    return db.prepare('SELECT * FROM purchases WHERE guild_id=? AND discord_id=? ORDER BY id DESC LIMIT ?')
      .all(gid, discordId, limit);
  },
  recent(gid, limit = 50) {
    return db.prepare('SELECT * FROM purchases WHERE guild_id=? ORDER BY id DESC LIMIT ?').all(gid, limit);
  },
};

/* =========================================================
 * Charge Requests
 * =======================================================*/
const Charges = {
  create(gid, rec) {
    const info = db
      .prepare(
        `INSERT INTO charge_requests
         (guild_id, discord_id, method, amount, expected_amount, depositor_name, coin_symbol, coin_network, coin_amount, address, status, memo, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?, 'pending', ?, ?)`
      )
      .run(
        gid, rec.discord_id, rec.method, rec.amount, rec.expected_amount, rec.depositor_name || '',
        rec.coin_symbol || '', rec.coin_network || '', rec.coin_amount || '', rec.address || '', rec.memo || '', now()
      );
    return Charges.get(info.lastInsertRowid);
  },
  get(id) {
    return db.prepare('SELECT * FROM charge_requests WHERE id=?').get(id);
  },
  pending(gid) {
    return db.prepare("SELECT * FROM charge_requests WHERE guild_id=? AND status='pending' ORDER BY id DESC").all(gid);
  },
  all(gid, limit = 100) {
    return db.prepare('SELECT * FROM charge_requests WHERE guild_id=? ORDER BY id DESC LIMIT ?').all(gid, limit);
  },
  pendingByUser(gid, discordId) {
    return db.prepare("SELECT * FROM charge_requests WHERE guild_id=? AND discord_id=? AND status='pending' ORDER BY id DESC")
      .all(gid, discordId);
  },
  // 계좌: 입금자명+금액 매칭 (전 길드 대상 — 매칭된 charge 의 guild_id 로 처리)
  findPendingAccountMatch(depositor, amount) {
    const rows = db.prepare(
      "SELECT * FROM charge_requests WHERE method='account' AND status='pending' AND expected_amount=? ORDER BY id ASC"
    ).all(amount);
    if (!rows.length) return null;
    if (depositor) {
      const norm = String(depositor).replace(/\s/g, '');
      const named = rows.find((r) => r.depositor_name && norm.includes(r.depositor_name.replace(/\s/g, '')));
      if (named) return named;
    }
    return rows[0];
  },
  findPendingCoinMatch(amountStr, symbol, network) {
    const rows = db.prepare(
      "SELECT * FROM charge_requests WHERE method='coin' AND status='pending' AND coin_amount=? ORDER BY id ASC"
    ).all(String(amountStr));
    if (!rows.length) return null;
    const norm = (v) => String(v || '').toUpperCase().replace(/\s|-|_/g, '');
    let filtered = rows;
    if (symbol) filtered = filtered.filter((r) => norm(r.coin_symbol) === norm(symbol));
    if (network) filtered = filtered.filter((r) => norm(r.coin_network) === norm(network));
    return (filtered[0] || (symbol || network ? null : rows[0])) || null;
  },
  setStatus(id, status, memo) {
    db.prepare('UPDATE charge_requests SET status=?, resolved_at=?, memo=COALESCE(?, memo) WHERE id=?')
      .run(status, now(), memo === undefined ? null : memo, id);
  },
  expireOld() {
    const rows = db.prepare("SELECT id, guild_id, created_at FROM charge_requests WHERE status='pending'").all();
    const expired = [];
    for (const r of rows) {
      const minutes = parseInt(getSetting(r.guild_id, 'charge_expire_minutes') || '30', 10);
      if (r.created_at < now() - minutes * 60 * 1000) {
        Charges.setStatus(r.id, 'expired', '시간초과 자동만료');
        expired.push(r.id);
      }
    }
    return expired;
  },
};

/* =========================================================
 * Bank notifications 원장
 * =======================================================*/
const BankNotifications = {
  create(rec) {
    const info = db.prepare(
      'INSERT INTO bank_notifications (guild_id, raw, depositor, amount, matched, charge_id, created_at) VALUES (?,?,?,?,?,?,?)'
    ).run(rec.guild_id || '', rec.raw || '', rec.depositor || '', rec.amount || null, rec.matched ? 1 : 0, rec.charge_id || null, now());
    return info.lastInsertRowid;
  },
  recent(gid, limit = 50) {
    return db.prepare('SELECT * FROM bank_notifications WHERE guild_id=? ORDER BY id DESC LIMIT ?').all(gid, limit);
  },
};

/* =========================================================
 * VIP Servers
 * =======================================================*/
const VipServers = {
  all(gid) {
    return db.prepare('SELECT * FROM vip_servers WHERE guild_id=? ORDER BY id ASC').all(gid);
  },
  get(id) {
    return db.prepare('SELECT * FROM vip_servers WHERE id=?').get(id);
  },
  create(gid, v) {
    const info = db.prepare(
      `INSERT INTO vip_servers (guild_id, name, game, vip_link, puppet_name, capacity, status, notes, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).run(gid, v.name, v.game || 'Grow a Garden 2', v.vip_link, v.puppet_name || '',
      parseInt(v.capacity || '0', 10), v.status || 'active', v.notes || '', now());
    return info.lastInsertRowid;
  },
  update(id, v) {
    db.prepare(
      `UPDATE vip_servers SET name=?, game=?, vip_link=?, puppet_name=?, capacity=?, status=?, notes=? WHERE id=?`
    ).run(v.name, v.game || 'Grow a Garden 2', v.vip_link, v.puppet_name || '',
      parseInt(v.capacity || '0', 10), v.status || 'active', v.notes || '', id);
  },
  remove(id) {
    db.prepare('DELETE FROM vip_servers WHERE id=?').run(id);
  },
  pickForGame(gid, game) {
    const servers = db.prepare("SELECT * FROM vip_servers WHERE guild_id=? AND status='active'").all(gid)
      .filter((s) => !game || !s.game || s.game === game);
    if (!servers.length) return null;
    const load = (sid) => db.prepare("SELECT COUNT(*) c FROM roblox_deliveries WHERE vip_server_id=? AND status IN ('queued','joined')").get(sid).c;
    servers.sort((a, b) => {
      const la = load(a.id), lb = load(b.id);
      const overA = a.capacity > 0 && la >= a.capacity ? 1 : 0;
      const overB = b.capacity > 0 && lb >= b.capacity ? 1 : 0;
      if (overA !== overB) return overA - overB;
      return la - lb;
    });
    return servers[0];
  },
};

/* =========================================================
 * Roblox Deliveries
 * =======================================================*/
const Deliveries = {
  create(d) {
    const info = db.prepare(
      `INSERT INTO roblox_deliveries
       (guild_id, purchase_id, discord_id, product_id, product_name, roblox_item, quantity, price,
        roblox_username, roblox_userid, vip_server_id, status, note, created_at, queued_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      d.guild_id || '', d.purchase_id || null, d.discord_id, d.product_id || null, d.product_name || '',
      d.roblox_item || '', d.quantity || 1, d.price || 0, d.roblox_username || '', d.roblox_userid || '',
      d.vip_server_id || null, d.status || 'awaiting_username', d.note || '', now(),
      d.status === 'queued' ? now() : null
    );
    return Deliveries.get(info.lastInsertRowid);
  },
  get(id) {
    return db.prepare('SELECT * FROM roblox_deliveries WHERE id=?').get(id);
  },
  all(gid, limit = 200) {
    return db.prepare('SELECT * FROM roblox_deliveries WHERE guild_id=? ORDER BY id DESC LIMIT ?').all(gid, limit);
  },
  queue(gid) {
    return db.prepare("SELECT * FROM roblox_deliveries WHERE guild_id=? AND status IN ('queued','joined') ORDER BY id ASC").all(gid);
  },
  queueAll() {
    return db.prepare("SELECT * FROM roblox_deliveries WHERE status IN ('queued','joined') ORDER BY id ASC").all();
  },
  pendingCount(gid) {
    return db.prepare("SELECT COUNT(*) c FROM roblox_deliveries WHERE guild_id=? AND status IN ('awaiting_username','queued','joined')").get(gid).c;
  },
  byUser(gid, discordId, limit = 20) {
    return db.prepare('SELECT * FROM roblox_deliveries WHERE guild_id=? AND discord_id=? ORDER BY id DESC LIMIT ?').all(gid, discordId, limit);
  },
  setUsername(id, username, userId) {
    db.prepare('UPDATE roblox_deliveries SET roblox_username=?, roblox_userid=? WHERE id=?').run(username, userId || '', id);
  },
  assignServer(id, serverId) {
    db.prepare('UPDATE roblox_deliveries SET vip_server_id=? WHERE id=?').run(serverId, id);
  },
  setStatus(id, status, extra = {}) {
    const stamps = { queued: 'queued_at', joined: 'joined_at', completed: 'completed_at' };
    db.prepare('UPDATE roblox_deliveries SET status=? WHERE id=?').run(status, id);
    if (stamps[status]) db.prepare(`UPDATE roblox_deliveries SET ${stamps[status]}=? WHERE id=?`).run(now(), id);
    if (extra.operator !== undefined) db.prepare('UPDATE roblox_deliveries SET operator=? WHERE id=?').run(extra.operator, id);
    if (extra.note !== undefined) db.prepare('UPDATE roblox_deliveries SET note=? WHERE id=?').run(extra.note, id);
    return Deliveries.get(id);
  },
};

/* =========================================================
 * Coins (길드별)
 * =======================================================*/
const Coins = {
  all(gid) {
    return db.prepare('SELECT * FROM coins WHERE guild_id=? ORDER BY position ASC, id ASC').all(gid);
  },
  enabled(gid) {
    return db.prepare("SELECT * FROM coins WHERE guild_id=? AND enabled=1 AND wallet<>'' ORDER BY position ASC, id ASC").all(gid);
  },
  enabledAll() {
    return db.prepare("SELECT * FROM coins WHERE enabled=1 AND wallet<>'' ORDER BY position ASC, id ASC").all();
  },
  get(id) {
    return db.prepare('SELECT * FROM coins WHERE id=?').get(id);
  },
  create(gid, c) {
    const info = db.prepare(
      'INSERT INTO coins (guild_id, symbol, network, wallet, krw_rate, decimals, enabled, position, created_at) VALUES (?,?,?,?,?,?,?,?,?)'
    ).run(gid, c.symbol, c.network, c.wallet || '', Number(c.krw_rate) || 0,
      parseInt(c.decimals || '6', 10), c.enabled ? 1 : 0, parseInt(c.position || '0', 10), now());
    return info.lastInsertRowid;
  },
  update(id, c) {
    db.prepare('UPDATE coins SET symbol=?, network=?, wallet=?, krw_rate=?, decimals=?, enabled=?, position=? WHERE id=?')
      .run(c.symbol, c.network, c.wallet || '', Number(c.krw_rate) || 0,
        parseInt(c.decimals || '6', 10), c.enabled ? 1 : 0, parseInt(c.position || '0', 10), id);
  },
  remove(id) {
    db.prepare('DELETE FROM coins WHERE id=?').run(id);
  },
};

// 길드 최초 활성화 시 기본 코인 시드
function seedCoinsForGuild(gid) {
  const count = db.prepare('SELECT COUNT(*) c FROM coins WHERE guild_id=?').get(gid).c;
  if (count > 0) return;
  const defaults = [
    { symbol: 'USDT', network: 'TRC20', krw_rate: 1400, decimals: 6, position: 0 },
    { symbol: 'USDT', network: 'BEP20', krw_rate: 1400, decimals: 18, position: 1 },
    { symbol: 'SOL', network: 'Solana', krw_rate: 200000, decimals: 9, position: 2 },
    { symbol: 'LTC', network: 'Litecoin', krw_rate: 130000, decimals: 8, position: 3 },
  ];
  for (const d of defaults) Coins.create(gid, { ...d, wallet: '', enabled: 1 });
}

/* =========================================================
 * 통계 / 대시보드 (길드별)
 * =======================================================*/
const LOW_STOCK_THRESHOLD = 5;

function startOfDay(offsetDays = 0) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  return d.getTime();
}
function revenueBetween(gid, start, end) {
  return db.prepare('SELECT COALESCE(SUM(price),0) s FROM purchases WHERE guild_id=? AND created_at>=? AND created_at<?').get(gid, start, end).s;
}
function ordersBetween(gid, start, end) {
  return db.prepare('SELECT COUNT(*) c FROM purchases WHERE guild_id=? AND created_at>=? AND created_at<?').get(gid, start, end).c;
}
function dailyRevenue(gid, days) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const start = startOfDay(-i), end = startOfDay(-i + 1);
    out.push({ date: start, revenue: revenueBetween(gid, start, end) });
  }
  return out;
}
function lowStockProducts(gid) {
  return Products.all(gid).filter((p) => p.is_active)
    .map((p) => ({ ...p, stock: Products.stockCount(p.id) }))
    .filter((p) => p.stock <= LOW_STOCK_THRESHOLD);
}
function chargeSuccessRate(gid) {
  const resolved = db.prepare("SELECT COUNT(*) c FROM charge_requests WHERE guild_id=? AND status IN ('approved','rejected','expired')").get(gid).c;
  const approved = db.prepare("SELECT COUNT(*) c FROM charge_requests WHERE guild_id=? AND status='approved'").get(gid).c;
  if (!resolved) return 100;
  return Math.round((approved / resolved) * 1000) / 10;
}
function dashboard(gid) {
  const todayStart = startOfDay(0), yStart = startOfDay(-1), tomorrow = startOfDay(1);
  const todayRevenue = revenueBetween(gid, todayStart, tomorrow);
  const yRevenue = revenueBetween(gid, yStart, todayStart);
  const todayOrders = ordersBetween(gid, todayStart, tomorrow);
  const yOrders = ordersBetween(gid, yStart, todayStart);
  const revPct = yRevenue > 0 ? Math.round(((todayRevenue - yRevenue) / yRevenue) * 1000) / 10 : null;
  return {
    todayRevenue, yRevenue, revPct, todayOrders, yOrders, orderDiff: todayOrders - yOrders,
    lowStock: lowStockProducts(gid),
    pendingCharges: db.prepare("SELECT COUNT(*) c FROM charge_requests WHERE guild_id=? AND status='pending'").get(gid).c,
    pendingDeliveries: Deliveries.pendingCount(gid),
    successRate: chargeSuccessRate(gid),
    daily7: dailyRevenue(gid, 7),
    daily30: dailyRevenue(gid, 30),
    recentOrders: Purchases.recent(gid, 6),
  };
}

/* =========================================================
 * 오너 통합 통계 (전 서버 집계)
 * =======================================================*/
function ownerOverview() {
  const nowMs = now();
  const guilds = Guilds.all().map((g) => {
    const revenue = db.prepare('SELECT COALESCE(SUM(price),0) s FROM purchases WHERE guild_id=?').get(g.guild_id).s;
    const orders = db.prepare('SELECT COUNT(*) c FROM purchases WHERE guild_id=?').get(g.guild_id).c;
    const users = db.prepare('SELECT COUNT(*) c FROM users WHERE guild_id=?').get(g.guild_id).c;
    const balance = db.prepare('SELECT COALESCE(SUM(balance),0) s FROM users WHERE guild_id=?').get(g.guild_id).s;
    const stock = db.prepare("SELECT COUNT(*) c FROM stock WHERE guild_id=? AND status='available'").get(g.guild_id).c;
    const pendingCharges = db.prepare("SELECT COUNT(*) c FROM charge_requests WHERE guild_id=? AND status='pending'").get(g.guild_id).c;
    const pendingDeliveries = db.prepare("SELECT COUNT(*) c FROM roblox_deliveries WHERE guild_id=? AND status IN ('awaiting_username','queued','joined')").get(g.guild_id).c;
    const todayRevenue = revenueBetween(g.guild_id, startOfDay(0), startOfDay(1));
    return {
      ...g,
      active: !!(g.expires_at && g.expires_at > nowMs),
      daysLeft: g.expires_at ? Math.max(0, Math.ceil((g.expires_at - nowMs) / 86400000)) : 0,
      revenue, orders, users, balance, stock, pendingCharges, pendingDeliveries, todayRevenue,
    };
  });

  // 전 서버 합산 일별 매출 (7/30일)
  const dailyAll = (days) => {
    const out = [];
    for (let i = days - 1; i >= 0; i--) {
      const start = startOfDay(-i), end = startOfDay(-i + 1);
      const revenue = db.prepare('SELECT COALESCE(SUM(price),0) s FROM purchases WHERE created_at>=? AND created_at<?').get(start, end).s;
      out.push({ date: start, revenue });
    }
    return out;
  };

  // 라이선스 현황 + 판매수익 추정 (요금제 가격 × 사용된 키)
  const keyRows = db.prepare('SELECT plan, COUNT(*) c FROM license_keys WHERE used=1 GROUP BY plan').all();
  let licenseRevenue = 0;
  const planSales = {};
  for (const r of keyRows) {
    const plan = config.plans[r.plan];
    planSales[r.plan] = r.c;
    if (plan && plan.price) licenseRevenue += plan.price * r.c;
  }

  return {
    guilds: guilds.sort((a, b) => b.revenue - a.revenue),
    totals: {
      guildCount: guilds.length,
      activeCount: guilds.filter((g) => g.active).length,
      revenue: guilds.reduce((s, g) => s + g.revenue, 0),
      todayRevenue: guilds.reduce((s, g) => s + g.todayRevenue, 0),
      orders: guilds.reduce((s, g) => s + g.orders, 0),
      users: guilds.reduce((s, g) => s + g.users, 0),
      balance: guilds.reduce((s, g) => s + g.balance, 0),
      pendingCharges: guilds.reduce((s, g) => s + g.pendingCharges, 0),
      pendingDeliveries: guilds.reduce((s, g) => s + g.pendingDeliveries, 0),
    },
    licenses: {
      unused: LicenseKeys.unusedCount(),
      used: keyRows.reduce((s, r) => s + r.c, 0),
      planSales,
      revenue: licenseRevenue,
    },
    daily7: dailyAll(7),
    daily30: dailyAll(30),
  };
}

module.exports = {
  db,
  DEFAULT_SETTINGS,
  getSetting, getAllSettings, setSetting, setSettings,
  Guilds, LicenseKeys,
  Categories, Products, Stock, Users, Purchases, Charges, BankNotifications,
  Coins, VipServers, Deliveries,
  seedCoinsForGuild,
  dashboard, dailyRevenue, lowStockProducts, chargeSuccessRate,
  ownerOverview,
};
