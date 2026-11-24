/*
 * TezBooking — Telegram Bot API mijozi (paketsiz: Node.js ichidagi fetch, FormData, Blob).
 *
 * Token faqat shu modul ichida, URL'da turadi. Xato matnlariga token hech qachon qo'shilmaydi.
 */
'use strict';

const fs = require('fs');
const path = require('path');

function createTelegramApi(token, { fetchImpl = fetch, base = 'https://api.telegram.org' } = {}) {
  if (!/^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(String(token || ''))) throw new Error('TELEGRAM_BOT_TOKEN noto\'g\'ri formatda (BotFather bergan tokenni yozing)');
  const url = (method) => base + '/bot' + token + '/' + method;
  let pollCtrl = null;

  function fail(method, data, status) {
    const e = new Error('telegram ' + method + ': ' + String((data && data.description) || ('HTTP ' + status)).slice(0, 200));
    e.code = data && data.error_code;
    e.retryAfter = data && data.parameters && data.parameters.retry_after;
    e.description = data && data.description;
    return e;
  }

  async function call(method, params, timeoutMs) {
    const ctrl = new AbortController();
    if (method === 'getUpdates') pollCtrl = ctrl;
    const timer = setTimeout(() => ctrl.abort(), timeoutMs || 20000);
    try {
      const r = await fetchImpl(url(method), {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params || {}), signal: ctrl.signal
      });
      const data = await r.json().catch(() => null);
      if (!data || !data.ok) throw fail(method, data, r.status);
      return data.result;
    } finally {
      clearTimeout(timer);
      if (pollCtrl === ctrl) pollCtrl = null;
    }
  }

  // Fayl yuklash (rasm): multipart/form-data
  async function upload(method, params, field, filePath, timeoutMs) {
    const fd = new FormData();
    Object.keys(params || {}).forEach(k => {
      const v = params[k];
      if (v == null) return;
      fd.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    });
    const ext = path.extname(filePath).toLowerCase();
    const type = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    fd.append(field, new Blob([fs.readFileSync(filePath)], { type }), path.basename(filePath));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs || 60000);
    try {
      const r = await fetchImpl(url(method), { method: 'POST', body: fd, signal: ctrl.signal });
      const data = await r.json().catch(() => null);
      if (!data || !data.ok) throw fail(method, data, r.status);
      return data.result;
    } finally { clearTimeout(timer); }
  }

  return { call, upload, abortPoll: () => { if (pollCtrl) pollCtrl.abort(); } };
}

module.exports = { createTelegramApi };
