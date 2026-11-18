/*
 * TezBooking — tur firmalar (akkauntlar), tariflar va to'lovlar.
 *
 * Tur firmani faqat admin yaratadi (login + parol). Firma saytga kiradi, tarif tanlaydi va to'laydi.
 * To'lov tasdiqlangach tarif muddati uzayadi: yangi muddat = max(hozir, eski muddat) + N oy.
 * Tarif faol bo'lmasa, firma bron qila olmaydi (server/bookings.js).
 *
 * To'lov rejimi (.env, PAYMENT_MODE):
 *   manual (asosiy)  — firma to'lov so'rovini yuboradi, bank o'tkazmasini ko'rgach admin "Tasdiqlash"ni bosadi
 *   demo             — sinov uchun: "To'lash" tugmasi pulsiz darhol tasdiqlaydi. HAQIQIY SAYTDA YOQMANG!
 *   (payme / click   — merchant shartnomasi olingach shu yerga qo'shiladi)
 *
 * Sayt uchun API (cookie: tb_agency):
 *   GET  /api/tariffs                tariflar va to'lov rejimi
 *   POST /api/agency/login           { login, password }
 *   POST /api/agency/logout
 *   GET  /api/agency/me              firma, tarif holati, oxirgi to'lovlar
 *   POST /api/agency/pay             { tariff }  -> to'lov yaratiladi (demo rejimda darhol to'lanadi)
 *   POST /api/agency/password        { old, password }
 */
'use strict';

const crypto = require('crypto');

const COOKIE = 'tb_agency';
const SESSION_MS = 30 * 86400000;        // 30 kun
const LOGIN_TRIES_PER_MIN = 8;
const MODES = ['manual', 'demo'];

// ---------- Parol ----------
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return 'scrypt$' + salt + '$' + crypto.scryptSync(pw, salt, 32).toString('hex');
}
function checkPassword(pw, stored) {
  const p = String(stored || '').split('$');
  if (p[0] !== 'scrypt' || p.length !== 3) return false;
  const want = Buffer.from(p[2], 'hex');
  const got = crypto.scryptSync(String(pw), p[1], want.length);
  return crypto.timingSafeEqual(want, got);
}
// O'qish oson parol: chalkash harflarsiz (0/O, 1/l/I)
function generatePassword(len) {
  const abc = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(len || 12);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += abc[bytes[i] % abc.length];
  return s;
}

function addMonths(ms, months) {
  const d = new Date(ms);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.getTime();
}

function createAccounts({ db, sendJson, readBody, paymentMode }) {
  const raw = db.raw;
  const mode = MODES.includes(paymentMode) ? paymentMode : 'manual';
  let notify = () => {};                 // jonli xabar (server/bookings.js dan ulanadi)
  const sessions = new Map();            // token -> { agencyId, exp }
  const tries = new Map();

  const q = {
    agency: raw.prepare('SELECT * FROM agencies WHERE id = ?'),
    byLogin: raw.prepare('SELECT * FROM agencies WHERE login = ?'),
    agencies: raw.prepare(`SELECT a.*,
        (SELECT COUNT(*) FROM bookings b WHERE b.agency_id = a.id AND b.status != 'cancelled') AS bookings,
        (SELECT COALESCE(SUM(amount), 0) FROM payments p WHERE p.agency_id = a.id AND p.status = 'paid') AS paid_total,
        (SELECT COUNT(*) FROM payments p WHERE p.agency_id = a.id AND p.status = 'pending') AS pending
      FROM agencies a ORDER BY a.created_at DESC`),
    insertAgency: raw.prepare(`INSERT INTO agencies (id, name, login, pass_hash, phone, contact, status, paid_until, created_at)
                               VALUES (?, ?, ?, ?, ?, ?, 'active', 0, ?)`),
    updateAgency: raw.prepare('UPDATE agencies SET name = ?, phone = ?, contact = ? WHERE id = ?'),
    setPass: raw.prepare('UPDATE agencies SET pass_hash = ? WHERE id = ?'),
    setStatus: raw.prepare('UPDATE agencies SET status = ? WHERE id = ?'),
    setPaid: raw.prepare('UPDATE agencies SET paid_until = ? WHERE id = ?'),
    lastLogin: raw.prepare('UPDATE agencies SET last_login = ? WHERE id = ?'),
    tariffs: raw.prepare('SELECT * FROM tariffs ORDER BY months'),
    tariff: raw.prepare('SELECT * FROM tariffs WHERE id = ?'),
    setTariff: raw.prepare('UPDATE tariffs SET price = ?, active = ? WHERE id = ?'),
    insertPay: raw.prepare(`INSERT INTO payments (id, agency_id, tariff_id, months, amount, status, provider, created_at, note)
                            VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`),
    payment: raw.prepare('SELECT * FROM payments WHERE id = ?'),
    payDone: raw.prepare("UPDATE payments SET status = 'paid', paid_at = ?, period_from = ?, period_to = ? WHERE id = ?"),
    payCancel: raw.prepare("UPDATE payments SET status = 'cancelled' WHERE id = ?"),
    pendingOf: raw.prepare("SELECT * FROM payments WHERE agency_id = ? AND status = 'pending' ORDER BY created_at DESC"),
    paymentsOf: raw.prepare('SELECT * FROM payments WHERE agency_id = ? ORDER BY created_at DESC LIMIT 20'),
    allPayments: raw.prepare(`SELECT p.*, a.name AS agency_name, a.login AS agency_login FROM payments p
                              JOIN agencies a ON a.id = p.agency_id ORDER BY p.created_at DESC LIMIT 1000`)
  };

  // ---------- Ko'rinishlar ----------
  const isActive = (a) => !!a && a.status === 'active' && a.paid_until > Date.now();
  const tariffView = (t) => ({ id: t.id, months: t.months, price: t.price, active: !!t.active });
  const payView = (p) => ({
    id: p.id, tariff: p.tariff_id, months: p.months, amount: p.amount, status: p.status, provider: p.provider,
    at: p.created_at, paidAt: p.paid_at, from: p.period_from, to: p.period_to, note: p.note || '',
    agencyId: p.agency_id, agency: p.agency_name, login: p.agency_login
  });
  const agencyView = (a) => ({
    id: a.id, name: a.name, login: a.login, phone: a.phone, contact: a.contact, status: a.status,
    paidUntil: a.paid_until || null, active: isActive(a), createdAt: a.created_at, lastLogin: a.last_login,
    bookings: a.bookings, paidTotal: a.paid_total, pending: a.pending
  });

  // ---------- Tariflar ----------
  const tariffs = (onlyActive) => q.tariffs.all().filter(t => !onlyActive || t.active).map(tariffView);
  function setTariff(id, price, active) {
    const t = q.tariff.get(id);
    if (!t) return null;
    q.setTariff.run(price, active ? 1 : 0, id);
    return tariffView(q.tariff.get(id));
  }

  // ---------- Tur firmalar (admin) ----------
  const listAgencies = () => q.agencies.all().map(agencyView);
  const cleanLogin = (s) => String(s || '').trim().toLowerCase();
  const validLogin = (s) => /^[a-z0-9._-]{3,32}$/.test(s);

  function createAgency(input) {
    const login = cleanLogin(input.login);
    if (!validLogin(login)) return { error: 'bad_login' };
    if (q.byLogin.get(login)) return { error: 'login_taken' };
    const name = String(input.name || '').trim().slice(0, 120);
    if (!name) return { error: 'bad_name' };
    const password = input.password && String(input.password).length >= 8 ? String(input.password) : generatePassword(12);
    const id = crypto.randomUUID();
    q.insertAgency.run(id, name, login, hashPassword(password), String(input.phone || '').trim().slice(0, 40),
      String(input.contact || '').trim().slice(0, 120), Date.now());
    return { agency: agencyView(Object.assign({ bookings: 0, paid_total: 0, pending: 0 }, q.agency.get(id))), password };
  }
  function updateAgency(id, input) {
    const a = q.agency.get(id);
    if (!a) return null;
    q.updateAgency.run(String(input.name || a.name).trim().slice(0, 120) || a.name,
      String(input.phone != null ? input.phone : a.phone).trim().slice(0, 40),
      String(input.contact != null ? input.contact : a.contact).trim().slice(0, 120), id);
    return true;
  }
  function resetPassword(id) {
    if (!q.agency.get(id)) return null;
    const password = generatePassword(12);
    q.setPass.run(hashPassword(password), id);
    dropSessions(id);
    return password;
  }
  function setAgencyStatus(id, status) {
    if (!q.agency.get(id) || !['active', 'blocked'].includes(status)) return null;
    q.setStatus.run(status, id);
    if (status === 'blocked') dropSessions(id);
    return true;
  }

  // ---------- To'lovlar ----------
  function createPayment(agencyId, tariffId, provider, note) {
    const t = q.tariff.get(tariffId);
    if (!t || !t.active) return null;
    const id = crypto.randomUUID();
    q.insertPay.run(id, agencyId, t.id, t.months, t.price, provider, Date.now(), note || null);
    return id;
  }
  // To'lov tasdiqlanadi va tarif muddati uzaytiriladi
  function confirmPayment(id) {
    return db.tx(() => {
      const p = q.payment.get(id);
      if (!p || p.status !== 'pending') return null;
      const a = q.agency.get(p.agency_id);
      const now = Date.now();
      const from = Math.max(now, a.paid_until || 0);
      const to = addMonths(from, p.months);
      q.payDone.run(now, from, to, id);
      q.setPaid.run(to, a.id);
      return payView(q.payment.get(id));
    });
  }
  function cancelPayment(id) {
    const p = q.payment.get(id);
    if (!p || p.status !== 'pending') return null;
    q.payCancel.run(id);
    return true;
  }
  const listPayments = () => q.allPayments.all().map(payView);

  // ---------- Sessiyalar ----------
  function tokenOf(req) {
    const m = (req.headers.cookie || '').match(new RegExp('(?:^|;\\s*)' + COOKIE + '=([a-f0-9]{64})'));
    return m ? m[1] : null;
  }
  function dropSessions(agencyId) { sessions.forEach((s, tok) => { if (s.agencyId === agencyId) sessions.delete(tok); }); }
  // So'rov qaysi firmadan: agency yoki null
  function agencyOf(req) {
    const tok = tokenOf(req);
    const s = tok && sessions.get(tok);
    if (!s) return null;
    if (s.exp < Date.now()) { sessions.delete(tok); return null; }
    const a = q.agency.get(s.agencyId);
    if (!a || a.status !== 'active') { sessions.delete(tok); return null; }
    return a;
  }
  const cookie = (tok, maxAge) => `${COOKIE}=${tok}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
  function tooMany(ip) {
    const now = Date.now();
    const list = (tries.get(ip) || []).filter(ts => now - ts < 60000);
    tries.set(ip, list);
    return list.length >= LOGIN_TRIES_PER_MIN;
  }
  async function jsonBody(req) {
    if (!/^application\/json/i.test(req.headers['content-type'] || '')) return null;
    try { return JSON.parse(await readBody(req)); } catch (e) { return null; }
  }

  function me(a) {
    return {
      agency: { name: a.name, login: a.login, paidUntil: a.paid_until || null, active: isActive(a) },
      pending: q.pendingOf.all(a.id).map(payView),
      payments: q.paymentsOf.all(a.id).map(payView)
    };
  }

  // ---------- Sayt uchun marshrutlar ----------
  async function handle(req, res, pathname) {
    if (pathname === '/api/tariffs') return sendJson(res, 200, { tariffs: tariffs(true), mode });
    const route = pathname.slice('/api/agency'.length);

    if (route === '/login') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'method' });
      const ip = req.socket.remoteAddress || '';
      if (tooMany(ip)) return sendJson(res, 429, { error: 'rate_limited' });
      const body = await jsonBody(req);
      const a = body && q.byLogin.get(cleanLogin(body.login));
      const ok = a && typeof body.password === 'string' && checkPassword(body.password, a.pass_hash);
      if (!ok) { tries.get(ip).push(Date.now()); return sendJson(res, 401, { error: 'bad_login' }); }
      if (a.status !== 'active') return sendJson(res, 403, { error: 'blocked' });
      const tok = crypto.randomBytes(32).toString('hex');
      sessions.set(tok, { agencyId: a.id, exp: Date.now() + SESSION_MS });
      q.lastLogin.run(Date.now(), a.id);
      res.setHeader('Set-Cookie', cookie(tok, SESSION_MS / 1000));
      return sendJson(res, 200, me(a));
    }
    if (route === '/logout') {
      const tok = tokenOf(req);
      if (tok) sessions.delete(tok);
      res.setHeader('Set-Cookie', cookie('', 0));
      return sendJson(res, 200, { ok: true });
    }

    const a = agencyOf(req);
    if (!a) return sendJson(res, 401, { error: 'login_required' });

    if (route === '/me') return sendJson(res, 200, me(a));
    if (route === '/pay') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'method' });
      const body = await jsonBody(req);
      const id = body && typeof body.tariff === 'string' && createPayment(a.id, body.tariff, mode);
      if (!id) return sendJson(res, 400, { error: 'bad_tariff' });
      if (mode === 'demo') confirmPayment(id);
      notify('payment');                     // admin panel darhol ko'rsin
      return sendJson(res, 200, Object.assign(me(q.agency.get(a.id)), { payment: payView(q.payment.get(id)), mode }));
    }
    if (route === '/password') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'method' });
      const body = await jsonBody(req);
      if (!body || !checkPassword(String(body.old || ''), a.pass_hash)) return sendJson(res, 400, { error: 'bad_old' });
      if (typeof body.password !== 'string' || body.password.length < 8) return sendJson(res, 400, { error: 'weak' });
      q.setPass.run(hashPassword(body.password), a.id);
      return sendJson(res, 200, { ok: true });
    }
    return sendJson(res, 404, { error: 'not_found' });
  }

  setInterval(() => { const now = Date.now(); sessions.forEach((s, tok) => { if (s.exp < now) sessions.delete(tok); }); }, 600000).unref();

  return {
    mode, handle, agencyOf, isActive,
    setNotify: (fn) => { notify = fn; },
    tariffs, setTariff,
    listAgencies, createAgency, updateAgency, resetPassword, setAgencyStatus,
    createPayment, confirmPayment, cancelPayment, listPayments,
    agencyCount: () => raw.prepare("SELECT COUNT(*) AS n, SUM(CASE WHEN status = 'active' AND paid_until > ? THEN 1 ELSE 0 END) AS paid FROM agencies").get(Date.now())
  };
}

module.exports = { createAccounts, hashPassword, checkPassword, addMonths };
