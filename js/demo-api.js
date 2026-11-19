/*
 * TezBooking — DEMO rejim: server API'sini brauzer ichida taqlid qilish.
 *
 * Qachon yoqiladi: sayt GitHub Pages'da (*.github.io) ochilganda yoki manzilda ?demo bo'lsa (?demo=0 — o'chiradi).
 * Oddiy ishda (npm start, localhost:3000) bu fayl hech narsa qilmaydi.
 *
 * Nima qiladi: window.fetch va EventSource'ni "/api/..." so'rovlari uchun almashtiradi va server/*.js dagi
 * javoblarni xuddi shu ko'rinishda qaytaradi. Ma'lumotlar shu brauzerning localStorage'ida
 * (har bir tashrif buyuruvchining o'z demo nusxasi). Boshlang'ich ma'lumotlar: js/demo-seed.js.
 * Sayt va admin panel bir nechta oynada ochiq bo'lsa, o'zgarishlar BroadcastChannel orqali jonli yetib boradi.
 */
(function () {
  'use strict';

  const qs = new URLSearchParams(location.search);
  let on = /\.github\.io$/i.test(location.hostname) || qs.has('demo');
  try {
    if (qs.get('demo') === '0') { sessionStorage.removeItem('tezdemo.on'); on = false; }
    else if (qs.has('demo')) sessionStorage.setItem('tezdemo.on', '1');
    else if (sessionStorage.getItem('tezdemo.on')) on = true;
  } catch (e) { /* sessionStorage yo'q */ }
  if (!on) return;

  const KEY = 'tezdemo.v1';
  const DAY = 86400000;
  const LOGINS = () => window.TezDemoSeed.LOGINS;
  const realFetch = window.fetch.bind(window);
  const RealES = window.EventSource;
  const chan = 'BroadcastChannel' in window ? new BroadcastChannel('tezdemo') : null;
  const local = [];                         // shu oynadagi soxta EventSource'lar
  let version = 0;

  // ---------- Saqlash ----------
  let mem = null;
  function load() {
    if (mem) return mem;
    try { mem = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { mem = null; }
    if (!mem || !mem.agencies) mem = fresh();
    return mem;
  }
  function fresh() {
    const s = window.TezDemoSeed(window.TB, Date.now());
    return { tariffs: s.tariffs, agencies: s.agencies, payments: s.payments, bookings: s.bookings, events: s.events, seq: 1000 };
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch (e) { /* to'lgan */ }
  }
  // Boshqa oynada o'zgarsa — qayta o'qiladi
  window.addEventListener('storage', (e) => { if (e.key === KEY) mem = null; });
  const nid = (p) => p + '-' + Date.now().toString(36) + '-' + (++load().seq).toString(36);
  const sess = {
    get: (k) => { try { return localStorage.getItem('tezdemo.s.' + k); } catch (e) { return null; } },
    set: (k, v) => { try { v == null ? localStorage.removeItem('tezdemo.s.' + k) : localStorage.setItem('tezdemo.s.' + k, v); } catch (e) { /* yo'q */ } }
  };

  // ---------- Jonli xabarlar (SSE o'rniga) ----------
  function notify(reason) {
    version++;
    const msg = { v: version, reason };
    local.forEach(es => es._emit('bookings', msg));
    if (chan) chan.postMessage(msg);
  }
  if (chan) chan.onmessage = (e) => { mem = null; local.forEach(es => es._emit('bookings', e.data)); };

  class DemoEventSource {
    constructor(url) {
      this.url = url; this.readyState = 1; this._l = {};
      local.push(this);
      setTimeout(() => this._emit('hello', { v: version }), 30);
    }
    addEventListener(type, fn) { (this._l[type] = this._l[type] || []).push(fn); }
    removeEventListener(type, fn) { this._l[type] = (this._l[type] || []).filter(f => f !== fn); }
    _emit(type, data) { (this._l[type] || []).forEach(fn => fn({ type, data: JSON.stringify(data) })); }
    close() { this.readyState = 2; const i = local.indexOf(this); if (i >= 0) local.splice(i, 1); }
  }
  window.EventSource = function (url, opts) {
    return /\/api\/events(\?|$)/.test(String(url)) ? new DemoEventSource(url) : new RealES(url, opts);
  };

  // ---------- Yordamchilar (server/*.js bilan bir xil ko'rinish) ----------
  const today = () => { const n = new Date(); return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())).toISOString().slice(0, 10); };
  const isActive = (a) => !!a && a.status === 'active' && a.paid_until > Date.now();
  const agencyById = (id) => load().agencies.find(a => a.id === id);
  const tariffView = (t) => ({ id: t.id, months: t.months, price: t.price, active: !!t.active });
  const bookingView = (b) => ({
    id: b.id, key: b.key, product: b.product, title: b.title, op: b.op, price: b.price, from: b.date_from, to: b.date_to,
    status: b.status, ref: null, at: b.created_at, updated: b.updated_at, agencyId: b.agency_id || null
  });
  function payView(p) {
    const a = agencyById(p.agency_id) || {};
    return { id: p.id, tariff: p.tariff_id, months: p.months, amount: p.amount, status: p.status, provider: p.provider, at: p.created_at,
      paidAt: p.paid_at, from: p.period_from, to: p.period_to, note: p.note || '', agencyId: p.agency_id, agency: a.name, login: a.login };
  }
  function agencyView(a) {
    const d = load();
    return { id: a.id, name: a.name, login: a.login, phone: a.phone, contact: a.contact, status: a.status,
      paidUntil: a.paid_until || null, active: isActive(a), createdAt: a.created_at, lastLogin: a.last_login,
      bookings: d.bookings.filter(b => b.agency_id === a.id && b.status !== 'cancelled').length,
      paidTotal: d.payments.filter(p => p.agency_id === a.id && p.status === 'paid').reduce((s, p) => s + p.amount, 0),
      pending: d.payments.filter(p => p.agency_id === a.id && p.status === 'pending').length };
  }
  function me(a) {
    const d = load();
    const mine = d.payments.filter(p => p.agency_id === a.id).sort((x, y) => y.created_at - x.created_at);
    return { agency: { name: a.name, login: a.login, paidUntil: a.paid_until || null, active: isActive(a) },
      pending: mine.filter(p => p.status === 'pending').map(payView), payments: mine.slice(0, 20).map(payView) };
  }
  function datesFromKey(key) {
    const p = key.split('|'), dt = window.TB.date;
    if (p[0] === 'F') return dt.isValid(p[5]) ? { from: p[5], to: dt.isValid(p[6]) ? p[6] : p[5] } : { from: null, to: null };
    if (!dt.isValid(p[2])) return { from: null, to: null };
    return { from: p[2], to: dt.addDays(p[2], Math.max(1, Math.min(60, parseInt(p[3], 10) || 1)) - 1) };
  }
  function logEvent(b, type, payload) { load().events.push({ booking_id: b.id, type, payload: payload || null, at: Date.now() }); }
  function confirmPayment(p) {
    const a = agencyById(p.agency_id), now = Date.now();
    p.status = 'paid'; p.paid_at = now;
    p.period_from = Math.max(now, a.paid_until || 0);
    p.period_to = window.TezDemoSeed.addMonths(p.period_from, p.months);
    a.paid_until = p.period_to;
    return payView(p);
  }
  function stats() {
    const d = load(), t = today(), monthStart = Date.parse(t.slice(0, 8) + '01T00:00:00Z'), now = Date.now();
    const act = d.bookings.filter(b => b.status !== 'cancelled');
    const byStatus = {}, byProduct = {};
    d.bookings.forEach(b => { byStatus[b.status] = (byStatus[b.status] || 0) + 1; });
    act.forEach(b => { const x = byProduct[b.product] = byProduct[b.product] || { n: 0, sum: 0 }; x.n++; x.sum += b.price || 0; });
    const paid = d.payments.filter(p => p.status === 'paid');
    return {
      byStatus, byProduct, activeSum: act.reduce((s, b) => s + (b.price || 0), 0),
      thisMonth: d.bookings.filter(b => b.created_at >= monthStart).length,
      upcoming: act.filter(b => b.date_from >= t).length,
      inTrip: act.filter(b => b.date_from <= t && b.date_to >= t).length,
      agencies: d.agencies.length, paidAgencies: d.agencies.filter(a => a.status === 'active' && a.paid_until > now).length,
      pendingPayments: d.payments.filter(p => p.status === 'pending').length,
      revenueMonth: paid.filter(p => p.paid_at >= monthStart).reduce((s, p) => s + p.amount, 0),
      revenueTotal: paid.reduce((s, p) => s + p.amount, 0),
      paymentMode: 'demo'
    };
  }
  function genPassword() {
    const abc = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const r = new Uint8Array(12); crypto.getRandomValues(r);
    return Array.from(r, x => abc[x % abc.length]).join('');
  }

  // ---------- Javob ----------
  const json = (status, obj, headers) => new Response(JSON.stringify(obj), { status, headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}) });
  const ok = (obj) => json(200, obj);
  const err = (status, code, extra) => json(status, Object.assign({ error: code }, extra || {}));

  // ---------- Marshrutlar ----------
  async function route(method, path, search, body) {
    const d = load();
    const agency = (() => { const a = agencyById(sess.get('agency')); return a && a.status === 'active' ? a : null; })();
    const admin = sess.get('admin') === '1';
    const done = (r, reason) => { save(); if (reason) notify(reason); return r; };

    if (path === '/api/health') return ok({ service: 'tezbooking-ai', ok: true, hasKey: true, model: 'demo', guard: null, bookings: true, demo: true });
    if (path === '/api/chat') return chatReply(body);

    // --- Bronlar ---
    if (path === '/api/bookings' && method === 'GET') {
      const list = d.bookings.filter(b => b.status !== 'cancelled').map(b => (agency && b.agency_id === agency.id)
        ? { key: b.key, product: b.product, title: b.title, op: b.op, price: b.price, from: b.date_from, to: b.date_to, at: b.created_at, mine: true }
        : { key: b.key, mine: false });
      return ok({ bookings: list, v: version });
    }
    if (path === '/api/bookings' && method === 'POST') {
      if (!agency) return err(401, 'login_required');
      if (!isActive(agency)) return err(402, 'subscription_required');
      if (!body || typeof body.key !== 'string' || !body.title) return err(400, 'bad_request');
      const ex = d.bookings.find(b => b.key === body.key);
      if (ex && ex.status !== 'cancelled') return err(409, 'already_booked', { booking: bookingView(ex) });
      const now = Date.now(), dd = datesFromKey(body.key);
      let b = ex;
      if (b) Object.assign(b, { product: body.product, title: body.title, op: body.op || '', price: body.price, status: 'confirmed', updated_at: now, agency_id: agency.id });
      else {
        b = { id: nid('bk'), key: body.key, product: body.product || 'tour', title: String(body.title).slice(0, 200), op: String(body.op || '').slice(0, 200),
          price: typeof body.price === 'number' ? body.price : null, date_from: dd.from, date_to: dd.to, status: 'confirmed', created_at: now, updated_at: now, agency_id: agency.id };
        d.bookings.push(b);
      }
      logEvent(b, ex ? 'restored' : 'created', ex ? null : { price: b.price, source: 'site', agency: agency.name });
      return done(json(201, { booking: bookingView(b) }), 'created');
    }
    if (path === '/api/bookings/cancel' && method === 'POST') {
      if (!agency) return err(401, 'login_required');
      const b = d.bookings.find(x => x.key === (body && body.key));
      if (!b || b.status === 'cancelled') return err(404, 'not_found');
      if (b.agency_id !== agency.id) return err(403, 'not_yours');
      b.status = 'cancelled'; b.updated_at = Date.now(); logEvent(b, 'cancelled', { by: 'site' });
      return done(ok({ booking: bookingView(b) }), 'cancelled');
    }

    // --- Tur firma ---
    if (path === '/api/tariffs') return ok({ tariffs: d.tariffs.filter(t => t.active).map(tariffView), mode: 'demo' });
    if (path === '/api/agency/login') {
      const a = d.agencies.find(x => x.login === String((body && body.login) || '').trim().toLowerCase());
      if (!a || a.password !== (body && body.password)) return err(401, 'bad_login');
      if (a.status !== 'active') return err(403, 'blocked');
      a.last_login = Date.now(); sess.set('agency', a.id);
      return done(ok(me(a)));
    }
    if (path === '/api/agency/logout') { sess.set('agency', null); return ok({ ok: true }); }
    if (path.startsWith('/api/agency/')) {
      if (!agency) return err(401, 'login_required');
      if (path === '/api/agency/me') return ok(me(agency));
      if (path === '/api/agency/pay') {
        const t = d.tariffs.find(x => x.id === (body && body.tariff) && x.active);
        if (!t) return err(400, 'bad_tariff');
        const p = { id: nid('pay'), agency_id: agency.id, tariff_id: t.id, months: t.months, amount: t.price, status: 'pending', provider: 'demo', created_at: Date.now(), paid_at: null, period_from: null, period_to: null, note: null };
        d.payments.push(p); confirmPayment(p);                // demo: darhol to'langan
        return done(ok(Object.assign(me(agency), { payment: payView(p), mode: 'demo' })), 'payment');
      }
      if (path === '/api/agency/password') return ok({ ok: true });
      return err(404, 'not_found');
    }

    // --- Admin ---
    if (path.startsWith('/api/admin/')) {
      const r = path.slice('/api/admin'.length);
      if (r === '/login') {
        if (!body || body.password !== LOGINS().admin) return err(401, 'bad_password');
        sess.set('admin', '1'); return ok({ ok: true });
      }
      if (r === '/logout') { sess.set('admin', null); return ok({ ok: true }); }
      if (r === '/me') return ok({ authed: admin, siteUrl: './' });
      if (!admin) return err(401, 'unauthorized');
      if (method === 'GET') {
        if (r === '/stats') return ok(stats());
        if (r === '/bookings') {
          const list = d.bookings.slice().sort((x, y) => y.created_at - x.created_at).map(b => Object.assign(bookingView(b), {
            events: d.events.filter(e => e.booking_id === b.id).length, agency: (agencyById(b.agency_id) || {}).name || '' }));
          return ok({ bookings: list, today: today() });
        }
        if (r === '/agencies') return ok({ agencies: d.agencies.slice().sort((x, y) => y.created_at - x.created_at).map(agencyView) });
        if (r === '/payments') return ok({ payments: d.payments.slice().sort((x, y) => y.created_at - x.created_at).map(payView) });
        if (r === '/tariffs') return ok({ tariffs: d.tariffs.map(tariffView) });
        if (r === '/history') {
          const b = d.bookings.find(x => x.key === search.get('key'));
          return b ? ok({ events: d.events.filter(e => e.booking_id === b.id).map(e => ({ type: e.type, at: e.at, payload: e.payload })) }) : err(404, 'not_found');
        }
      }
      if (method === 'POST') {
        if (!body) return err(400, 'bad_request');
        const a = agencyById(body.id);
        if (r === '/cancel' || r === '/restore') {
          const b = d.bookings.find(x => x.key === body.key);
          const want = r === '/cancel' ? 'cancelled' : 'confirmed';
          if (!b || (r === '/cancel' ? b.status === 'cancelled' : b.status !== 'cancelled')) return err(409, 'no_change');
          b.status = want; b.updated_at = Date.now(); logEvent(b, r === '/cancel' ? 'cancelled' : 'restored', { by: 'admin' });
          return done(ok({ booking: bookingView(b) }), r === '/cancel' ? 'cancelled' : 'restored');
        }
        if (r === '/agencies') {
          const login = String(body.login || '').trim().toLowerCase();
          if (!/^[a-z0-9._-]{3,32}$/.test(login)) return err(400, 'bad_login');
          if (d.agencies.some(x => x.login === login)) return err(400, 'login_taken');
          const name = String(body.name || '').trim().slice(0, 120);
          if (!name) return err(400, 'bad_name');
          const password = body.password && String(body.password).length >= 8 ? String(body.password) : genPassword();
          const ag = { id: nid('ag'), name, login, password, phone: String(body.phone || '').trim(), contact: String(body.contact || '').trim(), status: 'active', paid_until: 0, created_at: Date.now(), last_login: null };
          d.agencies.push(ag);
          return done(json(201, { agency: agencyView(ag), password }), 'account');
        }
        if (r === '/agencies/update') {
          if (!a) return err(404, 'not_found');
          a.name = String(body.name || a.name).trim() || a.name; a.phone = String(body.phone || '').trim(); a.contact = String(body.contact || '').trim();
          return done(ok({ ok: true }));
        }
        if (r === '/agencies/reset') { if (!a) return err(404, 'not_found'); a.password = genPassword(); if (sess.get('agency') === a.id) sess.set('agency', null); return done(ok({ password: a.password }), 'account'); }
        if (r === '/agencies/status') {
          if (!a || !['active', 'blocked'].includes(body.status)) return err(404, 'not_found');
          a.status = body.status; if (a.status === 'blocked' && sess.get('agency') === a.id) sess.set('agency', null);
          return done(ok({ ok: true }), 'account');
        }
        if (r === '/agencies/extend') {
          const t = d.tariffs.find(x => x.id === body.tariff && x.active);
          if (!a || !t) return err(404, 'bad_tariff');
          const p = { id: nid('pay'), agency_id: a.id, tariff_id: t.id, months: t.months, amount: t.price, status: 'pending', provider: 'manual', created_at: Date.now(), paid_at: null, period_from: null, period_to: null, note: 'admin' };
          d.payments.push(p);
          return done(ok(confirmPayment(p)), 'account');
        }
        if (r === '/payments/confirm' || r === '/payments/cancel') {
          const p = d.payments.find(x => x.id === body.id);
          if (!p || p.status !== 'pending') return err(404, 'no_change');
          if (r === '/payments/cancel') { p.status = 'cancelled'; return done(ok({ ok: true }), 'account'); }
          return done(ok(confirmPayment(p)), 'account');
        }
        if (r === '/tariffs') {
          const t = d.tariffs.find(x => x.id === body.id), price = Math.round(Number(body.price));
          if (!t) return err(404, 'not_found');
          if (!isFinite(price) || price < 0) return err(400, 'bad_price');
          t.price = price; t.active = body.active !== false ? 1 : 0;
          return done(ok(tariffView(t)), 'account');
        }
      }
      return err(404, 'not_found');
    }
    return err(404, 'not_found');
  }

  // AI yordamchi: demo'da Claude API'siz — qisqa tushuntirish
  function chatReply(body) {
    const lang = (body && body.lang) || 'uz';
    const text = {
      uz: "Bu — TezBooking'ning demo versiyasi. AI yordamchi to'liq versiyada ishlaydi: u yo'nalishlar, viza, mavsum va narxlar bo'yicha savollarga javob beradi va ekrandagi qidiruv natijalaridan mijozga taklif tayyorlab beradi.",
      ru: 'Это демо-версия TezBooking. AI-помощник работает в полной версии: отвечает на вопросы о направлениях, визах, сезонах и ценах и готовит предложение клиенту по результатам поиска.',
      en: "This is the TezBooking demo. The AI assistant works in the full version: it answers questions about destinations, visas, seasons and prices, and drafts client offers from your search results."
    }[lang] || '';
    return new Response(text, { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }

  // ---------- fetch'ni almashtirish ----------
  window.fetch = async function (input, init) {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    const m = url.pathname.match(/\/api\/.*$/);
    if (!m || url.origin !== location.origin && !/^https?:\/\/localhost/.test(url.origin)) return realFetch(input, init);
    // localhost:3000 ga so'rovlar ham demo'ga (sayt fayldan ochilgan bo'lsa)
    const method = ((init && init.method) || 'GET').toUpperCase();
    let body = null;
    if (init && typeof init.body === 'string') { try { body = JSON.parse(init.body); } catch (e) { body = null; } }
    await new Promise(r => setTimeout(r, 120 + Math.random() * 180));    // tarmoqdek kichik kechikish
    try { return await route(method, m[0], url.searchParams, body); }
    catch (e) { console.error('[demo]', e); return err(500, 'server'); }
  };

  // ---------- Demo bannari ----------
  function banner() {
    const isAdmin = /admin(\.html)?$/.test(location.pathname) || !!document.getElementById('admin');
    const L = LOGINS();
    const el = document.createElement('div');
    el.className = 'demo-ribbon';
    el.setAttribute('role', 'note');
    el.innerHTML = `
      <b>DEMO</b>
      <span>${isAdmin
        ? `Admin paroli: <code>${L.admin}</code>`
        : `Tur firma: <code>${L.agency.login}</code> / <code>${L.agency.password}</code> · tarifsiz: <code>${L.fresh.login}</code>`}</span>
      <a href="${isAdmin ? './' : 'admin.html'}" target="_blank" rel="noopener">${isAdmin ? 'Saytni ochish' : 'Admin panel'} ↗</a>
      <button type="button" data-demo-reset title="Demo ma'lumotlarini boshlang'ich holatga qaytarish">Qayta boshlash</button>
      <button type="button" data-demo-hide aria-label="Yopish">×</button>`;
    document.body.appendChild(el);
    el.querySelector('[data-demo-reset]').addEventListener('click', () => {
      if (!confirm("Demo ma'lumotlari boshlang'ich holatga qaytarilsinmi?")) return;
      try { Object.keys(localStorage).filter(k => k.indexOf('tezdemo.') === 0 || k.indexOf('tezbooking.') === 0).forEach(k => localStorage.removeItem(k)); } catch (e) { /* yo'q */ }
      if (chan) chan.postMessage({ v: ++version, reason: 'reset' });
      location.reload();
    });
    el.querySelector('[data-demo-hide]').addEventListener('click', () => el.remove());
    const css = document.createElement('style');
    css.textContent = `
      .demo-ribbon{position:fixed;left:16px;bottom:calc(var(--dock-h,0px) + 16px);z-index:45;display:flex;align-items:center;gap:10px;flex-wrap:wrap;
        max-width:calc(100vw - 120px);padding:6px 8px 6px 12px;border-radius:999px;background:rgba(23,17,65,.92);color:#fff;font:600 12.5px/1.3 Inter,system-ui,sans-serif;
        box-shadow:0 8px 24px rgba(0,0,0,.25);backdrop-filter:blur(8px)}
      .demo-ribbon b{background:linear-gradient(135deg,#2EE2EE,#4F7CF7);color:#171141;padding:2px 8px;border-radius:999px;font-size:11px;letter-spacing:.06em}
      .demo-ribbon code{background:rgba(255,255,255,.14);padding:1px 6px;border-radius:6px;font-size:12px;user-select:all}
      .demo-ribbon a{color:#9AF6FA;text-decoration:none}
      .demo-ribbon button{border:0;border-radius:999px;background:rgba(255,255,255,.12);color:#fff;font:inherit;padding:4px 10px;cursor:pointer;min-height:28px}
      .demo-ribbon [data-demo-hide]{width:28px;padding:0;font-size:16px}
      @media (max-width:760px){.demo-ribbon{left:8px;bottom:calc(var(--dock-h,0px) + 84px);max-width:calc(100vw - 16px);border-radius:16px}}`;
    document.head.appendChild(css);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', banner); else banner();

  window.TezDemo = { reset: () => { mem = fresh(); save(); notify('reset'); }, data: () => load() };
})();
