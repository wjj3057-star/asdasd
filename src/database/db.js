'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'market.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/* ============================================================
 * 멀티테넌트: 모든 도메인 데이터는 guild_id(디스코드 서버) 로 분리된다.
 * ==========================================================*/
db.exec(`
-- 길드(서버)별 설정 (상점명/설명/계좌 등)
CREATE TABLE IF NOT EXISTS guild_settings (
  guild_id TEXT NOT NULL,
  key      TEXT NOT NULL,
  value    TEXT,
  PRIMARY KEY (guild_id, key)
);

-- 길드 등록 + 구독(라이선스) 상태
CREATE TABLE IF NOT EXISTS guilds (
  guild_id     TEXT PRIMARY KEY,
  name         TEXT DEFAULT '',
  manager_id   TEXT DEFAULT '',     -- 라이선스를 등록한 서버 관리자
  plan         TEXT DEFAULT '',     -- 1m | 3m
  activated_at INTEGER,
  expires_at   INTEGER DEFAULT 0,   -- 구독 만료 (ms). 0=미구독
  last_key     TEXT DEFAULT '',
  notify_stage TEXT DEFAULT '',     -- 만료 알림 발송 단계 ('' | 3d | 1d | expired)
  created_at   INTEGER NOT NULL
);

-- 일회용 라이선스 키 (소유자 발급)
CREATE TABLE IF NOT EXISTS license_keys (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  key           TEXT UNIQUE NOT NULL,   -- 15자리 숫자
  plan          TEXT NOT NULL,          -- 1m | 3m
  created_by    TEXT DEFAULT '',
  memo          TEXT DEFAULT '',
  used          INTEGER DEFAULT 0,
  used_by_guild TEXT DEFAULT '',
  used_by_user  TEXT DEFAULT '',
  used_at       INTEGER,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT NOT NULL DEFAULT '',
  name        TEXT NOT NULL,
  description TEXT DEFAULT '',
  emoji       TEXT DEFAULT '',
  position    INTEGER DEFAULT 0,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id      TEXT NOT NULL DEFAULT '',
  category_id   INTEGER NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT DEFAULT '',
  emoji         TEXT DEFAULT '',
  price         INTEGER NOT NULL DEFAULT 0,
  min_role_id   TEXT DEFAULT '',
  position      INTEGER DEFAULT 0,
  is_active     INTEGER DEFAULT 1,
  delivery_type TEXT DEFAULT 'stock',
  roblox_item   TEXT DEFAULT '',
  roblox_game   TEXT DEFAULT 'Grow a Garden 2',
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS stock (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT NOT NULL DEFAULT '',
  product_id  INTEGER NOT NULL,
  content     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'available',
  sold_to     TEXT DEFAULT '',
  sold_at     INTEGER,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  guild_id     TEXT NOT NULL DEFAULT '',
  discord_id   TEXT NOT NULL,
  username     TEXT DEFAULT '',
  balance      INTEGER NOT NULL DEFAULT 0,
  deposit_name TEXT DEFAULT '',
  total_spent  INTEGER NOT NULL DEFAULT 0,
  total_charged INTEGER NOT NULL DEFAULT 0,
  roblox_username TEXT DEFAULT '',
  roblox_userid   TEXT DEFAULT '',
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (guild_id, discord_id)
);

CREATE TABLE IF NOT EXISTS charge_requests (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id       TEXT NOT NULL DEFAULT '',
  discord_id     TEXT NOT NULL,
  method         TEXT NOT NULL,
  amount         INTEGER NOT NULL,
  expected_amount INTEGER NOT NULL,
  depositor_name TEXT DEFAULT '',
  coin_symbol    TEXT DEFAULT '',
  coin_network   TEXT DEFAULT '',
  coin_amount    TEXT DEFAULT '',
  address        TEXT DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'pending',
  memo           TEXT DEFAULT '',
  created_at     INTEGER NOT NULL,
  resolved_at    INTEGER
);

CREATE TABLE IF NOT EXISTS purchases (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id     TEXT NOT NULL DEFAULT '',
  discord_id   TEXT NOT NULL,
  product_id   INTEGER,
  product_name TEXT DEFAULT '',
  stock_id     INTEGER,
  price        INTEGER NOT NULL,
  content      TEXT DEFAULT '',
  created_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id      TEXT NOT NULL DEFAULT '',
  discord_id    TEXT NOT NULL,
  type          TEXT NOT NULL,
  amount        INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  memo          TEXT DEFAULT '',
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bank_notifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT DEFAULT '',
  raw         TEXT DEFAULT '',
  depositor   TEXT DEFAULT '',
  amount      INTEGER,
  matched     INTEGER DEFAULT 0,
  charge_id   INTEGER,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS coins (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id   TEXT NOT NULL DEFAULT '',
  symbol     TEXT NOT NULL,
  network    TEXT NOT NULL,
  wallet     TEXT DEFAULT '',
  krw_rate   REAL NOT NULL DEFAULT 0,
  decimals   INTEGER DEFAULT 6,
  enabled    INTEGER DEFAULT 1,
  position   INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS vip_servers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id      TEXT NOT NULL DEFAULT '',
  name          TEXT NOT NULL,
  game          TEXT DEFAULT 'Grow a Garden 2',
  vip_link      TEXT NOT NULL,
  puppet_name   TEXT DEFAULT '',
  capacity      INTEGER DEFAULT 0,
  status        TEXT DEFAULT 'active',
  notes         TEXT DEFAULT '',
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS roblox_deliveries (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id         TEXT NOT NULL DEFAULT '',
  purchase_id      INTEGER,
  discord_id       TEXT NOT NULL,
  product_id       INTEGER,
  product_name     TEXT DEFAULT '',
  roblox_item      TEXT DEFAULT '',
  quantity         INTEGER DEFAULT 1,
  price            INTEGER DEFAULT 0,
  roblox_username  TEXT DEFAULT '',
  roblox_userid    TEXT DEFAULT '',
  vip_server_id    INTEGER,
  status           TEXT NOT NULL DEFAULT 'awaiting_username',
  operator         TEXT DEFAULT '',
  note             TEXT DEFAULT '',
  created_at       INTEGER NOT NULL,
  queued_at        INTEGER,
  joined_at        INTEGER,
  completed_at     INTEGER
);

CREATE INDEX IF NOT EXISTS idx_products_guild ON products(guild_id);
CREATE INDEX IF NOT EXISTS idx_categories_guild ON categories(guild_id);
CREATE INDEX IF NOT EXISTS idx_charges_guild ON charge_requests(guild_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_guild ON roblox_deliveries(guild_id);
`);

/* ---- 마이그레이션: 구버전(단일서버) DB 업그레이드 ---- */
function tableInfo(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all();
}
function ensureColumn(table, column, ddl) {
  if (!tableInfo(table).some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}
// 도메인 테이블에 guild_id 추가 (구버전 DB 대비)
for (const t of [
  'categories', 'products', 'stock', 'charge_requests', 'purchases',
  'transactions', 'bank_notifications', 'coins', 'vip_servers', 'roblox_deliveries',
]) {
  ensureColumn(t, 'guild_id', "guild_id TEXT NOT NULL DEFAULT ''");
}
ensureColumn('charge_requests', 'coin_network', "coin_network TEXT DEFAULT ''");
ensureColumn('products', 'delivery_type', "delivery_type TEXT DEFAULT 'stock'");
ensureColumn('products', 'roblox_item', "roblox_item TEXT DEFAULT ''");
ensureColumn('products', 'roblox_game', "roblox_game TEXT DEFAULT 'Grow a Garden 2'");
ensureColumn('guilds', 'notify_stage', "notify_stage TEXT DEFAULT ''");

// 구버전 users 테이블(단일 PK discord_id) → 복합키 재구성
(function migrateUsers() {
  const cols = tableInfo('users');
  if (cols.length && !cols.some((c) => c.name === 'guild_id')) {
    db.exec(`
      ALTER TABLE users RENAME TO users_legacy;
      CREATE TABLE users (
        guild_id TEXT NOT NULL DEFAULT '', discord_id TEXT NOT NULL, username TEXT DEFAULT '',
        balance INTEGER NOT NULL DEFAULT 0, deposit_name TEXT DEFAULT '',
        total_spent INTEGER NOT NULL DEFAULT 0, total_charged INTEGER NOT NULL DEFAULT 0,
        roblox_username TEXT DEFAULT '', roblox_userid TEXT DEFAULT '', created_at INTEGER NOT NULL,
        PRIMARY KEY (guild_id, discord_id)
      );
    `);
    console.warn('[db] 구버전 users 테이블을 users_legacy 로 백업하고 멀티테넌트 구조로 전환했습니다.');
  }
})();

module.exports = db;
