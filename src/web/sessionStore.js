'use strict';

// better-sqlite3 기반 경량 세션 스토어 (connect-sqlite3 대체, 추가 네이티브 모듈 불필요)
const session = require('express-session');
const db = require('../database/db');

db.exec(`CREATE TABLE IF NOT EXISTS sessions (
  sid     TEXT PRIMARY KEY,
  expire  INTEGER,
  sess    TEXT
);`);

class SqliteStore extends session.Store {
  constructor() {
    super();
    this.getStmt = db.prepare('SELECT sess, expire FROM sessions WHERE sid = ?');
    this.setStmt = db.prepare(
      'INSERT INTO sessions (sid, expire, sess) VALUES (?,?,?) ON CONFLICT(sid) DO UPDATE SET expire=excluded.expire, sess=excluded.sess'
    );
    this.delStmt = db.prepare('DELETE FROM sessions WHERE sid = ?');
    // 만료 세션 주기적 정리
    setInterval(() => {
      try {
        db.prepare('DELETE FROM sessions WHERE expire < ?').run(Date.now());
      } catch (e) {
        /* ignore */
      }
    }, 60 * 60 * 1000).unref();
  }

  get(sid, cb) {
    try {
      const row = this.getStmt.get(sid);
      if (!row) return cb(null, null);
      if (row.expire && row.expire < Date.now()) {
        this.delStmt.run(sid);
        return cb(null, null);
      }
      return cb(null, JSON.parse(row.sess));
    } catch (e) {
      return cb(e);
    }
  }

  set(sid, sess, cb) {
    try {
      const expire = sess.cookie && sess.cookie.expires
        ? new Date(sess.cookie.expires).getTime()
        : Date.now() + 7 * 24 * 60 * 60 * 1000;
      this.setStmt.run(sid, expire, JSON.stringify(sess));
      return cb && cb(null);
    } catch (e) {
      return cb && cb(e);
    }
  }

  destroy(sid, cb) {
    try {
      this.delStmt.run(sid);
      return cb && cb(null);
    } catch (e) {
      return cb && cb(e);
    }
  }

  touch(sid, sess, cb) {
    return this.set(sid, sess, cb);
  }
}

module.exports = SqliteStore;
