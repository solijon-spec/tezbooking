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
 *   POST /api/agency/register        { name, login, password, phone, contact?, markup }  o'zi ro'yxatdan o'tish
 *                                    (markup — firma oladigan foiz, 0..50; mijoz narxi = netto + foiz)
 *   POST /api/agency/login           { login, password }
 *   POST /api/agency/logout
 *   GET  /api/agency/me              firma, tarif holati, ustama foizi, oxirgi to'lovlar
 *   POST /api/agency/markup          { markup }  foizni o'zgartirish
 *   POST /api/agency/pay             { tariff }  -> to'lov yaratiladi (demo rejimda darhol to'lanadi)
 *   POST /api/agency/password        { old, password }
 *   POST /api/agency/telegram-code   Telegram botni firmaga ulash uchun bir martalik kod (10 daqiqa)
 */
'use strict';

const crypto = require('crypto');
const { clientIp, secureAttr } = require('./net');

const COOKIE = 'tb_agency';
const SESSION_MS = 30 * 86400000;        // 30 kun
const LOGIN_TRIES_PER_MIN = 8;
const LOGIN_FAILS_PER_ACCOUNT = 10;      // bitta login'ga 15 daqiqada shuncha xato — login vaqtincha yopiladi (IP'dan qat'i nazar)
const ACCOUNT_LOCK_MS = 15 * 60000;
const REGISTER_PER_HOUR = 3;             // bitta IP'dan soatiga ro'yxatdan o'tish
const MODES = ['manual', 'demo'];
const MARKUP_MIN = 0, MARKUP_MAX = 50, MARKUP_DEFAULT = 10;
// Foiz: 0..50, 0.5 qadam bilan (masalan 12.5). Noto'g'ri bo'lsa — null
function cleanMarkup(v) {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : v;
  if (typeof n !== 'number' || !isFinite(n) || n < MARKUP_MIN || n > MARKUP_MAX) return null;
  return Math.round(n * 2) / 2;
}
// Parol kuchi: kamida 8 belgi, harf va raqam
const strongPassword = (pw) => typeof pw === 'string' && pw.length >= 8 && pw.length <= 128 && /[A-Za-zА-Яа-я]/.test(pw) && /\d/.test(pw);

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

function createAccounts({ db, sendJson, readBody, paymentMode, shield, selfRegister = true }) {
  const raw = db.raw;
  const mode = MODES.includes(paymentMode) ? paymentMode : 'manual';
  let notify = () => {};                 // jonli xabar (server/bookings.js dan ulanadi)
  const sessions = new Map();            // token -> { agencyId, exp }
  const tries = new Map();
  const accountFails = new Map();        // login -> [xato vaqtlari]
  const registrations = new Map();       // ip -> [vaqtlar]
  const tgCodes = new Map();             // kod -> { agencyId, exp }
  const report = (req, kind, detail) => { if (shield) shield.report(clientIp(req), kind, detail); };

  const q = {
    agency: raw.prepare('SELECT * FROM agencies WHERE id = ?'),
    byLogin: raw.prepare('SELECT * FROM agencies WHERE login = ?'),
    agencies: raw.prepare(`SELECT a.*,
        (SELECT COUNT(*) FROM bookings b WHERE b.agency_id = a.id AND b.status != 'cancelled') AS bookings,
        (SELECT COALESCE(SUM(amount), 0) FROM payments p WHERE p.agency_id = a.id AND p.status = 'paid') AS paid_total,
        (SELECT COUNT(*) FROM payments p WHERE p.agency_id = a.id AND p.status = 'pending') AS pending
      FROM agencies a ORDER BY a.created_at DESC`),
    insertAgency: raw.prepare(`INSERT INTO agencies (id, name, login, pass_hash, phone, contact, status, paid_until, created_at, markup, source)
                               VALUES (?, ?, ?, ?, ?, ?, 'active', 0, ?, ?, ?)`),
    updateAgency: raw.prepare('UPDATE agencies SET name = ?, phone = ?, contact = ?, markup = ? WHERE id = ?'),
    setMarkup: raw.prepare('UPDATE agencies SET markup = ? WHERE id = ?'),
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
  const markupOf = (a) => (a && typeof a.markup === 'number' && isFinite(a.markup) ? a.markup : MARKUP_DEFAULT);
  const agencyView = (a) => ({
    id: a.id, name: a.name, login: a.login, phone: a.phone, contact: a.contact, status: a.status,
    paidUntil: a.paid_until || null, active: isActive(a), createdAt: a.created_at, lastLogin: a.last_login,
    bookings: a.bookings, paidTotal: a.paid_total, pending: a.pending, markup: markupOf(a), source: a.source || 'admin'
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

  const cleanText = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, max);
  const cleanPhone = (v) => String(v == null ? '' : v).replace(/[^\d+()\s-]/g, '').trim().slice(0, 40);

  // source: 'admin' (admin yaratadi, parol avtomatik bo'lishi mumkin) | 'self' (firma o'zi: parol va telefon majburiy)
  function createAgency(input, source) {
    source = source === 'self' ? 'self' : 'admin';
    const login = cleanLogin(input.login);
    if (!validLogin(login)) return { error: 'bad_login' };
    if (q.byLogin.get(login)) return { error: 'login_taken' };
    const name = cleanText(input.name, 120);
    if (name.length < 2) return { error: 'bad_name' };
    const markup = input.markup === undefined || input.markup === '' ? MARKUP_DEFAULT : cleanMarkup(input.markup);
    if (markup === null) return { error: 'bad_markup' };
    const phone = cleanPhone(input.phone);
    let password;
    if (source === 'self') {
      if (!strongPassword(input.password)) return { error: 'weak_password' };
      if (phone.replace(/\D/g, '').length < 9) return { error: 'bad_phone' };
      password = input.password;
    } else {
      password = input.password && String(input.password).length >= 8 ? String(input.password) : generatePassword(12);
    }
    const id = crypto.randomUUID();
    q.insertAgency.run(id, name, login, hashPassword(password), phone, cleanText(input.contact, 120), Date.now(), markup, source);
    return { agency: agencyView(Object.assign({ bookings: 0, paid_total: 0, pending: 0 }, q.agency.get(id))), password };
  }
  function updateAgency(id, input) {
    const a = q.agency.get(id);
    if (!a) return null;
    const markup = input.markup == null || input.markup === '' ? markupOf(a) : cleanMarkup(input.markup);
    if (markup === null) return null;
    q.updateAgency.run(cleanText(input.name || a.name, 120) || a.name,
      input.phone != null ? cleanPhone(input.phone) : a.phone,
      input.contact != null ? cleanText(input.contact, 120) : a.contact, markup, id);
    return true;
  }
  function setMarkup(id, value) {
    const m = cleanMarkup(value);
    if (m === null || !q.agency.get(id)) return null;
    q.setMarkup.run(m, id);
    return m;
  }

  // ---------- Telegram bot bilan ulash: bir martalik 6 xonali kod (10 daqiqa) ----------
  function telegramCode(agencyId) {
    tgCodes.forEach((v, k) => { if (v.agencyId === agencyId || v.exp < Date.now()) tgCodes.delete(k); });
    let code;
    do { code = String(crypto.randomInt(100000, 1000000)); } while (tgCodes.has(code));
    tgCodes.set(code, { agencyId, exp: Date.now() + 10 * 60000, tries: 0 });
    return code;
  }
  // Kod to'g'ri bo'lsa — firma (kod bir marta ishlaydi)
  function useTelegramCode(code) {
    const c = tgCodes.get(String(code || '').trim());
    if (!c) return null;
    tgCodes.delete(String(code).trim());
    if (c.exp < Date.now()) return null;
    const a = q.agency.get(c.agencyId);
    return a && a.status === 'active' ? a : null;
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
  const cookie = (tok, maxAge) => `${COOKIE}=${tok}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureAttr()}`;
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

  function lockedAccount(login) {
    const now = Date.now();
    const list = (accountFails.get(login) || []).filter(ts => now - ts < ACCOUNT_LOCK_MS);
    if (list.length) accountFails.set(login, list); else accountFails.delete(login);
    return list.length >= LOGIN_FAILS_PER_ACCOUNT;
  }
  function tooManyRegistrations(ip) {
    const now = Date.now();
    const list = (registrations.get(ip) || []).filter(ts => now - ts < 3600000);
    registrations.set(ip, list);
    return list.length >= REGISTER_PER_HOUR;
  }

  function me(a) {
    return {
      agency: { name: a.name, login: a.login, paidUntil: a.paid_until || null, active: isActive(a), markup: markupOf(a), phone: a.phone || '' },
      pending: q.pendingOf.all(a.id).map(payView),
      payments: q.paymentsOf.all(a.id).map(payView)
    };
  }

  // ---------- Sayt uchun marshrutlar ----------
  async function handle(req, res, pathname) {
    if (pathname === '/api/tariffs') return sendJson(res, 200, { tariffs: tariffs(true), mode, register: selfRegister, markupDefault: MARKUP_DEFAULT });
    const route = pathname.slice('/api/agency'.length);

    const startSession = (a) => {
      const tok = crypto.randomBytes(32).toString('hex');
      sessions.set(tok, { agencyId: a.id, exp: Date.now() + SESSION_MS });
      q.lastLogin.run(Date.now(), a.id);
      res.setHeader('Set-Cookie', cookie(tok, SESSION_MS / 1000));
    };

    if (route === '/register') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'method' });
      if (!selfRegister) return sendJson(res, 403, { error: 'register_closed' });
      const ip = clientIp(req);
      if (tooManyRegistrations(ip)) { report(req, 'register_flood'); return sendJson(res, 429, { error: 'rate_limited' }); }
      const body = await jsonBody(req);
      if (!body || typeof body !== 'object') return sendJson(res, 400, { error: 'bad_request' });
      // Bot tuzog'i: odam ko'rmaydigan maydon to'ldirilgan bo'lsa — bot
      if (body.website) { report(req, 'honeypot', 'register'); return sendJson(res, 400, { error: 'bad_request' }); }
      registrations.get(ip).push(Date.now());
      const r = createAgency(body, 'self');
      if (r.error) return sendJson(res, 400, { error: r.error });
      const a = q.agency.get(r.agency.id);
      startSession(a);
      notify('account');                       // admin panel yangi firmani darhol ko'rsin
      return sendJson(res, 201, me(a));
    }

    if (route === '/login') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'method' });
      const ip = clientIp(req);
      if (tooMany(ip)) { report(req, 'rate_limited', 'agency_login'); return sendJson(res, 429, { error: 'rate_limited' }); }
      const body = await jsonBody(req);
      const login = body ? cleanLogin(body.login) : '';
      if (login && lockedAccount(login)) return sendJson(res, 429, { error: 'rate_limited' });
      const a = login && q.byLogin.get(login);
      const ok = a && typeof body.password === 'string' && body.password.length <= 256 && checkPassword(body.password, a.pass_hash);
      if (!ok) {
        tries.get(ip).push(Date.now());
        if (login) (accountFails.get(login) || accountFails.set(login, []).get(login)).push(Date.now());
        report(req, 'auth_fail', 'agency');
        return sendJson(res, 401, { error: 'bad_login' });
      }
      if (a.status !== 'active') return sendJson(res, 403, { error: 'blocked' });
      accountFails.delete(login);
      startSession(a);
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
      if (!body || !checkPassword(String(body.old || '').slice(0, 256), a.pass_hash)) { report(req, 'auth_fail', 'password_change'); return sendJson(res, 400, { error: 'bad_old' }); }
      if (!strongPassword(body.password)) return sendJson(res, 400, { error: 'weak' });
      q.setPass.run(hashPassword(body.password), a.id);
      // Boshqa qurilmalardagi sessiyalar yopiladi (shu sessiya qoladi)
      const cur = tokenOf(req);
      sessions.forEach((s, tok) => { if (s.agencyId === a.id && tok !== cur) sessions.delete(tok); });
      return sendJson(res, 200, { ok: true });
    }
    if (route === '/markup') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'method' });
      const body = await jsonBody(req);
      const m = body && setMarkup(a.id, body.markup);
      if (m === null || m === undefined || m === false) return sendJson(res, 400, { error: 'bad_markup' });
      return sendJson(res, 200, me(q.agency.get(a.id)));
    }
    if (route === '/telegram-code') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'method' });
      return sendJson(res, 200, { code: telegramCode(a.id), ttl: 600 });
    }
    return sendJson(res, 404, { error: 'not_found' });
  }

  // Muddati o'tgan sessiyalar va urinishlar xotirasini tozalash (ko'p IP'dan xotirani to'ldirib bo'lmasin)
  setInterval(() => {
    const now = Date.now();
    sessions.forEach((s, tok) => { if (s.exp < now) sessions.delete(tok); });
    tries.forEach((list, ip) => { if (!list.some(ts => now - ts < 60000)) tries.delete(ip); });
    registrations.forEach((list, ip) => { if (!list.some(ts => now - ts < 3600000)) registrations.delete(ip); });
    accountFails.forEach((list, k) => { if (!list.some(ts => now - ts < ACCOUNT_LOCK_MS)) accountFails.delete(k); });
    tgCodes.forEach((v, k) => { if (v.exp < now) tgCodes.delete(k); });
  }, 120000).unref();

  return {
    mode, handle, agencyOf, isActive, markupOf, setMarkup, useTelegramCode,
    agency: (id) => q.agency.get(id) || null,
    setNotify: (fn) => { notify = fn; },
    tariffs, setTariff,
    listAgencies, createAgency, updateAgency, resetPassword, setAgencyStatus,
    createPayment, confirmPayment, cancelPayment, listPayments,
    agencyCount: () => raw.prepare("SELECT COUNT(*) AS n, SUM(CASE WHEN status = 'active' AND paid_until > ? THEN 1 ELSE 0 END) AS paid FROM agencies").get(Date.now())
  };
}

module.exports = { createAccounts, hashPassword, checkPassword, addMonths, cleanMarkup, strongPassword, MARKUP_DEFAULT };
