/*
 * TezBooking — admin panel (admin.html).
 *
 * Bo'limlar:  Umumiy | Tur firmalar | To'lovlar | Tariflar | Bronlar | Agentlar   (manzil: /admin#agencies va h.k.)
 *  - Agentlar:     Main Agent'ga topshiriq (oddiy matn yoki aniq parametrlar), vazifalar va natijalar, to'xtatish,
 *                  operatorlarni yoqish/o'chirish, navbat sozlamalari, ogohlantirishlar, ishchilar jurnali (/api/admin/agents)
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
  const TABS = [['overview', 'Umumiy'], ['agencies', 'Tur firmalar'], ['payments', 'To\'lovlar'], ['tariffs', 'Tariflar'], ['bookings', 'Bronlar'], ['agents', 'Agentlar'], ['security', 'Xavfsizlik']];
  const ERR = {
    bad_login: 'Login 3–32 belgi bo\'lsin: lotin harflari, raqamlar, nuqta, chiziqcha.',
    login_taken: 'Bu login band. Boshqasini yozing.', bad_name: 'Firma nomini yozing.', bad_price: 'Narx noto\'g\'ri.',
    no_change: 'Holat allaqachon o\'zgargan. Sahifa yangilandi.', bad_tariff: 'Tarif topilmadi yoki o\'chirilgan.',
    bad_markup: 'Ustama foizi 0 dan 50 gacha bo\'lsin.', bad_request: 'Ma\'lumot noto\'g\'ri.', bad_ip: 'IP manzil noto\'g\'ri.',
    self_ban: 'O\'zingizning IP manzilingizni bloklab bo\'lmaydi.', exempt_ip: 'Bu IP ruxsat etilganlar ro\'yxatida (SHIELD_ALLOW_IPS yoki lokal).',
    // Agentlar
    bad_search_parameters: 'Qidiruv ma\'lumotlarini tekshiring: davlat, sana, kechalar, kishilar.',
    bad_command: 'Topshiriq matnini yozing.', bad_settings: 'Sozlamalar noto\'g\'ri (ruxsat etilgan oraliqdan tashqarida).',
    bad_website: 'Operator ma\'lumotlari noto\'g\'ri (faqat HTTPS manzil).', invalid_task_transition: 'Bu vazifani endi bekor qilib bo\'lmaydi.',
    idempotency_conflict: 'Bu topshiriq allaqachon yuborilgan.', origin_rejected: 'So\'rov rad etildi (boshqa manzildan).',
    llm_key_missing: 'AI tahlilchi uchun serverda API kaliti yo\'q.', llm_provider_error: 'AI tahlilchi javob bermadi.', llm_timeout: 'AI tahlilchi javobi kechikdi.'
  };
  // Agent vazifasi, operator integratsiyasi va ishchi holatlari: [rang klassi, matn]
  const TASK_ST = {
    queued: ['wait', 'Navbatda'], running: ['wait', 'Bajarilmoqda'], completed: ['ok', 'Yakunlandi'], partial: ['wait', 'Qisman bajarildi'],
    failed: ['off', 'Xato'], cancelled: ['past', 'Bekor qilingan'], blocked: ['past', 'Mos operator yo\'q']
  };
  const INT_ST = { verified: ['ok', 'Tasdiqlangan'], pending: ['past', 'Ulanmagan'], failed: ['off', 'Xato'] };
  const WORK_ST = { pending: ['past', 'O\'rnatilmagan'], idle: ['ok', 'Tayyor'], running: ['wait', 'Ishlamoqda'], paused: ['past', 'Pauza'], failed: ['off', 'Xato'] };
  const ASK = {
    destination: 'Qaysi shahar yoki kurort?', country: 'Qaysi davlat?', date: 'Uchish sanasi qachon? (masalan: 15-dekabr yoki 2026-12-15)',
    adults: 'Necha katta kishi?', nights: 'Necha kecha?', childrenAges: 'Bolalar yoshi necha?',
    departureAirport: 'Qayerdan uchiladi? (Toshkent, Samarqand, Buxoro, Urganch, Namangan, Farg\'ona, Andijon, Termiz, Navoiy, Qarshi, Nukus, Dushanbe)', budget: 'Byudjet qancha?', currency: 'Qaysi valyutada?',
    mealPlan: 'Ovqatlanish turi (BB, HB, AI...)?', hotelStars: 'Mehmonxona necha yulduzli?'
  };
  const COUNTRY_OPTS = [['tr', 'Turkiya'], ['ae', 'BAA'], ['eg', 'Misr'], ['ge', 'Gruziya'], ['az', 'Ozarbayjon'], ['th', 'Tailand'],
    ['vn', 'Vyetnam'], ['my', 'Malayziya'], ['lk', 'Shri-Lanka'], ['mv', 'Maldiv'], ['id', 'Indoneziya']];
  // Uchish shaharlari (server/live/validation.js FROM_IDS bilan bir xil)
  const FROM_OPTS = [['tas', 'Toshkent'], ['skd', 'Samarqand'], ['bhk', 'Buxoro'], ['ugc', 'Urganch'], ['nma', 'Namangan'], ['feg', 'Farg\'ona'],
    ['azn', 'Andijon'], ['tmj', 'Termiz'], ['nvi', 'Navoiy'], ['ksq', 'Qarshi'], ['ncu', 'Nukus'], ['dyu', 'Dushanbe']];
  // Ishchilar jurnali: jonli ishchi (server/owner/live-workers.js) hodisalari
  const LOG_EV = {
    adapter_search_done: 'Operatordan qidirildi', adapter_search_cached: 'Qidirildi (keshdan, 10 daqiqa ichida)',
    adapter_no_seats: 'Turlar bor, lekin joy yo\'q (mehmonxona yoki reys)', adapter_destination_no_match: 'Bu kurortga tur yo\'q',
    adapter_no_match_filters: 'Filtrlarga (ovqat, yulduz, byudjet) mos tur yo\'q', adapter_no_offers_no_country: 'Operator bu davlatga sotmaydi',
    adapter_no_offers_no_departure: 'Operatorda bu shahardan uchish yo\'q', adapter_no_offers_empty: 'Bu sana va kechalarga tur yo\'q',
    adapter_no_offers_closed: 'Operator qidiruvi vaqtincha yopiq', retry_scheduled: 'Xato — qayta urinish navbatda'
  };
  const AVAIL = { available: ['ok', 'Joy bor'], on_request: ['wait', 'So\'rov bo\'yicha'], sold_out: ['off', 'Sotuvda yo\'q'], unknown: ['past', 'Noma\'lum'] };
  const MEAL_UZ = { RO: 'Ovqatsiz', BB: 'Nonushta', HB: 'Yarim pansion', FB: 'To\'liq pansion', AI: 'Hammasi kiritilgan', UAI: 'Ultra hammasi kiritilgan' };

  const state = {
    tab: 'overview', stats: null, bookings: [], agencies: [], payments: [], tariffs: [], today: '',
    bq: '', bstatus: 'active', bproduct: '', aq: '', afilter: 'all', pfilter: 'pending', busy: false,
    ag: { data: null, error: '', draft: '', clarify: null, oq: '' },  // Agentlar bo'limi
    sec: null                                                       // Xavfsizlik bo'limi
  };
  let es = null, agEs = null;
  let siteUrl = '/';                 // sayt manzili (admin alohida portda bo'lsa — http://localhost:3000)

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
  // Agentlar API'si (server/owner/index.js): admin sessiyasi bilan, GET / POST / PATCH
  async function agentApi(path, method, body, headers) {
    const opts = { cache: 'no-store', credentials: 'same-origin', method: method || 'GET', headers: Object.assign({}, headers || {}) };
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const resp = await fetch('/api/admin/agents' + path, opts);
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) { const err = new Error(data.error || 'http_' + resp.status); err.status = resp.status; err.code = data.error; throw err; }
    return data;
  }
  const uid = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID()
    : Date.now().toString(16) + '-' + Math.random().toString(16).slice(2) + '-' + Math.random().toString(16).slice(2));
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

  const logo = '<img class="logo-brand" src="images/logo-horizontal.png?v=20261120a" width="136" height="34" alt="TezBooking">';
  const brand = `<div class="ad-brand">${logo}<em>admin</em></div>`;

  // ---------- Kirish va xabar ekranlari ----------
  function screen(title, text, form) {
    if (es) { es.close(); es = null; }
    if (agEs) { agEs.close(); agEs = null; }
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
    // Onlayn demo (GitHub Pages, ?demo): server yo'q, .env ham yo'q — demo parolini ko'rsatamiz
    const demoPw = window.TezDemo && window.TezDemoSeed && window.TezDemoSeed.LOGINS && window.TezDemoSeed.LOGINS.admin;
    const hint = demoPw
      ? 'Bu demo versiya. Demo paroli: <code>' + esc(demoPw) + '</code> (haqiqiy serverdagi parol bu yerda ishlamaydi).'
      : 'Parol <code>.env</code> faylidagi <code>ADMIN_PASSWORD</code> qatorida.';
    screen('Admin panelga kirish', hint, `
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

  const icon = (d) => '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  const THEME_ICONS = {
    sun: icon('<circle cx="12" cy="12" r="4"></circle><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"></path>'),
    moon: icon('<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"></path>')
  };

  // ---------- Panel skeleti ----------
  function shell() {
    root.innerHTML = `
<header class="topbar">
  <div class="container ad-top">
    ${brand}
    <span class="ad-live" id="live"><i></i><span>Ulanmoqda…</span></span>
    <div class="ad-top-right">
      <button type="button" class="theme-btn" id="theme-btn"></button>
      <a class="btn btn-ghost btn-sm" href="${esc(siteUrl)}" target="_blank" rel="noopener">Saytga o'tish</a>
      <button type="button" class="btn btn-ghost btn-sm" id="logout">Chiqish</button>
    </div>
  </div>
  <nav class="container ad-tabs" aria-label="Bo'limlar" id="tabs"></nav>
</header>
<div id="demo-banner"></div>
<main class="container ad-main" id="view"></main>
<dialog id="dlg" class="ad-dialog" aria-labelledby="dlg-title"><div id="dlg-body"></div></dialog>
<div class="ad-toast" id="toast" role="status" aria-live="polite"></div>`;

    // Yorug' / qorong'i rejim (js/theme.js)
    const themeBtn = document.getElementById('theme-btn');
    const paintTheme = () => {
      const dark = window.TezTheme && window.TezTheme.get() === 'dark';
      const label = dark ? "Yorug' rejim" : "Qorong'i rejim";
      themeBtn.setAttribute('aria-label', label);
      themeBtn.title = label;
      themeBtn.innerHTML = dark ? THEME_ICONS.sun : THEME_ICONS.moon;
    };
    paintTheme();
    themeBtn.addEventListener('click', () => { if (window.TezTheme) window.TezTheme.toggle(); });
    document.addEventListener('tez:theme', paintTheme);

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
    v.innerHTML = { overview: viewOverview, agencies: viewAgencies, payments: viewPayments, tariffs: viewTariffs, bookings: viewBookings, agents: viewAgents, security: viewSecurity }[state.tab]();
    // Qidiruv maydonida (va agent topshirig'ida) yozish davom etsin
    if (keepFocus) {
      const el = document.getElementById(keepFocus);
      if (el && el.matches('input[type=search], #ag-cmd')) { el.focus(); try { el.setSelectionRange(caret, caret); } catch (e) { /* yo'q */ } }
    }
  }
  // Foydalanuvchi forma maydonini to'ldirayotgan bo'lsa, avtomatik yangilanish uni o'chirib yubormasin
  function editing() {
    const el = document.activeElement;
    return !!(el && el.closest && el.closest('#view form') && el.matches('input:not([type=search]):not([type=checkbox]), select, textarea:not(#ag-cmd)'));
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
    <label><span class="label">Ustama, %</span><input class="input input-sm" name="markup" type="number" min="0" max="50" step="0.5" value="10" title="Firma oladigan foiz: mijoz narxi = netto + foiz"></label>
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
        <td data-th="Firma"><b>${esc(a.name)}</b><span class="hint ad-sub">${esc([a.contact, a.phone].filter(Boolean).join(' · ') || '—')}</span><span class="hint ad-sub">Ustama ${esc(a.markup != null ? a.markup : 10)}%${a.source === 'self' ? ' · o\'zi ro\'yxatdan o\'tgan' : ''}</span></td>
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

  // ---------- Xavfsizlik (server/security.js) ----------
  const SEC_KIND = {
    scan: 'Skaner (/.env, /wp-admin…)', attack: 'Hujum naqshi (SQL/XSS/traversal)', auth_fail: 'Noto\'g\'ri parol', csrf: 'Boshqa saytdan so\'rov (CSRF)',
    rate_limited: 'Limitga urildi', register_flood: 'Ko\'p ro\'yxatdan o\'tish', honeypot: 'Bot tuzog\'i', not_found: '404', bad_method: 'Noto\'g\'ri metod',
    bad_request: 'Buzuq so\'rov', too_large: 'Juda katta so\'rov', flood: 'So\'rovlar oqimi', ban: 'BLOKLANDI', unban: 'Blokdan chiqarildi', tg_abuse: 'Telegram'
  };
  function viewSecurity() {
    const s = state.sec;
    if (!s) return '<section class="card ad-table-card"><p class="muted">Yuklanmoqda…</p></section>';
    const last = s.last24h || {};
    const kpi = [
      ['Hozir bloklangan', s.activeBans || 0, 'IP manzil'],
      ['Skaner / hujum (24 soat)', (last.scan || 0) + (last.attack || 0), 'darhol bloklanadi'],
      ['Noto\'g\'ri parol (24 soat)', last.auth_fail || 0, '5 ta xato — blok'],
      ['Kuzatuvda', (s.watch || []).length, 'shubhali IP']
    ];
    const bans = (s.bans || []).filter(b => b.active).concat((s.bans || []).filter(b => !b.active).slice(0, 20));
    return `
${s.demo ? '<div class="ad-banner">Brauzer demosi: xavfsizlik qalqoni faqat serverda (npm start) ishlaydi.</div>' : !s.enabled ? '<div class="ad-banner">Qalqon o\'chirilgan (.env: SHIELD=off). Yoqish tavsiya etiladi.</div>' : ''}
${tiles(kpi)}
<section class="card ad-table-card" aria-labelledby="h-sec">
  <h1 id="h-sec" class="h2">Xavfsizlik qalqoni</h1>
  <p class="hint">Shubhali harakatlar IP'ga ball qo'shadi (10 ball — blok). Blok muddati har safar oshadi: ${esc((s.steps || []).map(m => m >= 1440 ? (m / 1440) + ' kun' : m >= 60 ? (m / 60) + ' soat' : m + ' daq').join(' → '))}.
    Sizning IP: <code>${esc(s.you || '—')}</code> (lokal va SHIELD_ALLOW_IPS dagi IP'lar bloklanmaydi).</p>
  <form class="ad-grid-form" data-form="ban" autocomplete="off">
    <label><span class="label">IP manzil</span><input class="input input-sm" name="ip" required maxlength="45" placeholder="203.0.113.5"></label>
    <label><span class="label">Muddat</span><select class="input input-sm" name="minutes"><option value="60">1 soat</option><option value="1440" selected>1 kun</option><option value="10080">7 kun</option><option value="525600">1 yil</option></select></label>
    <label><span class="label">Sabab</span><input class="input input-sm" name="reason" maxlength="100" placeholder="qo'lda"></label>
    <button class="btn btn-dark" type="submit">Bloklash</button>
  </form>
</section>
<section class="card ad-table-card" aria-labelledby="h-bans">
  <h2 id="h-bans" class="h2">Bloklangan IP'lar <span class="count">${s.activeBans || 0}</span></h2>
  ${!bans.length ? '<p class="ad-empty muted">Hozircha bloklangan IP yo\'q.</p>' : `
  <div class="ad-scroll"><table class="ad-table">
    <thead><tr><th>IP</th><th>Holat</th><th>Sabab</th><th class="num">Marta</th><th>Qachongacha</th><th><span class="sr-only">Amallar</span></th></tr></thead>
    <tbody>${bans.map(b => `
      <tr class="${b.active ? '' : 'is-off'}">
        <td data-th="IP"><code>${esc(b.ip)}</code></td>
        <td data-th="Holat"><span class="ad-status ad-s-${b.active ? 'off' : 'past'}">${b.active ? 'Bloklangan' : 'Muddati tugagan'}</span>${b.manual ? '<span class="hint ad-sub">qo\'lda</span>' : ''}</td>
        <td data-th="Sabab">${esc(b.reason || '—')}</td>
        <td data-th="Marta" class="num">${esc(b.strikes)}</td>
        <td data-th="Qachongacha" class="nowrap">${esc(stamp(b.until))}</td>
        <td class="ad-actions">${b.active ? `<button type="button" class="btn btn-sm" data-do="unban" data-id="${esc(b.ip)}">Blokdan chiqarish</button>` : ''}</td>
      </tr>`).join('')}</tbody>
  </table></div>`}
</section>
${(s.watch || []).length ? `
<section class="card ad-table-card" aria-labelledby="h-watch">
  <h2 id="h-watch" class="h2">Kuzatuvdagi IP'lar</h2>
  <p class="hint">Ball vaqt o'tishi bilan kamayadi (har 10 daqiqada yarmiga).</p>
  <div class="ad-scroll"><table class="ad-table"><thead><tr><th>IP</th><th class="num">Ball (10 dan)</th><th></th></tr></thead>
  <tbody>${s.watch.map(w => `<tr><td data-th="IP"><code>${esc(w.ip)}</code></td><td data-th="Ball" class="num">${esc(w.score)}</td>
    <td class="ad-actions"><button type="button" class="btn btn-sm ad-danger" data-do="banIp" data-id="${esc(w.ip)}">Bloklash</button></td></tr>`).join('')}</tbody></table></div>
</section>` : ''}
<section class="card ad-table-card" aria-labelledby="h-ev">
  <h2 id="h-ev" class="h2">Oxirgi hodisalar</h2>
  ${!(s.events || []).length ? '<p class="ad-empty muted">Hodisalar yo\'q.</p>' : `
  <div class="ad-scroll"><table class="ad-table">
    <thead><tr><th>Vaqt</th><th>IP</th><th>Hodisa</th><th>Tafsilot</th></tr></thead>
    <tbody>${s.events.slice(0, 120).map(e => `
      <tr><td data-th="Vaqt" class="nowrap">${esc(stamp(e.at))}</td><td data-th="IP"><code>${esc(e.ip)}</code></td>
      <td data-th="Hodisa">${e.kind === 'ban' ? '<b>' + esc(SEC_KIND.ban) + '</b>' : esc(SEC_KIND[e.kind] || e.kind)}</td><td data-th="Tafsilot" class="hint">${esc(e.detail || '')}</td></tr>`).join('')}</tbody>
  </table></div>`}
</section>`;
  }
  async function loadSecurity() {
    try { state.sec = await api('/security'); }
    catch (err) { if (err.status === 401) { showLogin('Sessiya tugadi, qayta kiring.'); return; } }
    if (state.tab === 'security' && document.getElementById('view') && !editing()) draw();
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

  // ---------- Agentlar (Main Agent, navbat, ishchilar, operatorlar) ----------
  const badge = (map, v) => { const s = map[v] || ['past', String(v || '—').replace(/_/g, ' ')]; return `<span class="ad-status ad-s-${s[0]}">${esc(s[1])}</span>`; };
  function viewAgents() {
    const g = state.ag;
    if (!g.data) return g.error
      ? `<section class="card ad-table-card"><h1 class="h2">Agentlar</h1><p class="muted">${esc(g.error)}</p></section>`
      : '<p class="muted">Yuklanmoqda…</p>';
    const d = g.data, ov = d.overview || {}, sites = ov.websites || {}, tk = ov.tasks || {};
    const ast = d.main.agentStatus || {}, wc = d.main.workerCounts || {}, set = d.settings || {};
    const tasks = d.tasks || [], openAlerts = (d.alerts || []).filter(a => a.status === 'open');
    const oq = g.oq.trim().toLowerCase();
    const sites2 = (d.websites || []).filter(s => !oq || (s.name + ' ' + s.url).toLowerCase().indexOf(oq) >= 0);
    const minDate = state.today || new Date().toISOString().slice(0, 10);
    return `
<section aria-labelledby="h-agst">
  <h1 id="h-agst" class="h2">Agentlar</h1>
  <p class="hint ad-hint">Main Agent topshiriqni tahlil qiladi, navbatga qo'yadi va ulangan operatorlarning ishchilariga (worker) tarqatadi. Natijalar shu yerda solishtiriladi.</p>
  ${tiles([
    ['Main Agent', ast.parser === 'llm' ? 'AI' : 'Faol', ast.parser === 'llm' ? 'AI tahlilchi (' + (ast.llmProvider || 'llm') + ')' : 'qoidaviy tahlilchi'],
    ['Ishchilar (adapter)', ast.adaptersRegistered || 0, (wc.running || 0) + ' tasi hozir ishlamoqda'],
    ['Ulangan operatorlar', (sites.verified || 0) + ' / ' + (sites.configured || 0), (sites.enabled || 0) + ' tasi yoqilgan'],
    ['Faol vazifalar', tk.active || 0, (tk.completed || 0) + ' yakunlangan · ' + (tk.failed || 0) + ' xato'],
    ['Ogohlantirishlar', openAlerts.length, openAlerts.length ? 'ko\'rib chiqish kerak' : 'hammasi joyida']
  ])}
  ${!ast.adaptersRegistered ? '<div class="card ad-notice"><b>Hozircha birorta ishchi (adapter) o\'rnatilmagan.</b> Topshiriqlar saqlanadi, lekin operatorlarga yuborilmaydi ("Mos operator yo\'q"). Sinab ko\'rish uchun: <code>npm run demo</code> — taqlidiy ishchi bilan.</div>' : ''}
</section>

<section class="card ad-table-card" aria-labelledby="h-agcmd">
  <h2 id="h-agcmd" class="h2">Agentga topshiriq</h2>
  <p class="hint">Oddiy so'z bilan yozing (o'zbek, rus yoki ingliz tilida). Ma'lumot yetishmasa, agent aniqlashtiruvchi savol beradi.</p>
  <form class="ad-form" data-form="agcmd">
    <textarea id="ag-cmd" class="input ad-textarea" name="command" rows="3" maxlength="4000" required placeholder="Masalan: Antalyaga 15-dekabr 7 kecha 2 kishi hammasi kiritilgan 2000 dollargacha">${esc(g.draft)}</textarea>
    <div class="btn-row"><button class="btn btn-dark" type="submit">Agentga yuborish</button></div>
  </form>
  ${g.clarify ? `<div class="card ad-notice"><b>Agent aniqlashtirishni so'radi:</b><ul class="ad-ask">${(g.clarify.missing || []).map(f => `<li>${esc(ASK[f] || f)}</li>`).join('')}</ul><span class="hint">Matnni to'ldirib, qayta yuboring.</span></div>` : ''}
  <details class="ad-details">
    <summary>Aniq parametrlar bilan topshiriq</summary>
    <form class="ad-grid-form" data-form="agsearch" autocomplete="off">
      <label><span class="label">Shahar / kurort *</span><input class="input input-sm" name="destination" required maxlength="120" placeholder="Antalya"></label>
      <label><span class="label">Davlat *</span><select class="input input-sm" name="country" required><option value="">Tanlang</option>${COUNTRY_OPTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
      <label><span class="label">Uchish sanasi *</span><input class="input input-sm" type="date" name="date" min="${esc(minDate)}" required></label>
      <label><span class="label">Kechalar *</span><input class="input input-sm" type="number" name="nights" min="1" max="30" value="7" required></label>
      <label><span class="label">Kattalar *</span><input class="input input-sm" type="number" name="adults" min="1" max="8" value="2" required></label>
      <label><span class="label">Bolalar yoshi</span><input class="input input-sm" name="childrenAges" placeholder="masalan: 5, 9" pattern="\\s*(\\d{1,2}\\s*(,\\s*\\d{1,2}\\s*){0,3})?"></label>
      <label><span class="label">Byudjet (jami)</span><input class="input input-sm" type="number" name="budget" min="1" placeholder="ixtiyoriy"></label>
      <label><span class="label">Valyuta</span><select class="input input-sm" name="currency"><option>USD</option><option>EUR</option><option>UZS</option></select></label>
      <label><span class="label">Qayerdan</span><select class="input input-sm" name="departureAirport"><option value="">Toshkent (sukut)</option>${FROM_OPTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
      <label><span class="label">Ovqatlanish</span><select class="input input-sm" name="mealPlan"><option value="">Farqi yo'q</option>${Object.keys(MEAL_UZ).map(k => `<option value="${k}">${k} — ${MEAL_UZ[k]}</option>`).join('')}</select></label>
      <label><span class="label">Yulduz (kamida)</span><select class="input input-sm" name="hotelStars"><option value="">Farqi yo'q</option><option>3</option><option>4</option><option>5</option></select></label>
      <button class="btn btn-dark" type="submit">Navbatga qo'yish</button>
    </form>
  </details>
</section>

<section class="card ad-table-card" aria-labelledby="h-agtasks">
  <div class="ad-toolbar"><h2 id="h-agtasks" class="h2">Vazifalar <span class="count">${tasks.length}</span></h2></div>
  ${!tasks.length ? '<p class="ad-empty muted">Hali vazifalar yo\'q. Yuqorida agentga topshiriq bering.</p>' : `
  <div class="ad-scroll"><table class="ad-table">
    <thead><tr><th>Yaratilgan</th><th>Topshiriq</th><th>Holat</th><th>Jarayon</th><th class="num">Takliflar</th><th><span class="sr-only">Amallar</span></th></tr></thead>
    <tbody>${tasks.map(t => {
      const pct = Math.max(0, Math.min(100, t.progressPercent || 0));
      const live = ['queued', 'running', 'blocked'].indexOf(t.status) >= 0;
      return `
      <tr class="${t.status === 'cancelled' ? 'is-off' : ''}">
        <td data-th="Yaratilgan" class="nowrap">${esc(stamp(t.createdAt))}</td>
        <td data-th="Topshiriq"><b>${esc(t.command || '—')}</b>${t.errorCode ? `<span class="hint ad-sub">${esc(t.errorCode)}</span>` : ''}</td>
        <td data-th="Holat">${badge(TASK_ST, t.status)}</td>
        <td data-th="Jarayon"><span class="ad-bar" title="${pct}%"><i style="width:${pct}%"></i></span><span class="hint ad-sub">${t.completedWorkers || 0}/${t.totalWorkers || 0} ishchi${t.failedWorkers ? ' · ' + t.failedWorkers + ' xato' : ''}</span></td>
        <td data-th="Takliflar" class="num">${t.offersFound || 0}</td>
        <td class="ad-actions">
          <button type="button" class="btn btn-sm" data-do="agOffers" data-id="${esc(t.id)}">Natijalar</button>
          ${live ? `<button type="button" class="btn btn-sm ad-danger" data-do="agCancel" data-id="${esc(t.id)}">To'xtatish</button>` : ''}
        </td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>`}
</section>

<section class="card ad-table-card" aria-labelledby="h-agops">
  <div class="ad-toolbar">
    <h2 id="h-agops" class="h2">Operatorlar <span class="count">${sites2.length}</span></h2>
    <input id="ag-oq" class="input input-sm ad-search" type="search" placeholder="Qidirish: nomi, manzil…" value="${esc(g.oq)}" aria-label="Operatorlarni qidirish">
    <button type="button" class="btn btn-sm" data-do="agAddSite">+ Operator qo'shish</button>
  </div>
  <p class="hint ad-hint">Agent faqat <b>yoqilgan</b>, <b>tasdiqlangan</b> va ishchisi o'rnatilgan operatorlarga topshiriq yuboradi.</p>
  <div class="ad-scroll"><table class="ad-table">
    <thead><tr><th>Operator</th><th>Integratsiya</th><th>Ishchi</th><th>Oxirgi muvaffaqiyatli qidiruv</th><th>Yoqilgan</th></tr></thead>
    <tbody>${sites2.map(s => `
      <tr class="${s.enabled ? '' : 'is-off'}">
        <td data-th="Operator"><b>${esc(s.name)}</b><span class="hint ad-sub">${esc(s.url)}</span></td>
        <td data-th="Integratsiya">${badge(INT_ST, s.integrationStatus)}</td>
        <td data-th="Ishchi">${badge(WORK_ST, s.workerStatus)}</td>
        <td data-th="Oxirgi qidiruv" class="nowrap">${esc(stamp(s.lastSuccessfulSearch))}</td>
        <td data-th="Yoqilgan"><label class="ad-switch"><input type="checkbox" data-site="${esc(s.id)}"${s.enabled ? ' checked' : ''} aria-label="${esc(s.name)} yoqilgan"><span></span></label></td>
      </tr>`).join('')}</tbody>
  </table></div>
</section>

<div class="ad-two">
  <section class="card ad-table-card" aria-labelledby="h-agset">
    <h2 id="h-agset" class="h2">Sozlamalar</h2>
    <p class="hint">Navbat cheklovlari — bir vaqtda nechta ishchi ishlaydi, qayta urinishlar va kutish vaqti.</p>
    <form class="ad-grid-form" data-form="agsettings">
      <label><span class="label">Jami parallel ishchilar</span><input class="input input-sm" type="number" name="workerConcurrency" min="1" max="50" value="${esc(set.worker_concurrency)}" required></label>
      <label><span class="label">Bitta operatorga</span><input class="input input-sm" type="number" name="perOperatorConcurrency" min="1" max="10" value="${esc(set.per_operator_concurrency)}" required></label>
      <label><span class="label">Qayta urinishlar</span><input class="input input-sm" type="number" name="retryLimit" min="0" max="5" value="${esc(set.retry_limit)}" required></label>
      <label><span class="label">Kutish vaqti (soniya)</span><input class="input input-sm" type="number" name="searchTimeoutSeconds" min="5" max="300" value="${esc(set.search_timeout_seconds)}" required></label>
      <label><span class="label">Saqlash muddati (kun)</span><input class="input input-sm" type="number" name="retentionDays" min="1" max="365" value="${esc(set.retention_days)}" required></label>
      <button class="btn btn-dark" type="submit">Saqlash</button>
    </form>
  </section>
  <section class="card ad-table-card" aria-labelledby="h-agal">
    <h2 id="h-agal" class="h2">Ogohlantirishlar <span class="count">${openAlerts.length}</span></h2>
    ${!(d.alerts || []).length ? '<p class="ad-empty muted">Ogohlantirishlar yo\'q.</p>' : `
    <ul class="ad-list">${(d.alerts || []).slice(0, 20).map(a => `
      <li class="${a.status === 'open' ? '' : 'is-off'}"><div><b>${esc(a.message)}</b><span class="hint ad-sub">${esc(String(a.type || '').replace(/_/g, ' '))} · ${esc(stamp(a.createdAt))}</span></div>
        ${a.status === 'open' ? `<button type="button" class="btn btn-sm" data-do="agResolve" data-id="${esc(a.id)}">Hal qilindi</button>` : '<span class="ad-status ad-s-ok">Hal qilingan</span>'}</li>`).join('')}</ul>`}
  </section>
</div>

<section class="card ad-table-card" aria-labelledby="h-aglog">
  <h2 id="h-aglog" class="h2">Ishchilar jurnali</h2>
  ${!(d.logs || []).length ? '<p class="ad-empty muted">Hali yozuvlar yo\'q — vazifa bajarilganda shu yerda ko\'rinadi.</p>' : `
  <div class="ad-scroll"><table class="ad-table">
    <thead><tr><th>Vaqt</th><th>Operator</th><th>Hodisa</th><th>Holat</th><th class="num">Urinish</th><th>Tafsilot</th></tr></thead>
    <tbody>${d.logs.slice(0, 30).map(l => `
      <tr>
        <td data-th="Vaqt" class="nowrap">${esc(stamp(l.at))}</td>
        <td data-th="Operator"><b>${esc(l.website)}</b></td>
        <td data-th="Hodisa">${esc(LOG_EV[l.eventType] || String(l.eventType || 'status').replace(/_/g, ' '))}</td>
        <td data-th="Holat">${badge(TASK_ST, l.status)}</td>
        <td data-th="Urinish" class="num">${l.attempts || 0}</td>
        <td data-th="Tafsilot">${esc(l.errorCode || '')}${l.message ? `<span class="hint ad-sub">${esc(l.message)}</span>` : ''}</td>
      </tr>`).join('')}</tbody>
  </table></div>`}
</section>`;
  }

  async function showOffers(task) {
    dialog(`<h2 id="dlg-title" class="h2">Natijalar</h2><p class="muted">${esc(task.command || '')}</p><p class="muted">Yuklanmoqda…</p>`, true);
    const r = await act(() => agentApi('/searches/' + encodeURIComponent(task.id) + '/offers'));
    if (!r) return;
    const rows = [].concat(...(r.comparison || []).map(gr => (gr.offers || []).map(o => Object.assign({ identity: gr.identityVerified }, o))))
      .sort((a, b) => a.totalPrice - b.totalPrice);
    const SHOW = 300;
    const ops = new Set(rows.map(o => o.operatorName)).size;
    const dmy = (iso) => /^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? iso.slice(8, 10) + '.' + iso.slice(5, 7) + '.' + iso.slice(0, 4) : '';
    const safeUrl = (u) => /^https?:\/\//i.test(u || '') ? u : '';
    dialog(`
      <div class="row-between"><h2 id="dlg-title" class="h2">Natijalar</h2><button type="button" class="btn btn-sm" data-close>Yopish</button></div>
      <p class="muted">${esc(task.command || '')} · ${badge(TASK_ST, task.status)}</p>
      ${!rows.length ? `<p class="muted">${task.status === 'blocked' ? 'Mos (yoqilgan va tasdiqlangan) operator ishchisi yo\'q — topshiriq hech qayerga yuborilmadi.' : ['queued', 'running'].indexOf(task.status) >= 0 ? 'Ishchilar operatorlardan qidirmoqda…' : 'Takliflar topilmadi. Sababi "Ishchilar jurnali"da: operator bu davlatga sotmaydi, shu kunga tur yo\'q yoki kurort/filtrga mos kelmadi.'}</p>` : `
      <p class="hint">${rows.length} ta taklif · ${ops} ta operator · eng arzoni ${esc(group(rows[0].totalPrice))} ${esc(rows[0].currency)}. Sana ±3 kun oralig'ida qidirildi (saytdagidek). Narxlar — operatorning ochiq qidiruv sahifasidan (netto, butun guruh uchun); bron paytida operator tasdiqlaydi.</p>
      <div class="ad-scroll"><table class="ad-table">
        <thead><tr><th>Mehmonxona</th><th>Operator</th><th>Sana</th><th>Ovqat / xona</th><th class="num">Narx</th><th>Mavjudlik</th></tr></thead>
        <tbody>${rows.slice(0, SHOW).map(o => {
          const x = o.offer || {};
          const url = safeUrl(o.sourceUrl);
          return `<tr>
          <td data-th="Mehmonxona"><b>${esc(o.hotelName)}</b>${x.hotelStars ? ' <span class="hint">' + '★'.repeat(x.hotelStars) + '</span>' : ''}${x.hotelLocation ? `<span class="hint ad-sub">${esc(x.hotelLocation)}</span>` : ''}</td>
          <td data-th="Operator" class="nowrap">${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(o.operatorName)} ↗</a>` : esc(o.operatorName)}</td>
          <td data-th="Sana" class="nowrap">${esc(dmy(x.checkIn))}${x.nights ? ' · ' + esc(x.nights) + ' kecha' : ''}${x.departure ? `<span class="hint ad-sub">✈ ${esc(x.departure)}</span>` : ''}</td>
          <td data-th="Ovqat / xona">${x.mealPlan && x.mealPlan !== 'unknown' ? `<b>${esc(x.mealPlan)}</b> <span class="hint">${esc(MEAL_UZ[x.mealPlan] || '')}</span>` : '—'}${x.roomType ? `<span class="hint ad-sub">${esc(x.roomType)}</span>` : ''}</td>
          <td data-th="Narx" class="num nowrap"><b>${esc(group(o.totalPrice))} ${esc(o.currency)}</b>${x.gds ? '<span class="hint ad-sub">GDS reys</span>' : ''}</td>
          <td data-th="Mavjudlik">${badge(AVAIL, o.availability)}</td></tr>`;
        }).join('')}</tbody>
      </table></div>
      ${rows.length > SHOW ? `<p class="hint">Eng arzon ${SHOW} tasi ko'rsatildi (jami ${rows.length}).</p>` : ''}`}`, true);
  }

  // ---------- Oyna va xabar ----------
  function dialog(html, wide) {
    const dlg = document.getElementById('dlg');
    dlg.classList.toggle('is-wide', !!wide);
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
        <label><span class="label">Ustama, % (mijoz narxi = netto + foiz)</span><input class="input" name="markup" type="number" min="0" max="50" step="0.5" value="${esc(a.markup != null ? a.markup : 10)}"></label>
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
    // Agentlar
    const agTask = state.ag.data && (state.ag.data.tasks || []).find(t => t.id === id);
    if (what === 'agOffers' && agTask) return showOffers(agTask);
    if (what === 'agCancel' && agTask) {
      if (!confirm('Vazifa to\'xtatilsinmi?\n' + (agTask.command || ''))) return;
      btn.disabled = true;
      const r = await act(() => agentApi('/searches/' + encodeURIComponent(id) + '/cancel', 'POST', {}));
      btn.disabled = false;
      if (r) { toast('Vazifa to\'xtatildi.'); loadAgents(); }
      return;
    }
    if (what === 'agResolve') {
      btn.disabled = true;
      const r = await act(() => agentApi('/alerts/' + encodeURIComponent(id) + '/resolve', 'POST', {}));
      btn.disabled = false;
      if (r) loadAgents();
      return;
    }
    if (what === 'agAddSite') {
      const name = prompt('Operator nomi'); if (!name) return;
      const url = prompt('Operator sayti (https://...)'); if (!url) return;
      const r = await act(() => agentApi('/websites', 'POST', { name, url }));
      if (r) { toast('Operator qo\'shildi (holati: ulanmagan).'); loadAgents(); }
      return;
    }

    if (what === 'unban' || what === 'banIp') {
      if (what === 'banIp' && !confirm(id + ' 1 kunga bloklansinmi?')) return;
      btn.disabled = true;
      const res = await act(() => api(what === 'unban' ? '/security/unban' : '/security/ban', what === 'unban' ? { ip: id } : { ip: id, minutes: 1440, reason: 'admin: kuzatuvdan' }));
      btn.disabled = false;
      if (res) { toast(what === 'unban' ? id + ' blokdan chiqarildi.' : id + ' bloklandi.'); loadSecurity(); }
      return;
    }

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
    if (el.id === 'ag-oq' && e.type === 'input') { state.ag.oq = el.value; draw(); }
    if (el.id === 'ag-cmd') state.ag.draft = el.value;
    // Operatorni yoqish / o'chirish
    if (el.matches('input[data-site]') && e.type === 'change') {
      const on = el.checked;
      el.disabled = true;
      act(() => agentApi('/websites/' + encodeURIComponent(el.dataset.site), 'PATCH', { enabled: on })).then(r => {
        if (r) { toast((r.website ? r.website.name : 'Operator') + (on ? ' yoqildi.' : ' o\'chirildi.')); loadAgents(); }
        else { el.checked = !on; el.disabled = false; }
      });
    }
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
    if (kind === 'ban') {
      const res = await act(() => api('/security/ban', { ip: data.ip.trim(), minutes: Number(data.minutes), reason: data.reason || 'qo\'lda' }));
      if (submit) submit.disabled = false;
      if (res) { form.reset(); toast(res.ip + ' bloklandi.'); loadSecurity(); }
      return;
    }
    // ---- Agentlar ----
    if (kind === 'agcmd' || kind === 'agsearch' || kind === 'agsettings') {
      let a = null;
      if (kind === 'agcmd') {
        a = await act(() => agentApi('/agent/searches', 'POST', { command: data.command }, { 'Idempotency-Key': uid() }));
        if (a && a.status === 'needs_clarification') { state.ag.clarify = a; a = null; draw(); }
        else if (a) { state.ag.clarify = null; state.ag.draft = ''; agentQueued(a); }
      }
      if (kind === 'agsearch') {
        const ages = String(data.childrenAges || '').trim();
        const parameters = {
          destination: data.destination, country: data.country, date: data.date,
          nights: Number(data.nights), adults: Number(data.adults),
          childrenAges: ages ? ages.split(',').map(x => Number(x.trim())) : [],
          budget: data.budget ? Number(data.budget) : null, currency: data.currency, departureAirport: data.departureAirport || null,
          mealPlan: data.mealPlan || null, hotelStars: data.hotelStars ? Number(data.hotelStars) : null
        };
        a = await act(() => agentApi('/searches', 'POST', { parameters }, { 'Idempotency-Key': uid() }));
        if (a) { form.reset(); agentQueued(a); }
      }
      if (kind === 'agsettings') {
        const body = {};
        Object.keys(data).forEach(k => { body[k] = Number(data[k]); });
        a = await act(() => agentApi('/settings', 'POST', body));
        if (a) toast('Sozlamalar saqlandi.');
      }
      if (submit) submit.disabled = false;
      if (a) { if (document.activeElement) document.activeElement.blur(); loadAgents(); }
      return;
    }
    if (submit) submit.disabled = false;
    if (r) load();
  }
  function agentQueued(a) {
    const t = a.task || {};
    toast(a.duplicate ? 'Bu topshiriq avval yuborilgan.'
      : t.status === 'blocked' ? 'Topshiriq saqlandi, lekin mos (ulangan) operator yo\'q.'
        : 'Topshiriq navbatga qo\'yildi: ' + (a.selectedWorkers || t.totalWorkers || 0) + ' ta ishchi.', t.status === 'blocked');
  }

  // ---------- Ma'lumotlarni yuklash ----------
  async function load() {
    try {
      const [stats, list, ag, pay, tar] = await Promise.all([api('/stats'), api('/bookings'), api('/agencies'), api('/payments'), api('/tariffs')]);
      state.stats = stats; state.bookings = list.bookings; state.today = list.today;
      state.agencies = ag.agencies; state.payments = pay.payments; state.tariffs = tar.tariffs;
      if (state.tab === 'agents') return loadAgents();
      if (state.tab === 'security') return loadSecurity();
      if (!editing()) draw();
    } catch (err) {
      if (err.status === 401) showLogin('Sessiya tugadi, qayta kiring.');
    }
  }
  // Agentlar bo'limi ma'lumotlari (faqat shu bo'lim ochilganda yuklanadi)
  let agLoading = null;
  function loadAgents() {
    if (agLoading) return agLoading;
    agLoading = (async () => {
      try {
        const [overview, main, websites, searches, alerts, logs, settings] = await Promise.all([
          agentApi('/overview'), agentApi('/main-agent'), agentApi('/websites'), agentApi('/searches?limit=50'),
          agentApi('/alerts?limit=50'), agentApi('/logs?limit=50'), agentApi('/settings')]);
        state.ag.data = { overview, main, websites: websites.websites, tasks: searches.tasks, alerts: alerts.alerts, logs: logs.logs, settings: settings.settings };
        state.ag.error = '';
        startAgentEvents();
      } catch (err) {
        if (err.status === 401) { showLogin('Sessiya tugadi, qayta kiring.'); return; }
        state.ag.error = err.status === 404 || !err.status
          ? 'Agentlar faqat server bilan ishlaydi: terminalda npm start (yoki npm run demo) ni ishga tushiring.'
          : 'Agentlar ma\'lumotini yuklab bo\'lmadi: ' + (err.code || err.message);
      } finally { agLoading = null; }
      if (state.tab === 'agents' && document.getElementById('view') && !editing()) draw();
    })();
    return agLoading;
  }
  // Vazifa holati o'zgarganda (navbat, ishchi, natija) — darhol yangilanadi (SSE)
  function startAgentEvents() {
    if (agEs || typeof EventSource !== 'function') return;
    let timer = 0;
    agEs = new EventSource('/api/admin/agents/events');
    agEs.addEventListener('update', () => {
      if (state.tab !== 'agents') return;
      clearTimeout(timer); timer = setTimeout(loadAgents, 300);
    });
    agEs.addEventListener('error', () => { if (agEs && agEs.readyState === 2) agEs = null; });
  }
  function setLive(on) {
    const el = document.getElementById('live'); if (!el) return;
    el.classList.toggle('on', on);
    el.lastElementChild.textContent = on ? 'Jonli' : 'Ulanmoqda…';
  }
  function route() {
    const h = location.hash.slice(1);
    state.tab = TABS.some(t => t[0] === h) ? h : 'overview';
    if (document.getElementById('view')) { draw(); if (state.tab === 'agents') loadAgents(); if (state.tab === 'security') loadSecurity(); }
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
      screen('Server kerak', 'Admin panel faqat server orqali ishlaydi. Terminalda <code>npm start</code> ni ishga tushiring va <b>http://localhost:3001</b> ni oching.');
      return;
    }
    try {
      const me = await api('/me');
      if (me.siteUrl) siteUrl = me.siteUrl;
      if (me.authed) start(); else showLogin();
    } catch (err) {
      if (err.status === 503) screen('Admin panel o\'chiq', '<code>.env</code> fayliga <code>ADMIN_PASSWORD=...</code> qatorini yozing va serverni qayta ishga tushiring.');
      else screen('Server bilan aloqa yo\'q', 'Server ishlayotganini tekshiring (<code>npm start</code>) va sahifani yangilang.');
    }
  })();
})();
