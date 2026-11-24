/*
 * TezBooking — admin panel API'si.  Sahifa: /admin  (admin.html)
 *
 * Kirish: .env faylidagi ADMIN_PASSWORD. Parol yozilmagan bo'lsa, admin panel o'chiq.
 * Sessiya: HttpOnly cookie (12 soat), server xotirasida saqlanadi — server qayta ishga tushsa, qayta kirish kerak.
 *
 *   POST /api/admin/login      { password }  -> cookie
 *   POST /api/admin/logout
 *   GET  /api/admin/me         kirganmi
 *   GET  /api/admin/stats      ko'rsatkichlar
 *   GET  /api/admin/bookings   barcha bronlar (bekor qilinganlari ham)
 *   GET  /api/admin/history?key=...
 *   POST /api/admin/cancel     { key }
 *   POST /api/admin/restore    { key }
 *
 *   Tur firmalar:
 *   GET  /api/admin/agencies
 *   POST /api/admin/agencies            { name, login, phone?, contact?, password? }  -> parol bir marta qaytariladi
 *   POST /api/admin/agencies/update     { id, name, phone, contact }
 *   POST /api/admin/agencies/reset      { id }            -> yangi parol
 *   POST /api/admin/agencies/status     { id, status }    active | blocked
 *   POST /api/admin/agencies/extend     { id, tariff }    naqd / bank o'tkazmasi: tarifni qo'lda berish
 *   To'lovlar va tariflar:
 *   GET  /api/admin/payments
 *   POST /api/admin/payments/confirm    { id }
 *   POST /api/admin/payments/cancel     { id }
 *   GET  /api/admin/tariffs
 *   POST /api/admin/tariffs             { id, price, active }
 *
 *   Xavfsizlik (server/security.js):
 *   GET  /api/admin/security            bloklangan IP'lar, kuzatuvdagilar, oxirgi hodisalar
 *   POST /api/admin/security/ban        { ip, minutes?, reason? }
 *   POST /api/admin/security/unban      { ip }
 *
 *   Agentlar (Main Agent, navbat, ishchilar) — Owner API'sining o'zi, admin sessiyasi bilan:
 *   /api/admin/agents/overview, /main-agent, /websites, /searches, /agent/searches, /settings, /alerts, /logs, /events ...
 *   (server/owner/index.js, server.js da ulanadi)
 */
'use strict';

const crypto = require('crypto');
const { clientIp, secureAttr } = require('./net');

const COOKIE = 'tb_admin';
const SESSION_MS = 12 * 3600 * 1000;
const LOGIN_TRIES_PER_MIN = 5;

const IP_RE = /^(\d{1,3}\.){3}\d{1,3}$|^[0-9a-f:.]{2,45}$/i;

function createAdminApi({ db, sendJson, readBody, notify, password, accounts, shield }) {
  const sessions = new Map();           // token -> muddati (ms)
  const tries = new Map();              // ip -> [vaqtlar]

  const enabled = !!password;
  const hash = (s) => crypto.createHash('sha256').update(String(s)).digest();
  const passHash = enabled ? hash(password) : null;
  const today = () => { const n = new Date(); return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())).toISOString().slice(0, 10); };

  function tokenOf(req) {
    const m = (req.headers.cookie || '').match(new RegExp('(?:^|;\\s*)' + COOKIE + '=([a-f0-9]{64})'));
    return m ? m[1] : null;
  }
  function authed(req) {
    const tok = tokenOf(req);
    const exp = tok && sessions.get(tok);
    if (!exp) return false;
    if (exp < Date.now()) { sessions.delete(tok); return false; }
    return true;
  }
  function tooMany(ip) {
    const now = Date.now();
    const list = (tries.get(ip) || []).filter(ts => now - ts < 60000);
    tries.set(ip, list);
    return list.length >= LOGIN_TRIES_PER_MIN;
  }
  const cookie = (tok, maxAge) => `${COOKIE}=${tok}; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secureAttr()}`;

  async function jsonBody(req) {
    // CSRF'dan himoya: faqat JSON so'rovlar (oddiy forma bilan yuborib bo'lmaydi)
    if (!/^application\/json/i.test(req.headers['content-type'] || '')) return null;
    try { return JSON.parse(await readBody(req)); } catch (e) { return null; }
  }
  const keyOf = (body) => (body && typeof body.key === 'string' && body.key.length <= 300 ? body.key : '');

  async function handle(req, res, pathname, url, opts) {
    const siteUrl = (opts && opts.siteUrl) || '/';
    if (!enabled) return sendJson(res, 503, { error: 'admin_disabled' });
    const route = pathname.slice('/api/admin'.length);

    if (route === '/login') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'method' });
      const ip = clientIp(req);
      if (tooMany(ip)) { if (shield) shield.report(ip, 'rate_limited', 'admin_login'); return sendJson(res, 429, { error: 'rate_limited' }); }
      const body = await jsonBody(req);
      const ok = body && typeof body.password === 'string' && body.password.length <= 256 && crypto.timingSafeEqual(hash(body.password), passHash);
      if (!ok) {
        tries.get(ip).push(Date.now());
        if (shield) shield.report(ip, 'auth_fail', 'admin');
        return sendJson(res, 401, { error: 'bad_password' });
      }
      const tok = crypto.randomBytes(32).toString('hex');
      sessions.set(tok, Date.now() + SESSION_MS);
      res.setHeader('Set-Cookie', cookie(tok, SESSION_MS / 1000));
      return sendJson(res, 200, { ok: true });
    }
    if (route === '/logout') {
      const tok = tokenOf(req);
      if (tok) sessions.delete(tok);
      res.setHeader('Set-Cookie', cookie('', 0));
      return sendJson(res, 200, { ok: true });
    }
    if (route === '/me') return sendJson(res, 200, { authed: authed(req), siteUrl });

    if (!authed(req)) return sendJson(res, 401, { error: 'unauthorized' });

    if (req.method === 'GET') {
      if (route === '/stats') {
        const pays = accounts.listPayments();
        const ac = accounts.agencyCount();
        const monthStart = Date.parse(today().slice(0, 8) + '01T00:00:00Z');
        return sendJson(res, 200, Object.assign(db.stats(today()), {
          agencies: ac.n || 0, paidAgencies: ac.paid || 0,
          pendingPayments: pays.filter(p => p.status === 'pending').length,
          revenueMonth: pays.filter(p => p.status === 'paid' && p.paidAt >= monthStart).reduce((s, p) => s + p.amount, 0),
          revenueTotal: pays.filter(p => p.status === 'paid').reduce((s, p) => s + p.amount, 0),
          paymentMode: accounts.mode
        }));
      }
      if (route === '/agencies') return sendJson(res, 200, { agencies: accounts.listAgencies() });
      if (route === '/payments') return sendJson(res, 200, { payments: accounts.listPayments() });
      if (route === '/tariffs') return sendJson(res, 200, { tariffs: accounts.tariffs(false) });
      if (route === '/bookings') return sendJson(res, 200, { bookings: db.listAll(), today: today() });
      if (route === '/security') return sendJson(res, 200, shield ? Object.assign(shield.view(), { you: clientIp(req) }) : { enabled: false, bans: [], events: [], watch: [] });
      if (route === '/history') {
        const h = db.history(url.searchParams.get('key') || '');
        return h ? sendJson(res, 200, { events: h }) : sendJson(res, 404, { error: 'not_found' });
      }
    }
    if (req.method === 'POST' && (route === '/cancel' || route === '/restore')) {
      const key = keyOf(await jsonBody(req));
      if (!key) return sendJson(res, 400, { error: 'bad_request' });
      const b = route === '/cancel' ? db.cancelBooking(key, 'admin') : db.restoreBooking(key, 'admin');
      if (!b) return sendJson(res, 409, { error: 'no_change' });
      notify(route === '/cancel' ? 'cancelled' : 'restored');
      return sendJson(res, 200, { booking: b });
    }

    if (req.method === 'POST') {
      const body = await jsonBody(req);
      if (!body) return sendJson(res, 400, { error: 'bad_request' });
      const id = typeof body.id === 'string' ? body.id : '';
      // Muvaffaqiyatli bo'lsa — saytdagi firma sahifasi ham tarif holatini darhol yangilaydi
      const done = (r, err) => {
        if (!r) return sendJson(res, 404, { error: err || 'not_found' });
        if (route !== '/agencies/update') notify('account');
        return sendJson(res, 200, typeof r === 'object' ? r : { ok: true });
      };

      if (route === '/security/ban' || route === '/security/unban') {
        const ip = typeof body.ip === 'string' ? body.ip.trim() : '';
        if (!shield || !IP_RE.test(ip)) return sendJson(res, 400, { error: 'bad_ip' });
        if (route === '/security/unban') return shield.unban(ip) ? sendJson(res, 200, { ok: true }) : sendJson(res, 404, { error: 'not_found' });
        if (ip === clientIp(req)) return sendJson(res, 400, { error: 'self_ban' });          // o'zini bloklab qo'ymasin
        const minutes = Math.max(1, Math.min(525600, Math.round(Number(body.minutes) || 1440)));
        const r = shield.ban(ip, String(body.reason || 'admin').slice(0, 100), minutes, true);
        return r ? sendJson(res, 200, r) : sendJson(res, 400, { error: 'exempt_ip' });
      }
      if (route === '/agencies') {
        const r = accounts.createAgency(body, 'admin');
        return r.error ? sendJson(res, 400, r) : sendJson(res, 201, r);
      }
      if (route === '/agencies/update') return done(accounts.updateAgency(id, body), 'bad_request');
      if (route === '/agencies/reset') { const pw = accounts.resetPassword(id); return done(pw && { password: pw }); }
      if (route === '/agencies/status') return done(accounts.setAgencyStatus(id, body.status));
      if (route === '/agencies/extend') {
        const pid = accounts.createPayment(id, String(body.tariff || ''), 'manual', 'admin');
        return done(pid && accounts.confirmPayment(pid), 'bad_tariff');
      }
      if (route === '/payments/confirm') return done(accounts.confirmPayment(id), 'no_change');
      if (route === '/payments/cancel') return done(accounts.cancelPayment(id), 'no_change');
      if (route === '/tariffs') {
        const price = Math.round(Number(body.price));
        if (!isFinite(price) || price < 0 || price > 1e10) return sendJson(res, 400, { error: 'bad_price' });
        return done(accounts.setTariff(id, price, body.active !== false));
      }
    }
    return sendJson(res, 404, { error: 'not_found' });
  }

  // Muddati o'tgan sessiyalarni tozalash
  setInterval(() => { const now = Date.now(); sessions.forEach((exp, tok) => { if (exp < now) sessions.delete(tok); }); }, 600000).unref();

  // authed — agentlar API'si (/api/admin/agents) ham shu admin sessiyasi bilan himoyalanadi
  return { handle, enabled, authed: (req) => enabled && authed(req) };
}

module.exports = { createAdminApi };
