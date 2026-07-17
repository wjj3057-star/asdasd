'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'market.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  description TEXT DEFAULT '',
  emoji       TEXT DEFAULT '',
  position    INTEGER DEFAULT 0,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id   INTEGER NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT DEFAULT '',
  emoji         TEXT DEFAULT '',
  price         INTEGER NOT NULL DEFAULT 0,
  min_role_id   TEXT DEFAULT '',
  position      INTEGER DEFAULT 0,
  is_active     INTEGER DEFAULT 1,
  created_at    INTEGER NOT NULL,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
);

-- 재고: 한 행이 하나의 판매 단위(계정/키/코드 등)
CREATE TABLE IF NOT EXISTS stock (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id  INTEGER NOT NULL,
  content     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'available', -- available | sold
  sold_to     TEXT DEFAULT '',
  sold_at     INTEGER,
  created_at  INTEGER NOT NULL,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS users (
  discord_id   TEXT PRIMARY KEY,
  username     TEXT DEFAULT '',
  balance      INTEGER NOT NULL DEFAULT 0,
  deposit_name TEXT DEFAULT '',          -- 최초 입력 후 고정되는 입금자명
  total_spent  INTEGER NOT NULL DEFAULT 0,
  total_charged INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL
);

-- 충전 요청 (계좌/코인 공통)
CREATE TABLE IF NOT EXISTS charge_requests (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_id     TEXT NOT NULL,
  method         TEXT NOT NULL,            -- account | coin
  amount         INTEGER NOT NULL,         -- 충전될 원화(잔액) 금액
  expected_amount INTEGER NOT NULL,        -- 실제 입금해야 하는 금액(고유값 매칭)
  depositor_name TEXT DEFAULT '',          -- 계좌충전 시 입금자명
  coin_symbol    TEXT DEFAULT '',
  coin_amount    TEXT DEFAULT '',
  address        TEXT DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected | expired
  memo           TEXT DEFAULT '',
  created_at     INTEGER NOT NULL,
  resolved_at    INTEGER,
  FOREIGN KEY (discord_id) REFERENCES users(discord_id)
);

-- 구매 내역
CREATE TABLE IF NOT EXISTS purchases (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_id   TEXT NOT NULL,
  product_id   INTEGER,
  product_name TEXT DEFAULT '',
  stock_id     INTEGER,
  price        INTEGER NOT NULL,
  content      TEXT DEFAULT '',
  created_at   INTEGER NOT NULL
);

-- 잔액 변동 원장
CREATE TABLE IF NOT EXISTS transactions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_id    TEXT NOT NULL,
  type          TEXT NOT NULL,   -- charge | purchase | admin | refund
  amount        INTEGER NOT NULL, -- +충전 / -구매
  balance_after INTEGER NOT NULL,
  memo          TEXT DEFAULT '',
  created_at    INTEGER NOT NULL
);

-- 은행 입금 알림 원장 (문자/푸시 포워딩 수신)
CREATE TABLE IF NOT EXISTS bank_notifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  raw         TEXT DEFAULT '',
  depositor   TEXT DEFAULT '',
  amount      INTEGER,
  matched     INTEGER DEFAULT 0,
  charge_id   INTEGER,
  created_at  INTEGER NOT NULL
);

-- 코인충전 지원 코인 목록 (LTC, SOL, USDT-TRC20, USDT-BSC 등)
CREATE TABLE IF NOT EXISTS coins (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol     TEXT NOT NULL,       -- LTC, SOL, USDT ...
  network    TEXT NOT NULL,       -- Litecoin, Solana, TRC20, BEP20 ...
  wallet     TEXT DEFAULT '',
  krw_rate   REAL NOT NULL DEFAULT 0, -- 1코인 = ?원
  decimals   INTEGER DEFAULT 6,
  enabled    INTEGER DEFAULT 1,
  position   INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);
`);

db.exec(`
-- 로블록스 VIP 서버 / 꼭두각시(전달용) 계정 풀
CREATE TABLE IF NOT EXISTS vip_servers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  game          TEXT DEFAULT 'Grow a Garden 2',
  vip_link      TEXT NOT NULL,
  puppet_name   TEXT DEFAULT '',        -- 서버에 상주하는 꼭두각시 로블록스 닉네임
  capacity      INTEGER DEFAULT 0,      -- 동시 처리 가능 수(0=무제한)
  status        TEXT DEFAULT 'active',  -- active | paused
  notes         TEXT DEFAULT '',
  created_at    INTEGER NOT NULL
);

-- 로블록스 아이템 배송(트레이드) 세션
CREATE TABLE IF NOT EXISTS roblox_deliveries (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
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
  -- awaiting_username | queued | joined | completed | failed | cancelled
  operator         TEXT DEFAULT '',
  note             TEXT DEFAULT '',
  created_at       INTEGER NOT NULL,
  queued_at        INTEGER,
  joined_at        INTEGER,
  completed_at     INTEGER
);
`);

// ---- 간단 마이그레이션: 누락 컬럼 추가 ----
function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}
ensureColumn('charge_requests', 'coin_network', "coin_network TEXT DEFAULT ''");
// 상품 배송 타입: stock(코드지급) | roblox_trade(게임 내 트레이드)
ensureColumn('products', 'delivery_type', "delivery_type TEXT DEFAULT 'stock'");
ensureColumn('products', 'roblox_item', "roblox_item TEXT DEFAULT ''");
ensureColumn('products', 'roblox_game', "roblox_game TEXT DEFAULT 'Grow a Garden 2'");
// 유저의 로블록스 계정 (재구매 시 재사용)
ensureColumn('users', 'roblox_username', "roblox_username TEXT DEFAULT ''");
ensureColumn('users', 'roblox_userid', "roblox_userid TEXT DEFAULT ''");

module.exports = db;
