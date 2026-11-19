/*
 * TezBooking — server bilan bronlarni sinxronlash.
 *
 * Server topilsa: bronlar bazada saqlanadi va boshqa kompyuterlardagi o'zgarishlar jonli keladi (/api/events).
 * Server topilmasa (masalan, index.html fayldan ochilgan): sayt avvalgidek faqat brauzerda saqlaydi.
 *
 *   TezSync.find()          -> true | false
 *   TezSync.list()          -> [{ key, product, title, op, price, from, to, status, at }]
 *   TezSync.create(b)       -> booking   (xato: err.status === 409 — allaqachon bron qilingan)
 *   TezSync.cancel(key)     -> booking
 *   TezSync.subscribe(fn)   -> bronlar o'zgarganda fn() chaqiriladi
 */
(function (global) {
  'use strict';

  let base = null;

  async function request(path, opts, timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs || 8000);
    try {
      const resp = await fetch(base + path, Object.assign({ cache: 'no-store', credentials: 'same-origin', signal: ctrl.signal }, opts || {}));
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) { const err = new Error(data.error || 'http_' + resp.status); err.status = resp.status; err.data = data; throw err; }
      return data;
    } finally { clearTimeout(timer); }
  }
  const post = (path, body) => request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  async function find() {
    const candidates = [];
    if (global.TEZBOOKING_API) candidates.push(String(global.TEZBOOKING_API).replace(/\/$/, ''));
    if (/^https?:$/.test(location.protocol)) candidates.push('');
    candidates.push('http://localhost:3000');
    for (const b of candidates) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 2500);
        const resp = await fetch(b + '/api/health', { signal: ctrl.signal, cache: 'no-store' });
        clearTimeout(timer);
        const info = resp.ok ? await resp.json() : null;
        if (info && info.service === 'tezbooking-ai' && info.bookings) { base = b; return true; }
      } catch (e) { /* keyingi manzil */ }
    }
    return false;
  }

  // Bitta ulanish, bir nechta tinglovchi. fn(reason): 'created' | 'cancelled' | 'restored' | 'payment' | 'account' | 'reconnect'
  const listeners = [];
  let es = null;
  function subscribe(fn) {
    if (base == null || !global.EventSource) return;
    listeners.push(fn);
    if (es) return;
    let timer = 0, reason = '';
    es = new EventSource(base + '/api/events');
    // Bir nechta o'zgarish ketma-ket kelsa — bitta yangilash
    const later = (r) => {
      reason = reason && reason !== r ? 'many' : r;
      clearTimeout(timer);
      timer = setTimeout(() => { const x = reason; reason = ''; listeners.forEach(f => f(x)); }, 150);
    };
    es.addEventListener('bookings', (e) => { let r = ''; try { r = JSON.parse(e.data).reason; } catch (err) { /* yo'q */ } later(r); });
    // Uzilib qayta ulanganda: o'tkazib yuborilgan o'zgarishlar uchun ro'yxat qayta olinadi
    let first = true;
    es.addEventListener('hello', () => { if (!first) later('reconnect'); first = false; });
  }

  global.TezSync = {
    find,
    online: () => base != null,
    sameOrigin: () => base === '',          // login (cookie) faqat sayt server orqali ochilganda ishlaydi
    request, post,
    list: () => request('/api/bookings').then(d => d.bookings || []),
    create: (b) => post('/api/bookings', b).then(d => d.booking),
    cancel: (key) => post('/api/bookings/cancel', { key }).then(d => d.booking),
    subscribe
  };
})(window);
