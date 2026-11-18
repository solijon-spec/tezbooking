/*
 * TezBooking — ma'lumotlar bazasi (SQLite, Node.js ichidagi node:sqlite — qo'shimcha paket kerak emas).
 *
 * Fayl: data/tezbooking.db  (papka avtomatik yaratiladi; .gitignore'da)
 *
 * Jadvallar:
 *   bookings        — bronlar. Holat (status): confirmed | cancelled
 *                     (keyinchalik ta'minotchi kuzatuvi uchun: pending | changed | failed)
 *   booking_events  — har bir bron tarixi: created, cancelled, restored, ... (kim, qachon, nima o'zgardi)
 *   meta            — sxema versiyasi
 *
 * Sxema o'zgarsa: MIGRATIONS ro'yxati oxiriga yangi qadam qo'shiladi (eskilari o'zgartirilmaydi).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let DatabaseSync;
try { ({ DatabaseSync } = require('node:sqlite')); }
catch (e) { DatabaseSync = null; }

const MIGRATIONS = [
  // 1: bronlar va ularning tarixi
  `CREATE TABLE bookings (
     id          TEXT PRIMARY KEY,
     key         TEXT NOT NULL UNIQUE,          -- taklif kaliti (operator|mehmonxona|sana|...) — bir taklif bir marta bron qilinadi
     product     TEXT NOT NULL,                 -- tour | hotel | flight
     title       TEXT NOT NULL,
     op          TEXT NOT NULL DEFAULT '',      -- tur operatori yoki aviakompaniya
     price       REAL,                          -- netto narx, USD
     date_from   TEXT,                          -- band kunlar: birinchi kun (YYYY-MM-DD)
     date_to     TEXT,                          -- band kunlar: oxirgi kun (YYYY-MM-DD)
     status      TEXT NOT NULL DEFAULT 'confirmed',
     supplier_ref TEXT,                         -- ta'minotchidagi raqam (PNR, voucher) — API ulanganda
     created_at  INTEGER NOT NULL,
     updated_at  INTEGER NOT NULL
   );
   CREATE INDEX bookings_status ON bookings(status);
   CREATE INDEX bookings_dates  ON bookings(date_from, date_to);
   CREATE TABLE booking_events (
     id          INTEGER PRIMARY KEY AUTOINCREMENT,
     booking_id  TEXT NOT NULL REFERENCES bookings(id),
     type        TEXT NOT NULL,
     payload     TEXT,
     at          INTEGER NOT NULL
   );
   CREATE INDEX booking_events_booking ON booking_events(booking_id);`,

  // 2: tur firmalar (akkauntlar), tariflar, to'lovlar; bron qaysi firmaga tegishli
  `CREATE TABLE agencies (
     id          TEXT PRIMARY KEY,
     name        TEXT NOT NULL,
     login       TEXT NOT NULL UNIQUE COLLATE NOCASE,
     pass_hash   TEXT NOT NULL,                 -- scrypt$tuz$xesh
     phone       TEXT NOT NULL DEFAULT '',
     contact     TEXT NOT NULL DEFAULT '',      -- mas'ul shaxs
     status      TEXT NOT NULL DEFAULT 'active',-- active | blocked
     paid_until  INTEGER NOT NULL DEFAULT 0,    -- tarif shu vaqtgacha amal qiladi (ms)
     created_at  INTEGER NOT NULL,
     last_login  INTEGER
   );
   CREATE TABLE tariffs (
     id          TEXT PRIMARY KEY,              -- m3 | m6 | m12
     months      INTEGER NOT NULL,
     price       INTEGER NOT NULL,              -- so'm
     active      INTEGER NOT NULL DEFAULT 1
   );
   INSERT INTO tariffs (id, months, price) VALUES ('m3', 3, 450000), ('m6', 6, 800000), ('m12', 12, 1400000);
   CREATE TABLE payments (
     id          TEXT PRIMARY KEY,
     agency_id   TEXT NOT NULL REFERENCES agencies(id),
     tariff_id   TEXT NOT NULL,
     months      INTEGER NOT NULL,
     amount      INTEGER NOT NULL,              -- so'm
     status      TEXT NOT NULL DEFAULT 'pending', -- pending | paid | cancelled
     provider    TEXT NOT NULL,                 -- demo | manual | payme | click
     created_at  INTEGER NOT NULL,
     paid_at     INTEGER,
     period_from INTEGER,
     period_to   INTEGER,
     note        TEXT
   );
   CREATE INDEX payments_agency ON payments(agency_id);
   CREATE INDEX payments_status ON payments(status);
   ALTER TABLE bookings ADD COLUMN agency_id TEXT REFERENCES agencies(id);`
];

const PRODUCTS = ['tour', 'hotel', 'flight'];
const isIso = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z'));
function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Band kunlar taklif kalitidan olinadi (js/app.js dagi bookedDays bilan bir xil qoida):
//   aviachipta  F|aviakompaniya|i|qayerdan|qayerga|uchish|qaytish|...  -> uchish..qaytish
//   tur / mehmonxona  mehmonxona|operator|kirish|tunlar|...           -> kirish..(kirish + tunlar - 1)
function datesFromKey(key) {
  const p = key.split('|');
  if (p[0] === 'F') {
    if (!isIso(p[5])) return { from: null, to: null };
    return { from: p[5], to: isIso(p[6]) ? p[6] : p[5] };
  }
  if (!isIso(p[2])) return { from: null, to: null };
  const nights = Math.max(1, Math.min(60, parseInt(p[3], 10) || 1));
  return { from: p[2], to: addDays(p[2], nights - 1) };
}

function open(file) {
  if (!DatabaseSync) {
    throw new Error('node:sqlite topilmadi. Node.js 22.13 yoki undan yangi versiya kerak (hozirgi: ' + process.version + ').');
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
  db.exec('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)');

  // ---------- Migratsiyalar ----------
  const row = db.prepare("SELECT v FROM meta WHERE k = 'schema'").get();
  let version = row ? Number(row.v) : 0;
  while (version < MIGRATIONS.length) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[version]);
      version++;
      db.prepare("INSERT INTO meta (k, v) VALUES ('schema', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").run(String(version));
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }

  const q = {
    active: db.prepare("SELECT * FROM bookings WHERE status != 'cancelled' ORDER BY created_at"),
    byKey: db.prepare('SELECT * FROM bookings WHERE key = ?'),
    insert: db.prepare(`INSERT INTO bookings (id, key, product, title, op, price, date_from, date_to, status, created_at, updated_at, agency_id)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?)`),
    restore: db.prepare(`UPDATE bookings SET product = ?, title = ?, op = ?, price = ?, status = 'confirmed', updated_at = ?, agency_id = ? WHERE id = ?`),
    setStatus: db.prepare('UPDATE bookings SET status = ?, updated_at = ? WHERE id = ?'),
    event: db.prepare('INSERT INTO booking_events (booking_id, type, payload, at) VALUES (?, ?, ?, ?)'),
    history: db.prepare('SELECT type, payload, at FROM booking_events WHERE booking_id = ? ORDER BY id')
  };

  function tx(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const r = fn(); db.exec('COMMIT'); return r; }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  const log = (id, type, payload, at) => q.event.run(id, type, payload ? JSON.stringify(payload) : null, at);

  // Saytga yuboriladigan ko'rinish
  const view = (b) => ({
    id: b.id, key: b.key, product: b.product, title: b.title, op: b.op, price: b.price,
    from: b.date_from, to: b.date_to, status: b.status, ref: b.supplier_ref, at: b.created_at, updated: b.updated_at,
    agencyId: b.agency_id || null
  });

  return {
    file,
    raw: db,                 // boshqa modullar (server/accounts.js) uchun
    tx,
    listActive: () => q.active.all().map(view),

    // Yangi bron. Natija: { booking, created: true } yoki { booking, created: false } (allaqachon bron qilingan)
    createBooking(input) {
      return tx(() => {
        const now = Date.now();
        const existing = q.byKey.get(input.key);
        const d = datesFromKey(input.key);
        if (existing && existing.status !== 'cancelled') return { booking: view(existing), created: false };
        if (existing) {
          q.restore.run(input.product, input.title, input.op, input.price, now, input.agencyId || null, existing.id);
          log(existing.id, 'restored', null, now);
          return { booking: view(q.byKey.get(input.key)), created: true };
        }
        const id = crypto.randomUUID();
        const at = input.at && input.at < now && input.at > now - 400 * 86400000 ? Math.floor(input.at) : now;
        q.insert.run(id, input.key, input.product, input.title, input.op, input.price, d.from, d.to, at, now, input.agencyId || null);
        log(id, 'created', { price: input.price, source: input.source || 'site', agency: input.agencyName || undefined }, now);
        return { booking: view(q.byKey.get(input.key)), created: true };
      });
    },

    // Bekor qilish (o'chirilmaydi — tarix saqlanadi). by: 'site' | 'admin'
    // agencyId berilsa — faqat o'sha firmaning broni bekor qilinadi (aks holda 'forbidden')
    cancelBooking(key, by, agencyId) {
      return tx(() => {
        const b = q.byKey.get(key);
        if (!b || b.status === 'cancelled') return null;
        if (agencyId && b.agency_id !== agencyId) return 'forbidden';
        const now = Date.now();
        q.setStatus.run('cancelled', now, b.id);
        log(b.id, 'cancelled', by ? { by } : null, now);
        return view(q.byKey.get(key));
      });
    },

    // Admin: bekor qilingan bronni qayta tiklash
    restoreBooking(key, by) {
      return tx(() => {
        const b = q.byKey.get(key);
        if (!b || b.status !== 'cancelled') return null;
        const now = Date.now();
        q.setStatus.run('confirmed', now, b.id);
        log(b.id, 'restored', by ? { by } : null, now);
        return view(q.byKey.get(key));
      });
    },

    // Admin: barcha bronlar (bekor qilinganlari ham), yangilari birinchi
    listAll(limit) {
      const rows = db.prepare(`SELECT b.*, a.name AS agency_name, (SELECT COUNT(*) FROM booking_events e WHERE e.booking_id = b.id) AS events
                               FROM bookings b LEFT JOIN agencies a ON a.id = b.agency_id
                               ORDER BY b.created_at DESC LIMIT ?`).all(Math.min(5000, limit || 2000));
      return rows.map(r => Object.assign(view(r), { events: r.events, agency: r.agency_name || '' }));
    },

    // Admin: umumiy ko'rsatkichlar
    stats(today) {
      const one = (sql, ...args) => db.prepare(sql).get(...args);
      const byStatus = db.prepare('SELECT status, COUNT(*) AS n FROM bookings GROUP BY status').all();
      const byProduct = db.prepare("SELECT product, COUNT(*) AS n, COALESCE(SUM(price), 0) AS sum FROM bookings WHERE status != 'cancelled' GROUP BY product").all();
      const monthStart = Date.parse(today.slice(0, 8) + '01T00:00:00Z');
      return {
        byStatus: Object.fromEntries(byStatus.map(r => [r.status, r.n])),
        byProduct: Object.fromEntries(byProduct.map(r => [r.product, { n: r.n, sum: r.sum }])),
        activeSum: one("SELECT COALESCE(SUM(price), 0) AS s FROM bookings WHERE status != 'cancelled'").s,
        thisMonth: one('SELECT COUNT(*) AS n FROM bookings WHERE created_at >= ?', monthStart).n,
        upcoming: one("SELECT COUNT(*) AS n FROM bookings WHERE status != 'cancelled' AND date_from >= ?", today).n,
        inTrip: one("SELECT COUNT(*) AS n FROM bookings WHERE status != 'cancelled' AND date_from <= ? AND date_to >= ?", today, today).n
      };
    },

    history(key) {
      const b = q.byKey.get(key);
      return b ? q.history.all(b.id).map(e => ({ type: e.type, at: e.at, payload: e.payload ? JSON.parse(e.payload) : null })) : null;
    },

    close: () => db.close()
  };
}

module.exports = { open, datesFromKey, PRODUCTS };
