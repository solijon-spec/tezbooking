'use strict';

/*
 * Operator kabinetiga kirish sessiyalari (SAMO, Pegas, Asialuxe — har biri o'z logon funksiyasi bilan).
 *   session(op, signal) -> sessiya qiymati (cookie yoki token) | '' (login yo'q yoki kirib bo'lmadi)
 * - bir vaqtdagi qidiruvlar bitta kirishni kutadi (operatorga parallel login yuborilmaydi);
 * - sessiya ttlMs davomida qayta ishlatiladi; operator sessiyani yopsa — expire(id), keyingi qidiruvda qayta kiriladi;
 * - parol qabul qilinmasa (LIVE_AUTH_FAILED / LIVE_AUTH_NO_FORM) — retryMs davomida qayta urinilmaydi (hisob bloklanmasin);
 * - holat (status) parolsiz: none | pending | authenticated | failed.
 */

const { credentialsFor } = require('./credentials');

const DENIED = new Set(['LIVE_AUTH_FAILED', 'LIVE_AUTH_NO_FORM']);
const authError = (code) => Object.assign(new Error('supplier login failed'), { code });

function createAuth({ logon, ttlMs = 20 * 60000, retryMs = 30 * 60000 }) {
  const state = new Map();   // opId -> { value, at } | { failedAt } | { pending }
  const info = new Map();    // opId -> { status, at, error }

  function session(op, signal, { fetchImpl, env = process.env, now = Date.now } = {}) {
    const creds = credentialsFor(op.id, env);
    if (!creds) return Promise.resolve('');
    const a = state.get(op.id);
    if (a && a.pending) return a.pending;
    if (a && a.value && now() - a.at < ttlMs) return Promise.resolve(a.value);
    if (a && a.failedAt && now() - a.failedAt < retryMs) return Promise.resolve('');
    const pending = Promise.resolve().then(() => logon(op, creds, signal, fetchImpl)).then(value => {
      state.set(op.id, { value, at: now() });
      info.set(op.id, { status: 'authenticated', at: now() });
      return value;
    }, error => {
      const denied = !!error && DENIED.has(error.code);
      if (denied) state.set(op.id, { failedAt: now() });
      else state.delete(op.id);                 // tarmoq xatosi — keyingi qidiruvda yana urinadi
      info.set(op.id, { status: 'failed', at: now(), error: denied ? 'auth_failed' : 'auth_unavailable' });
      return '';
    });
    state.set(op.id, { pending });
    return pending;
  }

  function status(id, env = process.env) {
    if (!credentialsFor(id, env)) return { status: 'none' };
    const current = info.get(id);
    return current ? Object.assign({}, current) : { status: 'pending' };
  }

  // Operator sessiyani yopdi (401, "session closed") — keyingi so'rovda qayta kirish
  function expire(id) {
    const a = state.get(id);
    if (a && a.value) state.delete(id);
  }

  function reset(id) {
    if (id) { state.delete(id); info.delete(id); } else { state.clear(); info.clear(); }
  }

  return { session, status, expire, reset };
}

// Cookie'larni birlashtirish: eski "a=1; b=2" + yangi Set-Cookie qatorlari (bir xil nom — yangisi)
function mergeCookies(cookie, setCookies) {
  const jar = new Map();
  const put = (pair) => {
    const kv = String(pair).trim();
    const i = kv.indexOf('=');
    if (i > 0) jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim());
  };
  String(cookie || '').split(';').forEach(put);
  (setCookies || []).forEach(line => put(String(line).split(';')[0]));
  return [...jar].map(([name, value]) => name + '=' + value).join('; ');
}
const setCookiesOf = (r) => (r.headers && r.headers.getSetCookie ? r.headers.getSetCookie() : []);

module.exports = { createAuth, authError, mergeCookies, setCookiesOf, DENIED };
