'use strict';

const db = require('./db');

const now = () => Date.now();

/* =========================================================
 * Settings (상점명/설명/임베드/계좌/코인 등 전역 설정)
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
  // 계좌충전 정보 (PG 미사용)
  bank_name: '',
  bank_account: '',
  bank_holder: '',
  charge_min: '1000',
  charge_expire_minutes: '30',
  // 코인충전 정보
  coin_symbol: 'USDT',
  coin_network: 'TRC20',
  coin_wallet: '',
  coin_krw_rate: '1400', // 1 코인 = ? 원
};

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (row) return row.value;
  return DEFAULT_SETTINGS[key] !== undefined ? DEFAULT_SETTINGS[key] : '';
}

function getAllSettings() {
  const out = { ...DEFAULT_SETTINGS };
  for (const row of db.prepare('SELECT key, value FROM settings').all()) {
    out[row.key] = row.value;
  }
  return out;
}

const setSettingStmt = db.prepare(
  'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
);
function setSetting(key, value) {
  setSettingStmt.run(key, value == null ? '' : String(value));
}
function setSettings(obj) {
  const tx = db.transaction((entries) => {
    for (const [k, v] of entries) setSetting(k, v);
  });
  tx(Object.entries(obj));
}

/* =========================================================
 * Categories
 * =======================================================*/
const Categories = {
  all() {
    return db
      .prepare('SELECT * FROM categories ORDER BY position ASC, id ASC')
      .all();
  },
  get(id) {
    return db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
  },
  create({ name, description = '', emoji = '', position = 0 }) {
    const info = db
      .prepare(
        'INSERT INTO categories (name, description, emoji, position, created_at) VALUES (?,?,?,?,?)'
      )
      .run(name, description, emoji, position, now());
    return info.lastInsertRowid;
  },
  update(id, { name, description, emoji, position }) {
    db.prepare(
      'UPDATE categories SET name=?, description=?, emoji=?, position=? WHERE id=?'
    ).run(name, description, emoji, position, id);
  },
  remove(id) {
    db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  },
};

/* =========================================================
 * Products
 * =======================================================*/
const Products = {
  all() {
    return db
      .prepare('SELECT * FROM products ORDER BY position ASC, id ASC')
      .all();
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
  create(p) {
    const info = db
      .prepare(
        `INSERT INTO products (category_id, name, description, emoji, price, min_role_id, position, is_active, created_at)
         VALUES (?,?,?,?,?,?,?,?,?)`
      )
      .run(
        p.category_id,
        p.name,
        p.description || '',
        p.emoji || '',
        p.price || 0,
        p.min_role_id || '',
        p.position || 0,
        p.is_active === undefined ? 1 : p.is_active,
        now()
      );
    return info.lastInsertRowid;
  },
  update(id, p) {
    db.prepare(
      `UPDATE products SET category_id=?, name=?, description=?, emoji=?, price=?, min_role_id=?, position=?, is_active=? WHERE id=?`
    ).run(
      p.category_id,
      p.name,
      p.description || '',
      p.emoji || '',
      p.price || 0,
      p.min_role_id || '',
      p.position || 0,
      p.is_active === undefined ? 1 : p.is_active,
      id
    );
  },
  remove(id) {
    db.prepare('DELETE FROM products WHERE id = ?').run(id);
  },
  stockCount(productId) {
    const row = db
      .prepare(
        "SELECT COUNT(*) c FROM stock WHERE product_id=? AND status='available'"
      )
      .get(productId);
    return row.c;
  },
};

/* =========================================================
 * Stock
 * =======================================================*/
const Stock = {
  listByProduct(productId) {
    return db
      .prepare('SELECT * FROM stock WHERE product_id=? ORDER BY id ASC')
      .all(productId);
  },
  addBulk(productId, contents) {
    const stmt = db.prepare(
      "INSERT INTO stock (product_id, content, status, created_at) VALUES (?,?,'available',?)"
    );
    const tx = db.transaction((list) => {
      for (const c of list) {
        const trimmed = String(c).trim();
        if (trimmed) stmt.run(productId, trimmed, now());
      }
    });
    tx(contents);
  },
  remove(id) {
    db.prepare('DELETE FROM stock WHERE id=? AND status<>\'sold\'').run(id);
  },
  // 판매 가능한 재고를 원자적으로 하나 확보 (동시 구매 방지)
  reserveOne(productId, buyerId) {
    const tx = db.transaction(() => {
      const item = db
        .prepare(
          "SELECT * FROM stock WHERE product_id=? AND status='available' ORDER BY id ASC LIMIT 1"
        )
        .get(productId);
      if (!item) return null;
      db.prepare(
        "UPDATE stock SET status='sold', sold_to=?, sold_at=? WHERE id=?"
      ).run(buyerId, now(), item.id);
      return item;
    });
    return tx();
  },
};

/* =========================================================
 * Users & 잔액
 * =======================================================*/
const Users = {
  get(discordId) {
    return db.prepare('SELECT * FROM users WHERE discord_id=?').get(discordId);
  },
  ensure(discordId, username = '') {
    let u = Users.get(discordId);
    if (!u) {
      db.prepare(
        'INSERT INTO users (discord_id, username, balance, created_at) VALUES (?,?,0,?)'
      ).run(discordId, username, now());
      u = Users.get(discordId);
    } else if (username && u.username !== username) {
      db.prepare('UPDATE users SET username=? WHERE discord_id=?').run(
        username,
        discordId
      );
    }
    return u;
  },
  all() {
    return db
      .prepare('SELECT * FROM users ORDER BY balance DESC, created_at DESC')
      .all();
  },
  setDepositName(discordId, name) {
    db.prepare('UPDATE users SET deposit_name=? WHERE discord_id=?').run(
      name,
      discordId
    );
  },
  // 잔액 증감 + 원장 기록 (원자적)
  adjustBalance(discordId, delta, type, memo = '') {
    const tx = db.transaction(() => {
      Users.ensure(discordId);
      const u = Users.get(discordId);
      const after = u.balance + delta;
      if (after < 0) throw new Error('INSUFFICIENT_BALANCE');
      db.prepare('UPDATE users SET balance=? WHERE discord_id=?').run(
        after,
        discordId
      );
      if (delta > 0 && type === 'charge') {
        db.prepare(
          'UPDATE users SET total_charged = total_charged + ? WHERE discord_id=?'
        ).run(delta, discordId);
      }
      if (delta < 0 && type === 'purchase') {
        db.prepare(
          'UPDATE users SET total_spent = total_spent + ? WHERE discord_id=?'
        ).run(-delta, discordId);
      }
      db.prepare(
        'INSERT INTO transactions (discord_id, type, amount, balance_after, memo, created_at) VALUES (?,?,?,?,?,?)'
      ).run(discordId, type, delta, after, memo, now());
      return after;
    });
    return tx();
  },
  transactions(discordId, limit = 20) {
    return db
      .prepare(
        'SELECT * FROM transactions WHERE discord_id=? ORDER BY id DESC LIMIT ?'
      )
      .all(discordId, limit);
  },
};

/* =========================================================
 * Purchases
 * =======================================================*/
const Purchases = {
  create(rec) {
    db.prepare(
      `INSERT INTO purchases (discord_id, product_id, product_name, stock_id, price, content, created_at)
       VALUES (?,?,?,?,?,?,?)`
    ).run(
      rec.discord_id,
      rec.product_id,
      rec.product_name,
      rec.stock_id,
      rec.price,
      rec.content,
      now()
    );
  },
  byUser(discordId, limit = 20) {
    return db
      .prepare(
        'SELECT * FROM purchases WHERE discord_id=? ORDER BY id DESC LIMIT ?'
      )
      .all(discordId, limit);
  },
  recent(limit = 50) {
    return db
      .prepare('SELECT * FROM purchases ORDER BY id DESC LIMIT ?')
      .all(limit);
  },
};

/* =========================================================
 * Charge Requests
 * =======================================================*/
const Charges = {
  create(rec) {
    const info = db
      .prepare(
        `INSERT INTO charge_requests
         (discord_id, method, amount, expected_amount, depositor_name, coin_symbol, coin_amount, address, status, memo, created_at)
         VALUES (?,?,?,?,?,?,?,?, 'pending', ?, ?)`
      )
      .run(
        rec.discord_id,
        rec.method,
        rec.amount,
        rec.expected_amount,
        rec.depositor_name || '',
        rec.coin_symbol || '',
        rec.coin_amount || '',
        rec.address || '',
        rec.memo || '',
        now()
      );
    return Charges.get(info.lastInsertRowid);
  },
  get(id) {
    return db.prepare('SELECT * FROM charge_requests WHERE id=?').get(id);
  },
  pending() {
    return db
      .prepare("SELECT * FROM charge_requests WHERE status='pending' ORDER BY id DESC")
      .all();
  },
  all(limit = 100) {
    return db
      .prepare('SELECT * FROM charge_requests ORDER BY id DESC LIMIT ?')
      .all(limit);
  },
  pendingByUser(discordId) {
    return db
      .prepare(
        "SELECT * FROM charge_requests WHERE discord_id=? AND status='pending' ORDER BY id DESC"
      )
      .all(discordId);
  },
  // 계좌: 입금자명 + 금액으로 매칭
  findPendingAccountMatch(depositor, amount) {
    const rows = db
      .prepare(
        "SELECT * FROM charge_requests WHERE method='account' AND status='pending' AND expected_amount=? ORDER BY id ASC"
      )
      .all(amount);
    if (!rows.length) return null;
    if (depositor) {
      const norm = String(depositor).replace(/\s/g, '');
      const named = rows.find(
        (r) => r.depositor_name && norm.includes(r.depositor_name.replace(/\s/g, ''))
      );
      if (named) return named;
    }
    return rows[0];
  },
  findPendingCoinMatch(amountStr) {
    return db
      .prepare(
        "SELECT * FROM charge_requests WHERE method='coin' AND status='pending' AND coin_amount=? ORDER BY id ASC LIMIT 1"
      )
      .get(String(amountStr));
  },
  setStatus(id, status, memo) {
    db.prepare(
      'UPDATE charge_requests SET status=?, resolved_at=?, memo=COALESCE(?, memo) WHERE id=?'
    ).run(status, now(), memo === undefined ? null : memo, id);
  },
  expireOld() {
    const minutes = parseInt(getSetting('charge_expire_minutes') || '30', 10);
    const cutoff = now() - minutes * 60 * 1000;
    const rows = db
      .prepare(
        "SELECT id FROM charge_requests WHERE status='pending' AND created_at < ?"
      )
      .all(cutoff);
    for (const r of rows) Charges.setStatus(r.id, 'expired', '시간초과 자동만료');
    return rows.map((r) => r.id);
  },
};

/* =========================================================
 * Bank notifications 원장
 * =======================================================*/
const BankNotifications = {
  create(rec) {
    const info = db
      .prepare(
        'INSERT INTO bank_notifications (raw, depositor, amount, matched, charge_id, created_at) VALUES (?,?,?,?,?,?)'
      )
      .run(
        rec.raw || '',
        rec.depositor || '',
        rec.amount || null,
        rec.matched ? 1 : 0,
        rec.charge_id || null,
        now()
      );
    return info.lastInsertRowid;
  },
  recent(limit = 50) {
    return db
      .prepare('SELECT * FROM bank_notifications ORDER BY id DESC LIMIT ?')
      .all(limit);
  },
};

/* =========================================================
 * 통계
 * =======================================================*/
function stats() {
  const userCount = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  const productCount = db.prepare('SELECT COUNT(*) c FROM products').get().c;
  const stockCount = db
    .prepare("SELECT COUNT(*) c FROM stock WHERE status='available'")
    .get().c;
  const soldCount = db
    .prepare("SELECT COUNT(*) c FROM stock WHERE status='sold'")
    .get().c;
  const revenue =
    db.prepare("SELECT COALESCE(SUM(price),0) s FROM purchases").get().s;
  const pendingCharges = db
    .prepare("SELECT COUNT(*) c FROM charge_requests WHERE status='pending'")
    .get().c;
  const totalBalance = db
    .prepare('SELECT COALESCE(SUM(balance),0) s FROM users')
    .get().s;
  return {
    userCount,
    productCount,
    stockCount,
    soldCount,
    revenue,
    pendingCharges,
    totalBalance,
  };
}

module.exports = {
  db,
  DEFAULT_SETTINGS,
  getSetting,
  getAllSettings,
  setSetting,
  setSettings,
  Categories,
  Products,
  Stock,
  Users,
  Purchases,
  Charges,
  BankNotifications,
  stats,
};
