/*
 * TezBooking — admin panel (admin.html).
 *
 * Bo'limlar:  Umumiy | Tur firmalar | To'lovlar | Tariflar | Bronlar   (manzil: /admin#agencies va h.k.)
 *  - Tur firmalar: yangi firma (login + parol), parolni yangilash, bloklash, tarifni qo'lda berish
 *  - To'lovlar:    kutilayotgan to'lovlarni tasdiqlash yoki bekor qilish
 *  - Tariflar:     3 / 6 / 12 oylik narxlar
 *  - Bronlar:      barcha bronlar, qaysi firma qilgani, bekor qilish / tiklash, tarix, CSV
 * Server API'si: server/admin.js, server/accounts.js
 */
(function () {
  'use strict';

  const root = document.getElementById('admin');
  const PRODUCT = { tour: 'Tur', hotel: 'Mehmonxona', flight: 'Aviachipta' };
  const EVENT = { created: 'Bron qilindi', cancelled: 'Bekor qilindi', restored: 'Qayta tiklandi' };
  const BY = { admin: 'admin', site: 'sayt', import: 'brauzerdan ko\'chirildi' };
  const PROVIDER = { demo: 'Demo', manual: 'Qo\'lda (bank / naqd)', payme: 'Payme', click: 'Click' };
  const PAY_STATUS = { pending: ['wait', 'Kutilmoqda'], paid: ['ok', 'To\'langan'], cancelled: ['off', 'Bekor qilingan'] };
  const TABS = [['overview', 'Umumiy'], ['agencies', 'Tur firmalar'], ['payments', 'To\'lovlar'], ['tariffs', 'Tariflar'], ['bookings', 'Bronlar']];
  const ERR = {
    bad_login: 'Login 3–32 belgi bo\'lsin: lotin harflari, raqamlar, nuqta, chiziqcha.',
    login_taken: 'Bu login band. Boshqasini yozing.', bad_name: 'Firma nomini yozing.', bad_price: 'Narx noto\'g\'ri.',
    no_change: 'Holat allaqachon o\'zgargan. Sahifa yangilandi.', bad_tariff: 'Tarif topilmadi yoki o\'chirilgan.'
  };

  const state = {
    tab: 'overview', stats: null, bookings: [], agencies: [], payments: [], tariffs: [], today: '',
    bq: '', bstatus: 'active', bproduct: '', aq: '', afilter: 'all', pfilter: 'pending', busy: false
  };
  let es = null;

  // ---------- Yordamchilar ----------
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const group = (n) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const usd = (v) => (v == null ? '—' : '$' + group(v));
  const som = (v) => group(v || 0) + ' so\'m';
  const p2 = (n) => (n < 10 ? '0' : '') + n;
  const day = (iso) => (iso ? iso.slice(8, 10) + '.' + iso.slice(5, 7) + '.' + iso.slice(0, 4) : '—');
  const dateOf = (ms) => { if (!ms) return '—'; const d = new Date(ms); return p2(d.getDate()) + '.' + p2(d.getMonth() + 1) + '.' + d.getFullYear(); };
  const stamp = (ms) => { if (!ms) return '—'; const d = new Date(ms); return dateOf(ms) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()); };
  const range = (b) => (!b.from ? '—' : b.from === b.to ? day(b.from) : day(b.from) + ' – ' + day(b.to));
  const tariffName = (m) => (m === 12 ? '1 yillik' : m + ' oylik');
  const daysLeft = (ms) => Math.ceil((ms - Date.now()) / 86400000);

  async function api(path, body) {
    const opts = { cache: 'no-store', credentials: 'same-origin' };
    if (body !== undefined) Object.assign(opts, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const resp = await fetch('/api/admin' + path, opts);
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) { const err = new Error(data.error || 'http_' + resp.status); err.status = resp.status; err.code = data.error; throw err; }
    return data;
  }
  // Amal: xato bo'lsa tushunarli xabar, sessiya tugagan bo'lsa — kirish ekrani
  async function act(fn) {
    try { return await fn(); }
    catch (err) {
      if (err.status === 401) { showLogin('Sessiya tugadi, qayta kiring.'); return null; }
      toast(ERR[err.code] || 'Bajarib bo\'lmadi: ' + (err.code || err.message), true);
      if (err.code === 'no_change') load();
      return null;
    }
  }

  const logo = '<svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true"><rect x="1" y="1" width="30" height="30" rx="9" fill="var(--accent)"></rect><path d="M17.8 6.5 9.5 17.6h5.6l-1.6 7.9 8.9-11.6h-5.8z" fill="#0E1A2B"></path></svg>';
  const brand = `<div class="ad-brand">${logo}<span>Tez<span>Booking</span> <em>admin</em></span></div>`;

  // ---------- Kirish va xabar ekranlari ----------
  function screen(title, text, form) {
    if (es) { es.close(); es = null; }
    root.innerHTML = `
<main class="ad-center">
  <div class="card ad-login">
    ${brand}
    <h1 class="h2">${esc(title)}</h1>
    <p class="muted">${text}</p>
    ${form || ''}
  </div>
</main>`;
  }
  function showLogin(error) {
    screen('Admin panelga kirish', 'Parol <code>.env</code> faylidagi <code>ADMIN_PASSWORD</code> qatorida.', `
    <form class="ad-form" id="login" novalidate>
      <label class="label" for="pw">Parol</label>
      <input id="pw" class="input" type="password" autocomplete="current-password" required>
      <p class="ad-error" role="alert">${esc(error || '')}</p>
      <button class="btn btn-dark" type="submit">Kirish</button>
    </form>`);
    const form = document.getElementById('login'), pw = document.getElementById('pw');
    pw.focus();
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!pw.value) { showLogin('Parolni kiriting.'); return; }
      form.querySelector('button').disabled = true;
      try { await api('/login', { password: pw.value }); start(); }
      catch (err) { showLogin(err.status === 429 ? 'Juda ko\'p urinish. Bir daqiqadan keyin qayta urinib ko\'ring.' : err.status === 401 ? 'Parol noto\'g\'ri.' : 'Server bilan aloqa yo\'q.'); }
    });
  }

  // ---------- Panel skeleti ----------
  function shell() {
    root.innerHTML = `
<header class="topbar">
  <div class="container ad-top">
    ${brand}
    <span class="ad-live" id="live"><i></i><span>Ulanmoqda…</span></span>
    <div class="ad-top-right">
      <a class="btn btn-ghost btn-sm" href="/">Saytga o'tish</a>
      <button type="button" class="btn btn-ghost btn-sm" id="logout">Chiqish</button>
    </div>
  </div>
  <nav class="container ad-tabs" aria-label="Bo'limlar" id="tabs"></nav>
</header>
<div id="demo-banner"></div>
<main class="container ad-main" id="view"></main>
<dialog id="dlg" class="ad-dialog" aria-labelledby="dlg-title"><div id="dlg-body"></div></dialog>
<div class="ad-toast" id="toast" role="status" aria-live="polite"></div>`;

    document.getElementById('logout').addEventListener('click', async () => {
      try { await api('/logout', {}); } catch (e) { /* baribir chiqamiz */ }
      showLogin();
    });
    const dlg = document.getElementById('dlg');
    dlg.addEventListener('click', (e) => { if (e.target === dlg || e.target.closest('[data-close]')) dlg.close(); });
    // Barcha tugmalar: data-do="amal" data-id="..." (root'ga bir marta ulanadi — qayta kirilganda ikkilanmasin)
    if (!wired) {
      wired = true;
      root.addEventListener('click', onClick);
      root.addEventListener('input', onInput);
      root.addEventListener('change', onInput);
      root.addEventListener('submit', onSubmit);
      setInterval(() => { if (!document.hidden && document.getElementById('view') && !document.getElementById('dlg').open) load(); }, 30000);
    }
  }
  let wired = false;

  function drawTabs() {
    const pend = state.stats ? state.stats.pendingPayments : 0;
    document.getElementById('tabs').innerHTML = TABS.map(([id, label]) =>
      `<a href="#${id}" ${state.tab === id ? 'aria-current="page"' : ''}>${esc(label)}${id === 'payments' && pend ? ` <span class="count">${pend}</span>` : ''}</a>`).join('');
    document.getElementById('demo-banner').innerHTML = state.stats && state.stats.paymentMode === 'demo'
      ? `<div class="ad-banner container">Demo to'lov rejimi yoqilgan: tur firmalar tarifni <b>pulsiz</b> faollashtira oladi. Haqiqiy ishga tushirishdan oldin <code>.env</code> da <code>PAYMENT_MODE=manual</code> qiling.</div>` : '';
  }

  function draw() {
    drawTabs();
    const v = document.getElementById('view');
    const keepFocus = document.activeElement && document.activeElement.id;
    const caret = keepFocus && document.activeElement.selectionStart;
    v.innerHTML = { overview: viewOverview, agencies: viewAgencies, payments: viewPayments, tariffs: viewTariffs, bookings: viewBookings }[state.tab]();
    // Qidiruv maydonida yozish davom etsin
    if (keepFocus) {
      const el = document.getElementById(keepFocus);
      if (el && el.matches('input[type=search]')) { el.focus(); try { el.setSelectionRange(caret, caret); } catch (e) { /* yo'q */ } }
    }
  }

  // ---------- Umumiy ----------
  function tiles(list) {
    return `<div class="ad-stats">${list.map(([label, value, sub, link]) => `
      <${link ? `a href="#${link}"` : 'div'} class="card ad-tile${link ? ' ad-tile-link' : ''}"><span class="label">${esc(label)}</span><strong>${esc(value)}</strong>${sub ? `<span class="hint">${esc(sub)}</span>` : ''}</${link ? 'a' : 'div'}>`).join('')}</div>`;
  }
  function viewOverview() {
    const s = state.stats; if (!s) return '<p class="muted">Yuklanmoqda…</p>';
    const products = Object.keys(PRODUCT).map(p => {
      const v = s.byProduct[p] || { n: 0, sum: 0 };
      return `<span class="ad-chip ad-p-${p}"><b>${esc(PRODUCT[p])}</b> ${v.n} ta · ${esc(usd(v.sum))}</span>`;
    }).join('');
    const expiring = state.agencies.filter(a => a.active && daysLeft(a.paidUntil) <= 14);
    return `
<section aria-labelledby="h-ov1">
  <h1 id="h-ov1" class="h2">Tur firmalar va tushum</h1>
  ${tiles([
    ['Tur firmalar', s.agencies, 'jami ro\'yxatdan o\'tgan', 'agencies'],
    ['To\'lagan firmalar', s.paidAgencies, 'tarifi hozir faol', 'agencies'],
    ['Kutilayotgan to\'lovlar', s.pendingPayments, s.pendingPayments ? 'tasdiqlash kerak' : 'hammasi ko\'rib chiqilgan', 'payments'],
    ['Shu oy tushum', som(s.revenueMonth), 'tasdiqlangan to\'lovlar'],
    ['Jami tushum', som(s.revenueTotal), '']
  ])}
  ${expiring.length ? `<div class="card ad-notice"><b>Tarifi 14 kun ichida tugaydi:</b> ${expiring.map(a => `${esc(a.name)} (${dateOf(a.paidUntil)})`).join(', ')}</div>` : ''}
</section>
<section aria-labelledby="h-ov2">
  <h2 id="h-ov2" class="h2">Bronlar</h2>
  ${tiles([
    ['Faol bronlar', s.byStatus.confirmed || 0, '', 'bookings'],
    ['Hozir safarda', s.inTrip, 'bugun band kunlari ichida'],
    ['Kelgusi', s.upcoming, 'safari hali boshlanmagan'],
    ['Shu oy yangi', s.thisMonth, 'bekor qilinganlari bilan'],
    ['Faol bronlar summasi', usd(s.activeSum), 'netto narx'],
    ['Bekor qilingan', s.byStatus.cancelled || 0, '']
  ])}
  <div class="ad-products">${products}</div>
</section>`;
  }

  // ---------- Tur firmalar ----------
  function agencyState(a) {
    if (a.status === 'blocked') return ['off', 'Bloklangan'];
    if (a.active) {
      const d = daysLeft(a.paidUntil);
      return [d <= 14 ? 'wait' : 'ok', dateOf(a.paidUntil) + ' gacha' + (d <= 14 ? ' (' + d + ' kun)' : '')];
    }
    return a.paidUntil ? ['past', 'Muddati tugagan'] : ['past', 'Tarif olinmagan'];
  }
  function viewAgencies() {
    const q = state.aq.trim().toLowerCase();
    const list = state.agencies.filter(a =>
      (state.afilter === 'all' || (state.afilter === 'paid' && a.active) || (state.afilter === 'unpaid' && !a.active && a.status === 'active') || (state.afilter === 'blocked' && a.status === 'blocked')) &&
      (!q || (a.name + ' ' + a.login + ' ' + a.phone + ' ' + a.contact).toLowerCase().indexOf(q) >= 0));
    const seg = [['all', 'Hammasi'], ['paid', 'To\'lagan'], ['unpaid', 'To\'lamagan'], ['blocked', 'Bloklangan']];
    const tariffOpts = state.tariffs.filter(t => t.active).map(t => `<option value="${t.id}">${esc(tariffName(t.months))} — ${esc(som(t.price))}</option>`).join('');
    return `
<section class="card ad-table-card" aria-labelledby="h-new">
  <h1 id="h-new" class="h2">Yangi tur firma</h1>
  <p class="hint">Login va parolni firmaga bering — u saytga shu bilan kiradi. Parolni bo'sh qoldirsangiz, avtomatik yaratiladi.</p>
  <form class="ad-grid-form" id="f-agency" autocomplete="off">
    <label><span class="label">Firma nomi *</span><input class="input input-sm" name="name" required maxlength="120"></label>
    <label><span class="label">Login *</span><input class="input input-sm" name="login" required pattern="[A-Za-z0-9._\\-]{3,32}" maxlength="32" placeholder="masalan: sayyoh"></label>
    <label><span class="label">Telefon</span><input class="input input-sm" name="phone" maxlength="40" placeholder="+998 90 123 45 67"></label>
    <label><span class="label">Mas'ul shaxs</span><input class="input input-sm" name="contact" maxlength="120"></label>
    <label><span class="label">Parol</span><input class="input input-sm" name="password" minlength="8" maxlength="64" placeholder="avtomatik"></label>
    <button class="btn btn-dark" type="submit">Qo'shish</button>
  </form>
</section>
<section class="card ad-table-card" aria-labelledby="h-ag">
  <div class="ad-toolbar">
    <h2 id="h-ag" class="h2">Tur firmalar <span class="count">${list.length}</span></h2>
    <input id="aq" class="input input-sm ad-search" type="search" placeholder="Qidirish: nomi, login, telefon…" value="${esc(state.aq)}" aria-label="Firmalarni qidirish">
    <div class="seg" role="group" aria-label="Holat">${seg.map(([v, l]) => `<button type="button" data-do="afilter" data-id="${v}" aria-pressed="${state.afilter === v}">${l}</button>`).join('')}</div>
  </div>
  ${!list.length ? `<p class="ad-empty muted">${state.agencies.length ? 'Filtrga mos firma topilmadi.' : 'Hali tur firmalar yo\'q. Yuqoridagi forma orqali qo\'shing.'}</p>` : `
  <div class="ad-scroll"><table class="ad-table">
    <thead><tr><th>Firma</th><th>Login</th><th>Tarif</th><th class="num">Bronlar</th><th class="num">To'lagan</th><th>Oxirgi kirish</th><th><span class="sr-only">Amallar</span></th></tr></thead>
    <tbody>${list.map(a => {
      const st = agencyState(a);
      return `
      <tr class="${a.status === 'blocked' ? 'is-off' : ''}">
        <td data-th="Firma"><b>${esc(a.name)}</b><span class="hint ad-sub">${esc([a.contact, a.phone].filter(Boolean).join(' · ') || '—')}</span></td>
        <td data-th="Login"><code>${esc(a.login)}</code></td>
        <td data-th="Tarif"><span class="ad-status ad-s-${st[0]}">${esc(st[1])}</span>${a.pending ? `<a class="hint ad-sub" href="#payments">${a.pending} ta to'lov kutilmoqda</a>` : ''}</td>
        <td data-th="Bronlar" class="num">${a.bookings}</td>
        <td data-th="To'lagan" class="num nowrap">${esc(som(a.paidTotal))}</td>
        <td data-th="Oxirgi kirish" class="nowrap">${esc(stamp(a.lastLogin))}</td>
        <td class="ad-actions">
          <form class="ad-inline" data-form="extend" data-id="${a.id}">
            <select class="input input-sm" name="tariff" aria-label="Tarif">${tariffOpts}</select>
            <button class="btn btn-sm" type="submit">Tarif berish</button>
          </form>
          <button type="button" class="btn btn-sm" data-do="editAgency" data-id="${a.id}">Tahrirlash</button>
          <button type="button" class="btn btn-sm" data-do="resetPw" data-id="${a.id}">Yangi parol</button>
          ${a.status === 'blocked'
            ? `<button type="button" class="btn btn-sm" data-do="unblock" data-id="${a.id}">Faollashtirish</button>`
            : `<button type="button" class="btn btn-sm ad-danger" data-do="block" data-id="${a.id}">Bloklash</button>`}
        </td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>`}
</section>`;
  }

  // ---------- To'lovlar ----------
  function viewPayments() {
    const list = state.payments.filter(p => state.pfilter === 'all' || p.status === state.pfilter);
    const seg = [['pending', 'Kutilmoqda'], ['paid', 'To\'langan'], ['cancelled', 'Bekor qilingan'], ['all', 'Hammasi']];
    return `
<section class="card ad-table-card" aria-labelledby="h-pay">
  <div class="ad-toolbar">
    <h1 id="h-pay" class="h2">To'lovlar <span class="count">${list.length}</span></h1>
    <div class="seg" role="group" aria-label="Holat">${seg.map(([v, l]) => `<button type="button" data-do="pfilter" data-id="${v}" aria-pressed="${state.pfilter === v}">${l}</button>`).join('')}</div>
  </div>
  ${state.stats && state.stats.paymentMode !== 'demo' ? '<p class="hint ad-hint">Firma saytda tarifni tanlaganda shu yerda "Kutilmoqda" bo\'lib chiqadi. Pul hisobingizga tushganini tekshirib, "Tasdiqlash"ni bosing — tarif darhol faollashadi.</p>' : ''}
  ${!list.length ? '<p class="ad-empty muted">Bu ro\'yxatda to\'lov yo\'q.</p>' : `
  <div class="ad-scroll"><table class="ad-table">
    <thead><tr><th>Sana</th><th>Firma</th><th>Tarif</th><th class="num">Summa</th><th>Usul</th><th>Holat</th><th>Davr</th><th><span class="sr-only">Amallar</span></th></tr></thead>
    <tbody>${list.map(p => {
      const st = PAY_STATUS[p.status] || ['past', p.status];
      return `
      <tr class="${p.status === 'cancelled' ? 'is-off' : ''}">
        <td data-th="Sana" class="nowrap">${esc(stamp(p.at))}</td>
        <td data-th="Firma"><b>${esc(p.agency)}</b><span class="hint ad-sub">${esc(p.login)}</span></td>
        <td data-th="Tarif">${esc(tariffName(p.months))}</td>
        <td data-th="Summa" class="num nowrap">${esc(som(p.amount))}</td>
        <td data-th="Usul">${esc(PROVIDER[p.provider] || p.provider)}${p.note === 'admin' ? '<span class="hint ad-sub">admin bergan</span>' : ''}</td>
        <td data-th="Holat"><span class="ad-status ad-s-${st[0]}">${esc(st[1])}</span></td>
        <td data-th="Davr" class="nowrap">${p.from ? esc(dateOf(p.from) + ' – ' + dateOf(p.to)) : '—'}</td>
        <td class="ad-actions">${p.status === 'pending' ? `
          <button type="button" class="btn btn-sm btn-dark" data-do="confirmPay" data-id="${p.id}">Tasdiqlash</button>
          <button type="button" class="btn btn-sm ad-danger" data-do="cancelPay" data-id="${p.id}">Bekor qilish</button>` : ''}
        </td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>`}
</section>`;
  }

  // ---------- Tariflar ----------
  function viewTariffs() {
    return `
<section aria-labelledby="h-tar">
  <h1 id="h-tar" class="h2">Tariflar</h1>
  <p class="hint ad-hint">Narxlar so'mda. Tur firmalar saytda shu tariflarni ko'radi. O'chirilgan tarif saytda ko'rinmaydi.</p>
  <div class="ad-tariffs">${state.tariffs.map(t => `
    <form class="card ad-tariff" data-form="tariff" data-id="${t.id}">
      <h2 class="h2">${esc(tariffName(t.months))}</h2>
      <label><span class="label">Narx (so'm)</span><input class="input" name="price" type="number" min="0" step="1000" value="${t.price}" required></label>
      <span class="hint">oyiga ${esc(som(t.price / t.months))}</span>
      <label class="check"><input type="checkbox" name="active"${t.active ? ' checked' : ''}><span>Saytda ko'rinadi</span></label>
      <button class="btn btn-dark" type="submit">Saqlash</button>
    </form>`).join('')}
  </div>
</section>`;
  }

  // ---------- Bronlar ----------
  function filteredBookings() {
    const q = state.bq.trim().toLowerCase();
    return state.bookings.filter(b =>
      (state.bstatus === 'all' || (state.bstatus === 'cancelled') === (b.status === 'cancelled')) &&
      (!state.bproduct || b.product === state.bproduct) &&
      (!q || (b.title + ' ' + b.op + ' ' + b.key + ' ' + (b.agency || '') + ' ' + (b.ref || '')).toLowerCase().indexOf(q) >= 0));
  }
  function viewBookings() {
    const list = filteredBookings();
    const seg = [['active', 'Faol'], ['cancelled', 'Bekor qilingan'], ['all', 'Hammasi']];
    return `
<section class="card ad-table-card" aria-labelledby="h-bookings">
  <div class="ad-toolbar">
    <h1 id="h-bookings" class="h2">Bronlar <span class="count">${list.length}</span></h1>
    <input id="bq" class="input input-sm ad-search" type="search" placeholder="Qidirish: nomi, firma, operator…" value="${esc(state.bq)}" aria-label="Bronlarni qidirish">
    <div class="seg" role="group" aria-label="Holat">${seg.map(([v, l]) => `<button type="button" data-do="bstatus" data-id="${v}" aria-pressed="${state.bstatus === v}">${l}</button>`).join('')}</div>
    <select id="bproduct" class="input input-sm ad-select" aria-label="Turi">
      <option value="">Barcha turlar</option>
      ${Object.keys(PRODUCT).map(p => `<option value="${p}"${state.bproduct === p ? ' selected' : ''}>${PRODUCT[p]}</option>`).join('')}
    </select>
    <button type="button" class="btn btn-sm" data-do="csv">CSV yuklab olish</button>
  </div>
  ${!list.length ? `<p class="ad-empty muted">${state.bookings.length ? 'Filtrga mos bron topilmadi.' : 'Hali bronlar yo\'q. Saytda bron qilinganda shu yerda ko\'rinadi.'}</p>` : `
  <div class="ad-scroll"><table class="ad-table">
    <thead><tr><th>Yaratilgan</th><th>Firma</th><th>Turi</th><th>Nomi</th><th>Band kunlar</th><th class="num">Narx</th><th>Holat</th><th><span class="sr-only">Amallar</span></th></tr></thead>
    <tbody>${list.map(b => {
      const off = b.status === 'cancelled';
      const now = !off && b.from && b.from <= state.today && b.to >= state.today;
      const past = !off && b.to && b.to < state.today;
      const st = off ? ['off', 'Bekor qilingan'] : now ? ['wait', 'Safarda'] : past ? ['past', 'Yakunlangan'] : ['ok', 'Tasdiqlangan'];
      return `
      <tr class="${off ? 'is-off' : ''}">
        <td data-th="Yaratilgan" class="nowrap">${esc(stamp(b.at))}</td>
        <td data-th="Firma">${esc(b.agency || '—')}</td>
        <td data-th="Turi"><span class="ad-chip ad-p-${esc(b.product)}">${esc(PRODUCT[b.product] || b.product)}</span></td>
        <td data-th="Nomi"><b>${esc(b.title)}</b><span class="hint ad-sub">${esc(b.op)}</span></td>
        <td data-th="Band kunlar" class="nowrap">${esc(range(b))}</td>
        <td data-th="Narx" class="num">${esc(usd(b.price))}</td>
        <td data-th="Holat"><span class="ad-status ad-s-${st[0]}">${esc(st[1])}</span></td>
        <td class="ad-actions">
          <button type="button" class="btn btn-sm" data-do="history" data-id="${esc(b.key)}">Tarix (${b.events})</button>
          ${off
            ? `<button type="button" class="btn btn-sm" data-do="restore" data-id="${esc(b.key)}">Tiklash</button>`
            : `<button type="button" class="btn btn-sm ad-danger" data-do="cancelBooking" data-id="${esc(b.key)}">Bekor qilish</button>`}
        </td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>`}
</section>`;
  }

  // ---------- Oyna va xabar ----------
  function dialog(html) {
    const dlg = document.getElementById('dlg');
    document.getElementById('dlg-body').innerHTML = html;
    if (!dlg.open) dlg.showModal();
    return dlg;
  }
  let toastTimer = 0;
  function toast(text, bad) {
    const el = document.getElementById('toast'); if (!el) return;
    el.textContent = text;
    el.className = 'ad-toast show' + (bad ? ' bad' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = 'ad-toast'; }, 4000);
  }
  // Login va parolni bir marta ko'rsatish (keyin tiklab bo'lmaydi — faqat yangisini yaratish mumkin)
  function showCredentials(title, a, password) {
    const text = 'TezBooking\nSayt: ' + location.origin + '/\nLogin: ' + a.login + '\nParol: ' + password;
    dialog(`
      <h2 id="dlg-title" class="h2">${esc(title)}</h2>
      <p class="muted">${esc(a.name)} uchun kirish ma'lumotlari. <b>Parol faqat hozir ko'rinadi</b> — nusxa olib, firmaga yuboring.</p>
      <dl class="ad-cred"><dt>Login</dt><dd><code>${esc(a.login)}</code></dd><dt>Parol</dt><dd><code>${esc(password)}</code></dd></dl>
      <div class="btn-row"><button type="button" class="btn btn-dark" id="copy-cred">Nusxa olish</button><button type="button" class="btn" data-close>Yopish</button></div>`);
    document.getElementById('copy-cred').addEventListener('click', (e) => {
      const done = () => { e.target.textContent = 'Nusxa olindi ✓'; };
      if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, () => toast('Nusxa olib bo\'lmadi — qo\'lda ko\'chiring.', true));
    });
  }

  async function showHistory(b) {
    dialog(`<h2 id="dlg-title" class="h2">Bron tarixi</h2><p class="muted">${esc(b.title)} · ${esc(range(b))}</p><p class="muted">Yuklanmoqda…</p>`);
    const r = await act(() => api('/history?key=' + encodeURIComponent(b.key)));
    if (!r) return;
    dialog(`
      <div class="row-between"><h2 id="dlg-title" class="h2">Bron tarixi</h2><button type="button" class="btn btn-sm" data-close>Yopish</button></div>
      <p class="muted">${esc(b.title)} · ${esc(b.op)} · ${esc(range(b))}${b.agency ? ' · ' + esc(b.agency) : ''}</p>
      <ol class="ad-events">${r.events.map(ev => {
        const extra = ev.payload ? [ev.payload.agency, BY[ev.payload.by] || ev.payload.by, BY[ev.payload.source] || ev.payload.source].filter(Boolean).join(' · ') : '';
        return `<li><b>${esc(EVENT[ev.type] || ev.type)}</b> <span class="muted">${esc(stamp(ev.at))}</span>${extra ? `<span class="hint"> · ${esc(extra)}</span>` : ''}</li>`;
      }).join('')}</ol>
      <p class="hint ad-key">Kalit: ${esc(b.key)}</p>`);
  }

  function editAgency(a) {
    dialog(`
      <h2 id="dlg-title" class="h2">Firmani tahrirlash</h2>
      <form class="ad-form" data-form="editAgency" data-id="${a.id}">
        <label><span class="label">Firma nomi</span><input class="input" name="name" value="${esc(a.name)}" required maxlength="120"></label>
        <label><span class="label">Telefon</span><input class="input" name="phone" value="${esc(a.phone)}" maxlength="40"></label>
        <label><span class="label">Mas'ul shaxs</span><input class="input" name="contact" value="${esc(a.contact)}" maxlength="120"></label>
        <p class="hint">Login: <code>${esc(a.login)}</code> (o'zgarmaydi)</p>
        <div class="btn-row"><button class="btn btn-dark" type="submit">Saqlash</button><button type="button" class="btn" data-close>Bekor</button></div>
      </form>`);
  }

  function exportCsv() {
    const cell = (v) => { const s = String(v == null ? '' : v); return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const rows = [['Yaratilgan', 'Firma', 'Turi', 'Nomi', 'Operator', 'Boshlanish', 'Tugash', 'Narx (USD)', 'Holat', 'Kalit']]
      .concat(filteredBookings().map(b => [stamp(b.at), b.agency || '', PRODUCT[b.product] || b.product, b.title, b.op, b.from || '', b.to || '', b.price == null ? '' : b.price, b.status, b.key]));
    const blob = new Blob(['﻿' + rows.map(r => r.map(cell).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'tezbooking-bronlar-' + state.today + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------- Hodisalar ----------
  async function onClick(e) {
    const btn = e.target.closest('[data-do]'); if (!btn || btn.disabled) return;
    const id = btn.dataset.id, what = btn.dataset.do;
    const agency = state.agencies.find(a => a.id === id);
    const booking = state.bookings.find(b => b.key === id);
    if (what === 'afilter') { state.afilter = id; return draw(); }
    if (what === 'pfilter') { state.pfilter = id; return draw(); }
    if (what === 'bstatus') { state.bstatus = id; return draw(); }
    if (what === 'csv') return exportCsv();
    if (what === 'history' && booking) return showHistory(booking);
    if (what === 'editAgency' && agency) return editAgency(agency);

    let r = null;
    btn.disabled = true;
    if (what === 'resetPw' && agency) {
      if (!confirm(agency.name + ' uchun yangi parol yaratilsinmi?\nEski parol ishlamay qoladi va firma saytdan chiqariladi.')) { btn.disabled = false; return; }
      r = await act(() => api('/agencies/reset', { id }));
      if (r) showCredentials('Yangi parol', agency, r.password);
    }
    if (what === 'block' && agency) {
      if (!confirm(agency.name + ' bloklansinmi?\nFirma saytga kira olmaydi va bron qila olmaydi.')) { btn.disabled = false; return; }
      r = await act(() => api('/agencies/status', { id, status: 'blocked' }));
      if (r) toast(agency.name + ' bloklandi.');
    }
    if (what === 'unblock' && agency) {
      r = await act(() => api('/agencies/status', { id, status: 'active' }));
      if (r) toast(agency.name + ' faollashtirildi.');
    }
    if (what === 'confirmPay') {
      const p = state.payments.find(x => x.id === id);
      if (!confirm('To\'lov tasdiqlansinmi?\n' + (p ? p.agency + ' · ' + tariffName(p.months) + ' · ' + som(p.amount) : '') + '\nPul hisobingizga tushganini tekshirdingizmi?')) { btn.disabled = false; return; }
      r = await act(() => api('/payments/confirm', { id }));
      if (r) toast('To\'lov tasdiqlandi. Tarif ' + dateOf(r.to) + ' gacha faol.');
    }
    if (what === 'cancelPay') {
      if (!confirm('To\'lov so\'rovi bekor qilinsinmi?')) { btn.disabled = false; return; }
      r = await act(() => api('/payments/cancel', { id }));
      if (r) toast('To\'lov so\'rovi bekor qilindi.');
    }
    if (what === 'cancelBooking' && booking) {
      if (!confirm('"' + booking.title + '" bronini bekor qilasizmi?\nSaytda bu taklif yana bron qilish uchun ochiladi.')) { btn.disabled = false; return; }
      r = await act(() => api('/cancel', { key: id }));
    }
    if (what === 'restore' && booking) r = await act(() => api('/restore', { key: id }));
    btn.disabled = false;
    if (r) load();
  }

  function onInput(e) {
    const el = e.target;
    if (el.id === 'aq') { state.aq = el.value; draw(); }
    if (el.id === 'bq') { state.bq = el.value; draw(); }
    if (el.id === 'bproduct' && e.type === 'change') { state.bproduct = el.value; draw(); }
  }

  async function onSubmit(e) {
    const form = e.target;
    const kind = form.id === 'f-agency' ? 'agency' : form.dataset.form;
    if (!kind) return;
    e.preventDefault();
    if (!form.reportValidity()) return;
    const data = Object.fromEntries(new FormData(form));
    const submit = form.querySelector('[type=submit]');
    if (submit) submit.disabled = true;
    let r = null;
    if (kind === 'agency') {
      r = await act(() => api('/agencies', data));
      if (r) { form.reset(); showCredentials('Tur firma qo\'shildi', r.agency, r.password); }
    }
    if (kind === 'extend') {
      const a = state.agencies.find(x => x.id === form.dataset.id);
      const t = state.tariffs.find(x => x.id === data.tariff);
      if (a && t && confirm(a.name + ' uchun ' + tariffName(t.months) + ' tarif berilsinmi?\nTo\'lov "qo\'lda" (naqd / bank) deb yoziladi: ' + som(t.price) + '.')) {
        r = await act(() => api('/agencies/extend', { id: a.id, tariff: t.id }));
        if (r) toast(a.name + ': tarif ' + dateOf(r.to) + ' gacha faol.');
      }
    }
    if (kind === 'editAgency') {
      r = await act(() => api('/agencies/update', Object.assign({ id: form.dataset.id }, data)));
      if (r) { document.getElementById('dlg').close(); toast('Saqlandi.'); }
    }
    if (kind === 'tariff') {
      r = await act(() => api('/tariffs', { id: form.dataset.id, price: Number(data.price), active: !!data.active }));
      if (r) toast(tariffName(r.months) + ' tarif saqlandi.');
    }
    if (submit) submit.disabled = false;
    if (r) load();
  }

  // ---------- Ma'lumotlarni yuklash ----------
  async function load() {
    try {
      const [stats, list, ag, pay, tar] = await Promise.all([api('/stats'), api('/bookings'), api('/agencies'), api('/payments'), api('/tariffs')]);
      state.stats = stats; state.bookings = list.bookings; state.today = list.today;
      state.agencies = ag.agencies; state.payments = pay.payments; state.tariffs = tar.tariffs;
      draw();
    } catch (err) {
      if (err.status === 401) showLogin('Sessiya tugadi, qayta kiring.');
    }
  }
  function setLive(on) {
    const el = document.getElementById('live'); if (!el) return;
    el.classList.toggle('on', on);
    el.lastElementChild.textContent = on ? 'Jonli' : 'Ulanmoqda…';
  }
  function route() {
    const h = location.hash.slice(1);
    state.tab = TABS.some(t => t[0] === h) ? h : 'overview';
    if (document.getElementById('view')) draw();
  }
  window.addEventListener('hashchange', route);

  async function start() {
    route();
    shell();
    draw();
    await load();
    if (es) es.close();
    let timer = 0;
    es = new EventSource('/api/events');
    es.addEventListener('hello', () => { setLive(true); load(); });
    es.addEventListener('bookings', () => { clearTimeout(timer); timer = setTimeout(load, 150); });
    es.addEventListener('error', () => setLive(false));
  }

  // ---------- Boshlash ----------
  (async function init() {
    if (!/^https?:$/.test(location.protocol)) {
      screen('Server kerak', 'Admin panel faqat server orqali ishlaydi. Terminalda <code>npm start</code> ni ishga tushiring va <b>http://localhost:3000/admin</b> ni oching.');
      return;
    }
    try {
      const me = await api('/me');
      if (me.authed) start(); else showLogin();
    } catch (err) {
      if (err.status === 503) screen('Admin panel o\'chiq', '<code>.env</code> fayliga <code>ADMIN_PASSWORD=...</code> qatorini yozing va serverni qayta ishga tushiring.');
      else screen('Server bilan aloqa yo\'q', 'Server ishlayotganini tekshiring (<code>npm start</code>) va sahifani yangilang.');
    }
  })();
})();
