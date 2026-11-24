/*
 * TezBooking — tur firma akkaunti: kirish, tariflar (3 / 6 / 12 oy) va to'lov.
 *
 *   TezAccount.init()        server topilgandan keyin (js/app.js -> initSync) chaqiriladi
 *   TezAccount.info()        { available, loggedIn, agency: { name, login, paidUntil, active }, pending: [...] }
 *   TezAccount.canBook()     true — tarif faol
 *   TezAccount.open()        kirish oynasi yoki (kirgan bo'lsa) tariflar oynasi
 *   TezAccount.onChange(fn)  holat o'zgarganda (kirdi, chiqdi, to'ladi, admin tasdiqladi)
 *
 * Matnlar js/i18n.js da (acc_*, plan_*, pay_*), TezApp.t orqali olinadi.
 * Server: server/accounts.js
 */
(function (global) {
  'use strict';

  const acc = { available: false, loggedIn: false, agency: null, pending: [], tariffs: [], mode: 'manual', register: false, markupDefault: 10 };
  const listeners = [];
  let modal = null;

  const t = (k, p) => (global.TezApp ? global.TezApp.t(k, p) : k);
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const sync = () => global.TezSync;
  const p2 = (n) => (n < 10 ? '0' : '') + n;
  const dateOf = (ms) => { const d = new Date(ms); return p2(d.getDate()) + '.' + p2(d.getMonth() + 1) + '.' + d.getFullYear(); };
  function som(v) {
    const lang = global.TezApp ? global.TezApp.lang() : 'uz';
    return String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, lang === 'en' ? ',' : ' ') + ' ' + t('uzs');
  }
  const planName = (m) => (m === 12 ? t('plan_y') : t('plan_m', { n: m }));
  const changed = (note) => listeners.forEach(fn => fn(note || ''));

  function apply(me) {
    const wasActive = !!(acc.agency && acc.agency.active);
    acc.loggedIn = !!(me && me.agency);
    acc.agency = acc.loggedIn ? me.agency : null;
    acc.pending = (me && me.pending) || [];
    return !wasActive && acc.agency && acc.agency.active;      // hozirgina faollashdimi
  }

  async function refresh(reason) {
    if (!acc.available) return;
    try {
      const me = await sync().request('/api/agency/me');
      const activated = apply(me);
      changed(activated && reason ? t('n_plan_active', { d: dateOf(acc.agency.paidUntil) }) : '');
      if (modal && acc.loggedIn && modal.kind === 'plans') drawPlans();
    } catch (e) {
      if (e.status === 401 && acc.loggedIn) { apply(null); changed(); }
    }
  }

  async function init() {
    const s = sync();
    if (!s || !s.online() || !s.sameOrigin()) return;
    acc.available = true;
    try {
      const r = await s.request('/api/tariffs');
      acc.tariffs = r.tariffs || []; acc.mode = r.mode; acc.register = !!r.register;
      if (typeof r.markupDefault === 'number') acc.markupDefault = r.markupDefault;
    } catch (e) { /* keyin */ }
    try { apply(await s.request('/api/agency/me')); } catch (e) { apply(null); }
    changed();
    // Admin to'lovni tasdiqlasa yoki firmani bloklasa — darhol ko'rinadi
    s.subscribe((reason) => { if (reason === 'account' || reason === 'payment' || reason === 'reconnect') refresh(reason); });
  }

  // ---------- Oyna ----------
  function openModal(kind) {
    if (!modal) {
      const root = document.createElement('div');
      root.className = 'acc-backdrop';
      root.innerHTML = '<div class="acc-modal" role="dialog" aria-modal="true" aria-labelledby="acc-title"><div class="acc-body"></div></div>';
      document.body.appendChild(root);
      const ret = document.activeElement;
      modal = { root, body: root.querySelector('.acc-body'), kind, ret };
      root.addEventListener('mousedown', (e) => { if (e.target === root) close(); });
      root.addEventListener('click', onClick);
      root.addEventListener('submit', onSubmit);
      document.addEventListener('keydown', onKey, true);
      document.documentElement.classList.add('wp-lock');
      requestAnimationFrame(() => root.classList.add('open'));
    }
    modal.kind = kind;
  }
  function close() {
    if (!modal) return;
    const m = modal; modal = null;
    document.removeEventListener('keydown', onKey, true);
    document.documentElement.classList.remove('wp-lock');
    m.root.remove();
    if (m.ret && document.contains(m.ret)) m.ret.focus({ preventScroll: true });
  }
  function onKey(e) {
    if (!modal) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key === 'Tab') {
      const f = Array.from(modal.root.querySelectorAll('button:not([disabled]), input, a[href]'));
      if (!f.length) return;
      const i = f.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    }
  }
  const closeBtn = () => `<button type="button" class="acc-x" data-acc="close" aria-label="${esc(t('acc_close'))}">×</button>`;

  function drawLogin(error) {
    openModal('login');
    modal.body.innerHTML = `
      ${closeBtn()}
      <h2 id="acc-title" class="acc-h">${esc(t('acc_login_title'))}</h2>
      <p class="muted">${esc(t('acc_login_text'))}</p>
      <form class="acc-form" data-acc-form="login" novalidate>
        <label><span class="label">${esc(t('acc_user'))}</span><input class="input" name="login" autocomplete="username" autocapitalize="off" spellcheck="false" required></label>
        <label><span class="label">${esc(t('acc_pass'))}</span><input class="input" name="password" type="password" autocomplete="current-password" required></label>
        <p class="acc-error" role="alert">${esc(error || '')}</p>
        <button class="btn btn-dark acc-wide" type="submit">${esc(t('acc_login'))}</button>
      </form>
      ${acc.register ? `<p class="acc-switch"><button type="button" class="btn-link" data-acc="to-register">${esc(t('acc_to_register'))}</button></p>` : ''}`;
    modal.body.querySelector('input[name=login]').focus();
  }

  // Ro'yxatdan o'tish: firma nomi, telefon, login, parol va firma oladigan foiz (ustama)
  function drawRegister(error, values) {
    openModal('register');
    const v = values || {};
    const val = (k, d) => esc(v[k] != null ? v[k] : (d == null ? '' : d));
    modal.body.innerHTML = `
      ${closeBtn()}
      <h2 id="acc-title" class="acc-h">${esc(t('acc_reg_title'))}</h2>
      <p class="muted">${esc(t('acc_reg_text'))}</p>
      <form class="acc-form" data-acc-form="register" novalidate>
        <label><span class="label">${esc(t('acc_name'))}</span><input class="input" name="name" maxlength="120" autocomplete="organization" required value="${val('name')}"></label>
        <label><span class="label">${esc(t('acc_phone'))}</span><input class="input" name="phone" type="tel" maxlength="40" autocomplete="tel" placeholder="+998 90 123 45 67" required value="${val('phone')}"></label>
        <label><span class="label">${esc(t('acc_contact'))}</span><input class="input" name="contact" maxlength="120" autocomplete="name" value="${val('contact')}"></label>
        <label><span class="label">${esc(t('acc_markup'))}</span>
          <span class="acc-markup-row"><input class="input" name="markup" type="number" min="0" max="50" step="0.5" inputmode="decimal" required value="${val('markup', acc.markupDefault)}"><b>%</b></span>
          <span class="hint">${esc(t('acc_markup_hint'))}</span></label>
        <label><span class="label">${esc(t('acc_login_new'))}</span><input class="input" name="login" maxlength="32" autocomplete="username" autocapitalize="off" spellcheck="false" required value="${val('login')}"></label>
        <label><span class="label">${esc(t('acc_pass'))}</span><input class="input" name="password" type="password" minlength="8" maxlength="128" autocomplete="new-password" required>
          <span class="hint">${esc(t('acc_pass_hint'))}</span></label>
        <label class="acc-hp" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label>
        <p class="acc-error" role="alert">${esc(error || '')}</p>
        <button class="btn btn-accent acc-wide" type="submit">${esc(t('acc_reg_btn'))}</button>
      </form>
      <p class="acc-switch"><button type="button" class="btn-link" data-acc="to-login">${esc(t('acc_to_login'))}</button></p>`;
    modal.body.querySelector('input[name=name]').focus();
  }

  // Tariflar oynasidagi qo'shimcha: firma foizi va Telegram bot kodi
  function drawExtras(a) {
    return `
      <form class="acc-form acc-tg" data-acc-form="markup" novalidate>
        <label><span class="label">${esc(t('acc_markup_now'))}</span>
          <span class="acc-markup-row"><input class="input" name="markup" type="number" min="0" max="50" step="0.5" inputmode="decimal" value="${esc(a.markup != null ? a.markup : acc.markupDefault)}"><b>%</b>
          <button class="btn btn-sm" type="submit">${esc(t('acc_markup_save'))}</button></span>
          <span class="hint">${esc(t('acc_markup_hint'))}</span></label>
      </form>
      <div class="acc-tg">
        <span class="label">${esc(t('acc_tg_title'))}</span>
        <div class="acc-tg-code">${acc.tgCode ? esc(t('acc_tg_code', { c: acc.tgCode })) : ''}</div>
        <button type="button" class="btn btn-sm" data-acc="tg-code">${esc(t('acc_tg_btn'))}</button>
      </div>`;
  }

  function drawPlans() {
    openModal('plans');
    const a = acc.agency;
    const list = acc.tariffs.slice().sort((x, y) => x.months - y.months);
    const base = list.length ? list[0].price / list[0].months : 0;          // eng qisqa tarifning oylik narxi
    const best = list.reduce((b, x) => (!b || x.price / x.months < b.price / b.months ? x : b), null);
    const pend = acc.pending[0];
    modal.body.innerHTML = `
      ${closeBtn()}
      <div class="acc-who">
        <div><b>${esc(a.name)}</b><span class="muted"> · ${esc(a.login)}</span></div>
        <span class="acc-plan ${a.active ? 'on' : ''}">${esc(a.active ? t('plan_until', { d: dateOf(a.paidUntil) }) : pend ? t('plan_pending') : t('plan_none'))}</span>
        <button type="button" class="btn btn-sm" data-acc="logout">${esc(t('acc_logout'))}</button>
      </div>
      <h2 id="acc-title" class="acc-h">${esc(t('plans_title'))}</h2>
      <p class="muted">${esc(t('plans_text'))}</p>
      ${a.active ? `<p class="acc-info">${esc(t('plan_extend_note', { d: dateOf(a.paidUntil) }))}</p>` : ''}
      ${pend ? `<p class="acc-info acc-wait">${esc(t('pay_waiting', { t: planName(pend.months), p: som(pend.amount) }))}<br><span class="xs">${esc(t('pay_ref'))}: ${esc(pend.id.slice(0, 8).toUpperCase())}</span></p>` : ''}
      <div class="acc-plans">${list.map(x => {
        const save = base ? Math.round((1 - x.price / x.months / base) * 100) : 0;
        const isBest = best && x.id === best.id && list.length > 1;
        return `
        <div class="acc-card${isBest ? ' best' : ''}">
          ${isBest ? `<span class="acc-badge">${esc(t('plan_best'))}</span>` : ''}
          <span class="acc-name">${esc(planName(x.months))}</span>
          <span class="acc-price">${esc(som(x.price))}</span>
          <span class="muted xs">${esc(t('plan_per_month', { p: som(x.price / x.months) }))}${save > 0 ? ` · <b class="acc-save">${esc(t('plan_save', { n: save }))}</b>` : ''}</span>
          <button type="button" class="btn ${isBest ? 'btn-accent' : 'btn-dark'} acc-wide" data-acc="buy" data-id="${esc(x.id)}">${esc(t('plan_buy'))}</button>
        </div>`;
      }).join('')}</div>
      ${acc.mode === 'demo' ? `<p class="hint acc-demo">${esc(t('pay_demo_note'))}</p>` : ''}
      ${drawExtras(a)}`;
    const first = modal.body.querySelector('[data-acc=buy]');
    if (first && !modal.root.contains(document.activeElement)) first.focus();
  }

  function drawPending(p) {
    openModal('pending');
    modal.body.innerHTML = `
      ${closeBtn()}
      <div class="acc-done-ico" aria-hidden="true">⏳</div>
      <h2 id="acc-title" class="acc-h">${esc(t('pay_pending_title'))}</h2>
      <p>${esc(t('pay_pending_text', { t: planName(p.months), p: som(p.amount) }))}</p>
      <p class="acc-info">${esc(t('pay_ref'))}: <b>${esc(p.id.slice(0, 8).toUpperCase())}</b></p>
      <button type="button" class="btn btn-dark acc-wide" data-acc="close">${esc(t('acc_close'))}</button>`;
    modal.body.querySelector('[data-acc=close].btn').focus();
  }

  async function onClick(e) {
    const b = e.target.closest('[data-acc]'); if (!b) return;
    const what = b.dataset.acc;
    if (what === 'close') return close();
    if (what === 'to-register') return drawRegister();
    if (what === 'to-login') return drawLogin();
    if (what === 'tg-code') {
      b.disabled = true;
      try {
        const r = await sync().post('/api/agency/telegram-code', {});
        acc.tgCode = r.code;
        const box = modal && modal.body.querySelector('.acc-tg-code');
        if (box) box.textContent = t('acc_tg_code', { c: r.code });
      } catch (err) { changed(t('acc_offline')); }
      b.disabled = false;
      return;
    }
    if (what === 'logout') {
      try { await sync().post('/api/agency/logout', {}); } catch (err) { /* baribir */ }
      apply(null); close(); changed(t('n_logged_out'));
      return;
    }
    if (what === 'buy') {
      b.disabled = true;
      try {
        const r = await sync().post('/api/agency/pay', { tariff: b.dataset.id });
        apply(r);
        if (r.payment && r.payment.status === 'paid') { close(); changed(t('pay_done', { d: dateOf(acc.agency.paidUntil) })); }
        else { drawPending(r.payment); changed(); }
      } catch (err) {
        if (err.status === 401) { apply(null); changed(); drawLogin(); return; }
        b.disabled = false;
        changed(t('acc_offline'));
      }
    }
  }

  async function onSubmit(e) {
    const f = e.target;
    if (f.dataset.accForm === 'register') { e.preventDefault(); return submitRegister(f); }
    if (f.dataset.accForm === 'markup') { e.preventDefault(); return submitMarkup(f); }
    if (f.dataset.accForm !== 'login') return;
    e.preventDefault();
    const login = f.login.value.trim(), password = f.password.value;
    if (!login || !password) { drawLogin(t('acc_bad')); return; }
    f.querySelector('[type=submit]').disabled = true;
    try {
      const me = await sync().post('/api/agency/login', { login, password });
      apply(me);
      changed(t('n_logged_in', { x: acc.agency.name }));
      // Tarif yo'q bo'lsa — darhol tariflar
      if (acc.agency.active) close(); else drawPlans();
    } catch (err) {
      drawLogin(err.status === 401 ? t('acc_bad') : err.status === 403 ? t('acc_blocked') : err.status === 429 ? t('acc_many') : t('acc_offline'));
      const inp = modal && modal.body.querySelector('input[name=login]');
      if (inp) inp.value = login;
    }
  }

  const markupOf = (s) => { const n = Number(String(s || '').replace(',', '.')); return isFinite(n) && n >= 0 && n <= 50 ? Math.round(n * 2) / 2 : null; };

  async function submitRegister(f) {
    const v = {
      name: f.name.value.trim(), phone: f.phone.value.trim(), contact: f.contact.value.trim(),
      markup: f.markup.value, login: f.login.value.trim().toLowerCase(), password: f.password.value, website: f.website.value
    };
    const keep = Object.assign({}, v, { password: '' });
    // Brauzerda oldindan tekshirish (server baribir qayta tekshiradi)
    if (v.name.length < 2) return drawRegister(t('acc_err_bad_name'), keep);
    if (v.phone.replace(/\D/g, '').length < 9) return drawRegister(t('acc_err_bad_phone'), keep);
    if (markupOf(v.markup) === null) return drawRegister(t('acc_err_bad_markup'), keep);
    if (!/^[a-z0-9._-]{3,32}$/.test(v.login)) return drawRegister(t('acc_err_bad_login'), keep);
    if (v.password.length < 8 || !/\d/.test(v.password) || !/[^\d\W_]/.test(v.password)) return drawRegister(t('acc_err_weak_password'), keep);
    f.querySelector('[type=submit]').disabled = true;
    try {
      const me = await sync().post('/api/agency/register', Object.assign({}, v, { markup: markupOf(v.markup) }));
      apply(me);
      changed(t('n_registered', { m: acc.agency.markup }));
      drawPlans();
    } catch (err) {
      const code = err.data && err.data.error;
      const msg = err.status === 429 ? t('acc_many') : err.status === 403 ? t('acc_err_closed')
        : code && t('acc_err_' + code) !== 'acc_err_' + code ? t('acc_err_' + code) : t('acc_offline');
      drawRegister(msg, keep);
    }
  }

  async function submitMarkup(f) {
    const m = markupOf(f.markup.value);
    if (m === null) { changed(t('acc_err_bad_markup')); return; }
    const btn = f.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      apply(await sync().post('/api/agency/markup', { markup: m }));
      changed(t('n_markup_saved', { m }));
    } catch (err) {
      if (err.status === 401) { apply(null); changed(); drawLogin(); return; }
      changed(t('acc_offline'));
    }
    btn.disabled = false;
  }

  global.TezAccount = {
    init,
    info: () => acc,
    canBook: () => !!(acc.agency && acc.agency.active),
    open: () => { if (!acc.available) return false; if (acc.loggedIn) drawPlans(); else drawLogin(); return true; },
    onChange: (fn) => listeners.push(fn),
    dateOf
  };
})(window);
