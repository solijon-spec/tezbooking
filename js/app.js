/*
 * TezBooking — interfeys.
 *
 * Ishlash tartibi:  state (holat) -> compute() (ko'rsatish uchun ma'lumot) -> view() (HTML) -> render()
 * render() sahifani to'liq almashtirmaydi: faqat o'zgargan joylarini yangilaydi (morph).
 * Shu sababli yozilayotgan maydon, fokus va aylantirish (scroll) joyi saqlanib qoladi.
 *
 * Tugmalar   data-action="..." data-arg="..."  orqali,
 * maydonlar  data-change="..." (o'zgarganda) yoki data-input="..." (yozilayotganda) orqali ishlaydi.
 * Matnlar    js/i18n.js ichida (uz / ru / en).
 */
(function () {
  'use strict';

  const D = window.TB;
  const L = window.I18N;
  const dt = D.date;
  const sync = window.TezSync;                         // server bilan sinxronlash (js/sync.js), bo'lmasligi ham mumkin

  // ---------- Sozlamalar ----------
  const MARKUP = 10;                                   // agentlik ustamasi, %
  const DEFAULT_MY = ['tr', 'ae', 'eg', 'ge', 'az', 'my'];
  const NIGHTS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14];
  const OPS_SHORT = 8;                                 // filtrda dastlab ko'rinadigan operatorlar soni
  const MAX_ADULTS = 8, MAX_CHILDREN = 4, MAX_ROOMS = 4, ADULTS_PER_ROOM = 4;
  const DEFAULT_CHILD_AGE = 7;
  const ALL_IDS = D.COUNTRIES.map(c => c.id);
  const today = dt.localToday();

  // ---------- Brauzerda saqlash ----------
  const store = {
    get(key, def) {
      try { const raw = localStorage.getItem('tezbooking.' + key); return raw == null ? def : JSON.parse(raw); }
      catch (e) { return def; }
    },
    set(key, value) {
      try { localStorage.setItem('tezbooking.' + key, JSON.stringify(value)); } catch (e) { /* e'tiborsiz */ }
    }
  };

  function detectLang() {
    const saved = store.get('lang', null);
    if (L.LANGS.some(l => l.id === saved)) return saved;
    // Birinchi kirishda: brauzer ruscha bo'lsa — ruscha, aks holda o'zbekcha
    const nav = (navigator.language || '').slice(0, 2).toLowerCase();
    return nav === 'ru' ? 'ru' : 'uz';
  }
  function loadMy() {
    const list = store.get('myCountries', null);
    const valid = Array.isArray(list) ? ALL_IDS.filter(id => list.indexOf(id) >= 0) : [];
    return valid.length ? valid : DEFAULT_MY.slice();
  }
  // Taklif turlari: 'tour' (tur), 'hotel' (faqat mehmonxona), 'flight' (aviachipta)
  function validOffer(x) {
    if (!x || typeof x.key !== 'string' || typeof x.price !== 'number' || !Array.isArray(x.childAges)) return false;
    if (x.product === 'flight') {
      return !!D.AIRPORTS[x.to] && D.FROM.some(f => f.id === x.from) && typeof x.airline === 'string' &&
        !!x.out && dt.isValid(x.out.date) && (!x.back || dt.isValid(x.back.date));
    }
    return !!D.HOTEL_BY_ID[x.hotelId] && D.OPS.some(o => o.id === x.opId) && dt.isValid(x.date);
  }
  const TABS = ['tours', 'hotels', 'flights'];
  function loadBooked() {
    const list = store.get('booked', []);
    return Array.isArray(list) ? list.filter(b => b && typeof b.key === 'string').slice(-500) : [];
  }

  // ---------- Holat ----------
  const savedOffer = store.get('offer', []);
  const savedTab = store.get('tab', 'tours');
  const state = {
    tab: TABS.indexOf(savedTab) >= 0 ? savedTab : 'tours',   // bo'lim: turlar / mehmonxonalar / aviachiptalar
    // Aviachiptalar: qayerga (davlat), borish-qaytish yoki bir tomonga, qaytish sanasi, klass va filtrlar
    fTo: null, trip: 'rt', fRet: dt.addDays(today, 14), cabin: 'eco',
    fAir: {}, fDirect: false, fBag: false, fSort: 'price',
    lang: detectLang(),
    my: loadMy(),                 // agentlik ishlaydigan davlatlar
    dests: null,                  // qidiruvdagi davlatlar (null = birinchisi)
    from: 'tas', date: dt.addDays(today, 7), nights: 7,
    adults: 2, childAges: [], rooms: 1,
    ops: {}, stars: {}, meals: {}, cities: {},   // filtrlar: false = o'chirilgan
    onlyAvail: false, instant: false, maxPrice: null, hotelQuery: '',
    booked: loadBooked(),         // shu firmaning bronlari: [{ key, title, at }] — qidiruvda ko'rinmaydi, sanalari qizil
    taken: [],                    // boshqa firmalar bron qilgan takliflar (faqat kalit) — qidiruvda ko'rinmaydi
    undo: null,                   // oxirgi bron (xabardagi "Bekor qilish" tugmasi uchun)
    sort: 'price',
    mode: store.get('mode', 'net') === 'client' ? 'client' : 'net',
    cur: store.get('cur', 'USD') === 'UZS' ? 'UZS' : 'USD',
    open: {},                     // ochilgan mehmonxona kartalari
    offer: Array.isArray(savedOffer) ? savedOffer.filter(validOffer) : [],
    panel: false, note: '', settings: false, cq: '', menuOpen: false, filtersOpen: false
  };

  D.setBooked(state.booked.map(b => b.key));
  // Ochilganda: taklifdagi sotilib ketgan yoki bron qilingan variantlar olib tashlanadi
  state.offer = state.offer.filter(x => !D.isGone(x.key));

  let pendingFocus = null;        // render'dan keyin fokus beriladigan element (selector)

  function setState(patch) {
    if ('note' in patch && !('undo' in patch)) patch.undo = null;   // "Bekor qilish" faqat bron xabarida
    Object.assign(state, patch);
    if ('lang' in patch) store.set('lang', state.lang);
    if ('cur' in patch) store.set('cur', state.cur);
    if ('mode' in patch) store.set('mode', state.mode);
    if ('offer' in patch) store.set('offer', state.offer);
    if ('tab' in patch) store.set('tab', state.tab);
    if ('booked' in patch) store.set('booked', state.booked);
    if ('booked' in patch || 'taken' in patch) D.setBooked(state.booked.map(b => b.key).concat(state.taken));
    render();
  }

  // ---------- Til ----------
  function t(key, params) {
    let s = (L.S[state.lang] || {})[key];
    if (s == null) s = L.S.uz[key];
    if (s == null) return key;
    if (Array.isArray(s)) s = s[Math.min(L.pluralIndex(state.lang, params && params.n), s.length - 1)];
    return params ? s.replace(/\{(\w+)\}/g, (m, k) => (params[k] != null ? params[k] : m)) : s;
  }
  const nm = (group, id) => { const g = L.NAMES[group][id]; return g ? (g[state.lang] || g.uz) : id; };
  const countryName = (id) => nm('countries', id);
  const cityName = (id) => nm('cities', id);
  const mealShort = (code) => nm('meals', code)[0];
  const mealLong = (code) => nm('meals', code)[1];
  const roomName = (code) => nm('rooms', code);
  const fromName = (id) => nm('from', id)[0];
  const fromForm = (id) => nm('from', id)[1];

  function fmtDay(iso) {
    const d = dt.parse(iso), m = L.CAL[state.lang].months[d.getUTCMonth()];
    return state.lang === 'en' ? m + ' ' + d.getUTCDate() : d.getUTCDate() + ' ' + m;
  }
  const wd = (iso) => L.CAL[state.lang].wd[dt.parse(iso).getUTCDay()];
  const fmtLong = (iso) => wd(iso) + ', ' + fmtDay(iso) + ' ' + iso.slice(0, 4);

  function group(n) {
    const sep = state.lang === 'en' ? ',' : '\u00A0';
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  }
  function money(v) {
    if (state.cur === 'UZS') return group(Math.round(v * D.UZS_RATE / 1000) * 1000) + ' ' + t('uzs');
    return '$' + group(v);
  }

  // ---------- Yordamchilar ----------
  const esc = (v) => String(v).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const clientP = (v) => Math.round(v * (1 + MARKUP / 100) / 5) * 5;
  const shown = (v) => (state.mode === 'client' ? clientP(v) : v);
  const myList = () => ALL_IDS.filter(id => state.my.indexOf(id) >= 0);
  function destList() {
    const my = myList();
    let d = (state.dests || [my[0]]).filter(id => my.indexOf(id) >= 0);
    if (!d.length) d = [my[0]];
    return d;
  }
  const starOn = (n) => state.stars[n] !== false;
  const cityKey = (h) => h.country + ':' + h.city;
  const cityOn = (k) => state.cities[k] !== false;
  const children = () => state.childAges.length;
  const minRooms = (adults) => Math.max(1, Math.ceil(adults / ADULTS_PER_ROOM));
  function guestsLabel(adults, ages, rooms) {
    let s = t('adults_n', { n: adults });
    if (ages.length) s += ', ' + t('children_n', { n: ages.length }) + ' (' + t('ages', { list: ages.join(', ') }) + ')';
    if (rooms > 1) s += ', ' + t('rooms_n', { n: rooms });
    return s;
  }
  const ratingWord = (r) => t(r >= 9 ? 'r_excellent' : r >= 8.5 ? 'r_vgood' : r >= 7.5 ? 'r_good' : 'r_fair');
  const isHotels = () => state.tab === 'hotels';
  // ---------- Rasmlar (images/ papkasi) ----------
  // Mehmonxonalar o'ylab topilgan, shuning uchun umumiy rasmlar: shahar mehmonxonasi yoki kurort (id bo'yicha tanlanadi)
  const CITY_HOTELS = ['tbilisi', 'baku', 'dubai', 'sharjah', 'kl', 'naftalan', 'gabala'];
  const countryPhoto = (id) => 'images/country-' + id + '.jpg';
  function hotelPhoto(h) {
    const n = parseInt(h.id.replace(/\D/g, ''), 10) || 0;
    return CITY_HOTELS.indexOf(h.city) >= 0 ? 'images/hotel-city-' + (n % 2 + 1) + '.jpg' : 'images/hotel-resort-' + (n % 4 + 1) + '.jpg';
  }
  // Aviachiptalar: tanlangan yo'nalish (agentlik davlatlaridan) va qaytish sanasi (har doim uchishdan keyin)
  function fDest() {
    const my = myList();
    return my.indexOf(state.fTo) >= 0 ? state.fTo : destList()[0];
  }
  const retDate = () => (state.fRet > state.date ? state.fRet : dt.addDays(state.date, 7));

  // Bron qilingan kunlar: { '2026-11-25': ['Rixos Premium', ...] }
  // Tur / mehmonxona — yashash kunlari (kirish kunidan boshlab), aviachipta — uchish va qaytish kunlari.
  function bookedDays() {
    const days = {};
    const add = (iso, title) => { if (dt.isValid(iso)) (days[iso] = days[iso] || []).push(title); };
    state.booked.forEach(b => {
      const p = b.key.split('|');
      if (p[0] === 'F') { add(p[5], b.title); if (p[6]) add(p[6], b.title); return; }
      const n = Math.max(1, Math.min(60, +p[3] || 1));
      if (dt.isValid(p[2])) for (let i = 0; i < n; i++) add(dt.addDays(p[2], i), b.title);
    });
    return days;
  }
  // Sana maydoni: bosilganda aylanma tanlagich ochiladi
  function dateButton(id, field, value, label) {
    const busy = bookedDays()[value];
    return `
    <div class="field f-date"${field === 'fRet' ? ' data-key="ret"' : ''}>
      <label for="${id}" class="label">${esc(label)}</label>
      <button type="button" id="${id}" class="input date-btn" data-action="pickDate" data-arg="${field}" aria-haspopup="dialog">
        ${I.cal}<span class="grow ellipsis">${esc(fmtLong(value))}</span>${busy ? '<i class="date-dot" aria-hidden="true"></i>' : ''}
      </button>
    </div>`;
  }
  const daysBetween = (a, b) => Math.round((dt.parse(b) - dt.parse(a)) / 86400000);
  const pad2 = (n) => String(n).padStart(2, '0');
  const hm = (m) => pad2(Math.floor(m / 60)) + ':' + pad2(m % 60);
  const durLabel = (m) => t('dur', { h: Math.floor(m / 60), m: pad2(m % 60) });
  const airportLabel = (to) => cityName(D.AIRPORTS[to].city) + ' (' + D.AIRPORTS[to].code + ')';
  const fromAirport = (id) => fromName(id) + ' (' + (D.FROM.find(f => f.id === id) || D.FROM[0]).code + ')';
  const bookable = (o) => o.avail !== 'stop';
  const actionLabel = (o, small) => (o.avail === 'req' ? t(small ? 'request_sm' : 'request') : t(small ? 'book_sm' : 'book'));

  function passOffer(o, cap) {
    if (state.ops[o.op.id] === false) return false;
    if (state.meals[o.meal] === false) return false;
    if (state.onlyAvail && !(o.avail === 'ok' || o.avail === 'few')) return false;
    if (state.instant && !o.instant) return false;
    if (o.price > cap) return false;
    return true;
  }

  function setMy(list) {
    const next = ALL_IDS.filter(id => list.indexOf(id) >= 0);
    if (!next.length) { setState({ note: t('n_last_country') }); return; }  // kamida bitta davlat qolishi kerak
    store.set('myCountries', next);
    const keep = destList().filter(id => next.indexOf(id) >= 0);
    setState({ my: next, dests: keep.length ? keep : [next[0]], cities: {}, maxPrice: null, open: {} });
  }

  // ---------- Ikonkalar ----------
  const svg = (size, body, sw) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw || 2}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  const I = {
    // Logo (images/logo-horizontal.png?v=20261120a — asl logo: images/logo.png)
    logo: '<img class="logo-brand" src="images/logo-horizontal.png?v=20261120a" width="160" height="40" alt="TezBooking">',
    check: svg(12, '<path d="M5 12.5 10 17l9-10"></path>', 3.5),
    search: svg(18, '<circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path>', 2.4),
    plus: svg(18, '<path d="M12 5v14M5 12h14"></path>', 2.4),
    ext: svg(15, '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"></path>', 2.2),
    user: svg(16, '<circle cx="12" cy="8" r="4"></circle><path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6"></path>', 2.2),
    lock: svg(22, '<rect x="4.5" y="10.5" width="15" height="10" rx="2.5"></rect><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"></path>'),
    cal: svg(18, '<rect x="3.5" y="5" width="17" height="15.5" rx="3"></rect><path d="M3.5 10h17M8 3v4M16 3v4"></path>'),
    sliders: svg(18, '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"></path><circle cx="16" cy="6" r="2"></circle><circle cx="10" cy="12" r="2"></circle><circle cx="18" cy="18" r="2"></circle>'),
    pin: svg(15, '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"></path><circle cx="12" cy="9.5" r="2.5"></circle>'),
    bolt: svg(12, '<path d="M13 3 5 14h6l-1 7 8-11h-6z"></path>', 2.4),
    close: svg(18, '<path d="M6 6l12 12M18 6 6 18"></path>', 2.2),
    menu: svg(22, '<path d="M4 7h16M4 12h16M4 17h16"></path>', 2.2),
    sun: svg(18, '<circle cx="12" cy="12" r="4"></circle><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"></path>', 2.2),
    moon: svg(18, '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"></path>', 2.2)
  };
  const theme = () => (window.TezTheme ? window.TezTheme.get() : 'light');
  // Mavzu almashsa (tugma yoki qurilma sozlamasi) — tugma belgisi yangilanadi
  document.addEventListener('tez:theme', () => { if (typeof render === 'function') render(); });

  // ---------- Hisoblash: holatdan ko'rinish uchun ma'lumot ----------
  let offerIndex = {}; // taklif kaliti -> { h, o }
  const query = () => ({ from: state.from, nights: state.nights, adults: state.adults, childAges: state.childAges, rooms: state.rooms, noFlight: isHotels() });

  function compute() {
    const vm = state.tab === 'flights' ? computeFlights() : computeTours();
    // Mijozga taklif (barcha bo'limlar uchun umumiy)
    vm.offerItems = state.offer.map((x, i) => Object.assign({ n: i + 1, key: x.key }, offerView(x)));
    const cps = state.offer.map(x => clientP(x.price));
    vm.range = cps.length ? money(Math.min.apply(null, cps)) + (cps.length > 1 ? ' – ' + money(Math.max.apply(null, cps)) : '') : '';
    vm.panelOpen = state.panel && state.offer.length > 0;
    return vm;
  }

  // Taklif kartasi va matni uchun: sarlavha, qatorlar, narx izohi
  function offerView(x) {
    const kind = x.product || 'tour';
    const guests = guestsLabel(x.adults, x.childAges, x.rooms || 1);
    if (kind === 'flight') {
      const fromC = fromAirport(x.from), toC = airportLabel(x.to);
      const leg = (l, no, a, b) => t(l === x.out ? 'leg_out' : 'leg_back') + ': ' + no + ' · ' + wd(l.date) + ', ' + fmtDay(l.date) + ' · ' +
        a + ' ' + hm(l.dep) + ' → ' + b + ' ' + hm(l.arr) + (l.days > 0 ? ' (+' + l.days + ')' : '') + ' · ' + (l.via ? t('stop_via', { c: l.via }) : t('direct'));
      const lines = [leg(x.out, x.no, x.fromCode, x.toCode)];
      if (x.back) lines.push(leg(x.back, x.backNo, x.toCode, x.fromCode));
      lines.push(t('cabin_' + x.cabin) + ' · ' + t('bag_' + x.bag) + ' · ' + guests);
      return {
        kind, title: fromC + ' → ' + toC, stars: '', lines, photo: countryPhoto(x.to),
        price: money(clientP(x.price)), net: money(x.price), op: x.airline, priceNote: 'ot_price_f'
      };
    }
    const h = D.HOTEL_BY_ID[x.hotelId], op = D.OPS.find(o => o.id === x.opId);
    const dates = fmtDay(x.date) + ' – ' + fmtDay(dt.addDays(x.date, x.nights)) + ' · ' + t('nights_n', { n: x.nights });
    return {
      kind, title: h.name, stars: '★'.repeat(h.stars), photo: hotelPhoto(h),
      lines: [cityName(h.city) + ', ' + countryName(h.country), dates + (kind === 'hotel' ? ' · ' + t('hotel_only') : ''),
        mealLong(x.meal) + ' · ' + roomName(x.room) + ' · ' + guests],
      price: money(clientP(x.price)), net: money(x.price), op: op.name, priceNote: kind === 'hotel' ? 'ot_price_h' : 'ot_price'
    };
  }

  // ---------- Aviachiptalar ----------
  function passFlight(f) {
    if (state.fAir[f.al.id] === false) return false;
    if (state.fDirect && f.direct !== true) return false;
    if (state.fBag && !['b20', 'b23', 'b2x32'].includes(f.bag)) return false;
    return true;
  }

  function computeFlights() {
    const my = myList();
    const to = fDest();
    const ap = D.AIRPORTS[to];
    const rt = state.trip === 'rt';
    const ret = rt ? retDate() : null;
    const fq = flightQ;
    const liveMode = isLiveF();
    const flightsOn = (q, d) => (liveMode ? D.live.flights(q, d) : D.flightsFor(q, d));
    const all = flightsOn(fq(0), state.date);
    offerIndex = {};
    all.forEach(f => { offerIndex[f.key] = { f }; });

    const list = all.filter(passFlight);
    const total = (f) => f.out.dur + (f.back ? f.back.dur : 0);
    if (state.fSort === 'dur') list.sort((a, b) => total(a) - total(b) || a.price - b.price);
    else if (state.fSort === 'dep') list.sort((a, b) => a.out.dep - b.out.dep || a.price - b.price);
    else list.sort((a, b) => a.price - b.price);
    const minPrice = list.length ? Math.min.apply(null, list.map(f => f.price)) : 0;
    const pax = state.adults + children();
    const paxLabel = guestsLabel(state.adults, state.childAges, 1);
    const fromC = fromName(state.from), toC = cityName(ap.city);
    const inOffer = (k) => state.offer.some(x => x.key === k);
    const legV = (l, no, a, b, ca, cb) => {
      const direct = l.direct === null ? null : (typeof l.direct === 'boolean' ? l.direct : !l.via);
      return {
        no, date: wd(l.date) + ', ' + fmtDay(l.date), dep: hm(l.dep), arr: hm(l.arr), plus: l.days > 0 ? '+' + l.days : '',
        dur: durLabel(l.dur),
        stops: direct === null ? t('flight_info_unknown') : direct ? t('direct') : (l.via ? t('stop_via', { c: l.via }) : t('flight_info_unknown')),
        direct, from: a, to: b, fromCity: ca, toCity: cb
      };
    };

    const flights = list.map(f => ({
      key: f.key, airline: f.al.name, color: f.al.color, no: f.no,
      // Jonli reysda shahar nomi operator javobidan (masalan, Turkiyada Antalya yoki Istanbul)
      legs: [legV(f.out, f.no, f.fromCode, f.toCode, f.fromCity || fromC, f.toCity || toC)]
        .concat(f.back ? [legV(f.back, f.backNo, f.toCode, f.fromCode, f.toCity || toC, f.fromCity || fromC)] : []),
      bag: t('bag_' + f.bag), hand: f.bag === 'hand', seatsCode: f.seats, seats: t('fseats_' + f.seats),
      price: money(shown(f.price)),
      perPerson: pax > 1 ? paxLabel + ' · ' + t('per_person', { p: money(Math.round(shown(f.price) / pax)) }) : paxLabel,
      best: f.price === minPrice, added: inOffer(f.key)
    }));

    // Sana tasmasi: ±3 kun (qaytish sanasi ham shuncha kunga suriladi)
    const dayRaw = [-3, -2, -1, 0, 1, 2, 3].map(off => {
      const d = dt.addDays(state.date, off);
      const past = d < today;
      let m = Infinity;
      if (!past) flightsOn(fq(off), d).forEach(f => { if (passFlight(f)) m = Math.min(m, f.price); });
      return { d, off, m, past };
    });
    const minDay = Math.min.apply(null, dayRaw.map(x => x.m));
    const days = dayRaw.map(x => {
      const cheapest = isFinite(x.m) && x.m === minDay;
      return {
        iso: x.d, label: wd(x.d) + ', ' + fmtDay(x.d), past: x.past, selected: x.off === 0, cheapest,
        price: isFinite(x.m) ? money(shown(x.m)) : '—',
        tag: cheapest ? t('tag_cheapest') : x.off === 0 ? t('tag_selected') : ''
      };
    });

    // Aviakompaniyalar filtri (boshqa filtrlardan qat'i nazar, shu kungi barcha reyslar bo'yicha)
    // Jonli rejimda aviakompaniyalar — operatorlar javobidagi haqiqiy nomlar
    const alList = D.AIRLINES.slice();
    all.forEach(f => { if (!alList.some(a => a.id === f.al.id)) alList.push(f.al); });
    const airlines = alList.map(al => {
      let cnt = 0, mn = Infinity;
      all.forEach(f => { if (f.al.id === al.id) { cnt++; mn = Math.min(mn, f.price); } });
      return { id: al.id, name: al.name, color: al.color, on: state.fAir[al.id] !== false, cnt, sub: t('flights_n', { n: cnt }) + (isFinite(mn) ? ' · ' + t('from_price', { p: money(shown(mn)) }) : '') };
    }).filter(a => a.cnt > 0 || !a.on);

    let active = Object.values(state.fAir).filter(v => v === false).length;
    if (state.fDirect) active++;
    if (state.fBag) active++;

    const dates = fmtDay(state.date) + (rt ? ' – ' + fmtDay(ret) : '');
    return {
      my, to, rt, ret, flights, days, airlines, active,
      destOptions: my.map(id => ({ id, label: airportLabel(id) + ' — ' + countryName(id) })),
      resultsTitle: fromC + ' → ' + toC + ': ' + t('flights_n', { n: flights.length }),
      summary: [t(rt ? 'trip_rt' : 'trip_ow'), dates, paxLabel, t('cabin_' + state.cabin)].join(' · '),
      live: liveMode ? liveFStatus() : null
    };
  }

  // ---------- Haqiqiy narxlar (server/live): operatorlardan, "Turlar" bo'limida ----------
  // Server topilsa va jonli qidiruv ishlasa — demo mehmonxonalar o'rniga operatorlarning haqiqiy takliflari ko'rsatiladi.
  let liveReady = false;
  const livePending = {};          // sig -> true (so'rov ketgan)
  const liveFailed = {};           // sig -> xato matni
  const isLive = () => liveReady && (state.tab === 'tours' || state.tab === 'hotels');
  const isLiveF = () => liveReady && state.tab === 'flights';
  const liveFPending = {}, liveFFailed = {};
  // Aviachiptalar: so'rov parametrlari (off — kunlar tasmasidagi siljish, qaytish sanasi ham shuncha suriladi)
  const flightQ = (off) => {
    const rt = state.trip === 'rt';
    return { from: state.from, to: fDest(), ret: rt ? dt.addDays(retDate(), off) : null, adults: state.adults, childAges: state.childAges, cabin: state.cabin };
  };
  function liveFStatus() {
    const e = D.live.flightEntry(flightQ(0), state.date);
    const sig = D.live.fsig(flightQ(0), state.date);
    return {
      loading: !e && !liveFFailed[sig] ? 1 : 0, done: e ? 1 : 0, failed: liveFFailed[sig] ? 1 : 0,
      ops: e ? e.ops.filter(o => o.status === 'ok').length : 0
    };
  }
  function fetchLiveFlights() {
    if (!isLiveF()) return;
    const q0 = flightQ(0);
    if (!q0.to) return;
    const sig = D.live.fsig(q0, state.date);
    if (D.live.flightEntry(q0, state.date) || liveFPending[sig] || (liveFFailed[sig] && Date.now() - liveFFailed[sig].at < 60000)) return;
    delete liveFFailed[sig];
    // Bitta so'rov — ±3 kun; javob kunlarga ajratib saqlanadi
    const offs = [-3, -2, -1, 0, 1, 2, 3].filter(n => dt.addDays(state.date, n) > today);
    const sigs = offs.map(n => D.live.fsig(flightQ(n), dt.addDays(state.date, n))).filter(s => !liveFPending[s]);
    sigs.forEach(s => { liveFPending[s] = true; });
    const params = new URLSearchParams({ to: q0.to, date: state.date, window: 3, adults: q0.adults, children: q0.childAges.join(','), from: q0.from, cabin: q0.cabin });
    if (q0.ret) params.set('ret', q0.ret);
    const base = state.date;
    sync.request('/api/live/flights?' + params, {}, 60000).then(data => {
      offs.forEach(n => {
        const d = dt.addDays(base, n), q = Object.assign({}, q0, { ret: q0.ret ? dt.addDays(q0.ret, n) : null });
        if (D.live.flightEntry(q, d) && n !== 0) return;
        D.live.setFlights(q, d, data);
      });
    }).catch(err => {
      liveFFailed[sig] = { at: Date.now(), error: err.message || 'error' };
      setTimeout(render, 61000);
    }).then(() => { sigs.forEach(s => { delete liveFPending[s]; }); render(); });
  }
  function liveStatus(dests, q) {
    let loading = 0, done = 0, failed = 0;
    const ops = {};
    dests.forEach(c => {
      const sig = D.live.sig(c, q, state.date);
      const e = D.live.entry(c, q, state.date);
      if (e) { done++; e.ops.forEach(o => { if (o.status === 'ok') ops[o.id] = (ops[o.id] || 0) + o.count; }); }
      else if (liveFailed[sig]) failed++;
      else loading++;
    });
    return { loading, done, failed, ops: Object.keys(ops).length };
  }
  function fetchLive() {
    fetchLiveFlights();
    if (!isLive()) return;
    const hotelsOnly = isHotels();
    const q = query();
    // Bitta so'rov — tanlangan kun ±3 kun; javob kunlarga ajratib saqlanadi (kunlar tasmasi ham haqiqiy narxda)
    const days = [-3, -2, -1, 0, 1, 2, 3].map(n => dt.addDays(state.date, n)).filter(d => d > today);
    destList().forEach(c => {
      const sig = D.live.sig(c, q, state.date);
      // Xato bo'lsa — darhol qayta so'ralmaydi (aks holda har chizishda so'rov ketib, limitga uriladi)
      if (D.live.entry(c, q, state.date) || livePending[sig] || (liveFailed[sig] && Date.now() - liveFailed[sig].at < 60000)) return;
      const sigs = days.map(d => D.live.sig(c, q, d)).filter(s => !livePending[s]);
      sigs.forEach(s => { livePending[s] = true; delete liveFailed[s]; });
      const params = new URLSearchParams({ country: c, date: state.date, window: 3, nights: q.nights, adults: q.adults, children: q.childAges.join(',') });
      if (!hotelsOnly) params.set('from', q.from);
      sync.request('/api/live/' + (hotelsOnly ? 'hotels' : 'tours') + '?' + params, {}, 60000).then(data => {
        days.forEach(d => {
          if (D.live.entry(c, q, d) && d !== state.date) return;
          D.live.set(c, q, d, { operators: data.operators, offers: (data.offers || []).filter(o => o.checkIn === d) });
        });
      }).catch(err => {
        liveFailed[sig] = { at: Date.now(), error: err.message || 'error' };
        setTimeout(render, 61000);
      }).then(() => { sigs.forEach(s => { delete livePending[s]; }); render(); });
    });
  }

  // ---------- Turlar va mehmonxonalar ----------
  function computeTours() {
    const my = myList();
    const dests = destList();
    const multi = dests.length > 1;
    const q = query();
    const guests = guestsLabel(state.adults, state.childAges, state.rooms);
    const liveMode = isLive();

    const hotelsAll = liveMode ? D.live.hotels(dests, q, state.date) : D.HOTELS.filter(h => dests.indexOf(h.country) >= 0);
    const rows = hotelsAll.map(h => ({ h, offers: D.offersFor(h, q, state.date) }));
    const offersByHotel = {};
    offerIndex = {};
    rows.forEach(r => { offersByHotel[r.h.id] = r.offers; r.offers.forEach(o => { offerIndex[o.key] = { h: r.h, o }; }); });
    const hotelQuery = state.hotelQuery.trim().toLowerCase();
    const hotelVisible = (h) => {
      if (!starOn(h.stars) || !cityOn(cityKey(h))) return false;
      if (!hotelQuery) return true;
      return [h.name, countryName(h.country), cityName(h.city)]
        .some(value => value.toLowerCase().includes(hotelQuery));
    };

    // Narx chegarasi (slayder): boshqa filtrlardan o'tgan takliflar bo'yicha
    let lo = Infinity, hi = 0;
    rows.forEach(r => {
      if (!hotelVisible(r.h)) return;
      r.offers.forEach(o => { if (passOffer(o, Infinity)) { lo = Math.min(lo, o.price); hi = Math.max(hi, o.price); } });
    });
    if (!isFinite(lo)) { lo = 0; hi = 1000; }
    const capMin = Math.ceil(lo / 10) * 10;
    const capMax = Math.max(capMin + 10, Math.ceil(hi / 10) * 10);
    const cap = (state.maxPrice == null || state.maxPrice > capMax) ? capMax : Math.max(state.maxPrice, capMin);

    // Filtrlash. "Eng arzon" — faqat bron qilsa bo'ladigan takliflar orasidan
    const list = rows.filter(r => hotelVisible(r.h)).map(r => {
      const pass = r.offers.filter(o => passOffer(o, cap)).sort((a, b) => a.price - b.price);
      const live = pass.filter(bookable);
      return { h: r.h, pass, live, best: live[0] || pass[0] };
    }).filter(r => r.pass.length > 0);
    const rank = (r) => (bookable(r.best) ? 0 : 1);   // sotuvi to'xtaganlar ro'yxat oxirida
    if (state.sort === 'rating') list.sort((a, b) => rank(a) - rank(b) || (b.h.rating - a.h.rating) || (a.best.price - b.best.price));
    else if (state.sort === 'stars') list.sort((a, b) => rank(a) - rank(b) || (b.h.stars - a.h.stars) || (a.best.price - b.best.price));
    else list.sort((a, b) => rank(a) - rank(b) || (a.best.price - b.best.price));

    const inOffer = (k) => state.offer.some(x => x.key === k);
    const datesLabel = fmtDay(state.date) + ' – ' + fmtDay(dt.addDays(state.date, state.nights));
    let offerTotal = 0;
    const opSet = {};

    const hotels = list.map(r => {
      const h = r.h, best = r.best, c = D.byId[h.country];
      const cheapLive = r.live[0], dearLive = r.live[r.live.length - 1];
      offerTotal += r.pass.length;
      r.pass.forEach(o => { opSet[o.op.id] = true; });
      const ordered = r.live.concat(r.pass.filter(o => !bookable(o)));
      return {
        id: h.id, name: h.name, tint: c.tint, photo: hotelPhoto(h), country: countryName(h.country), stars: h.stars,
        place: cityName(h.city) + ', ' + countryName(h.country), dates: datesLabel + ' · ' + t('nights_n', { n: state.nights }),
        rating: h.rating ? h.rating.toFixed(1) : '', ratingWord: h.rating ? ratingWord(h.rating) : '',
        live: !!h.live, tour: best.tour || '',
        meal: mealLong(best.meal), room: roomName(best.room), availCode: best.avail, avail: t('avail_' + best.avail), instant: best.instant,
        bestKey: best.key, bestOp: best.op.name, bestPrice: money(shown(best.price)), canBook: bookable(best),
        bookLabel: bookable(best) ? actionLabel(best) : t('stop_btn'),
        perPerson: children() ? guests + ' · ' + t('group_total') : guests + ' · ' + t('per_person', { p: money(Math.round(shown(best.price) / state.adults)) }),
        hasSave: r.live.length > 1 && dearLive.price > cheapLive.price,
        save: r.live.length > 1 ? money(shown(dearLive.price) - shown(cheapLive.price)) : '',
        added: inOffer(best.key), open: !!state.open[h.id],
        pills: r.live.slice(0, 3).map((o, i) => ({ op: o.op.name, color: o.op.color, price: money(shown(o.price)), best: i === 0 })),
        more: r.live.length > 3 ? t('more_ops', { n: r.live.length - 3 }) : '',
        count: r.pass.length,
        offers: ordered.map((o, i) => ({
          key: o.key, op: o.op.name, color: o.op.color, site: o.op.site, meal: mealShort(o.meal) + ' (' + o.meal + ')', room: roomName(o.room),
          availCode: o.avail, avail: t('avail_' + o.avail), seats: t('seats_' + o.seats),
          confirm: o.instant ? t('conf_instant') : t('conf_hours'), price: money(shown(o.price)),
          best: i === 0 && bookable(o), canBook: bookable(o), bookLabel: actionLabel(o, true), added: inOffer(o.key)
        }))
      };
    });

    // "Qayerga" tugmalari: agentlik davlatlari, joriy filtrlar bo'yicha eng arzon narx
    const minFor = (cid) => {
      let m = Infinity;
      (liveMode ? D.live.hotels([cid], q, state.date) : D.HOTELS).forEach(h => {
        if (h.country !== cid || !hotelVisible(h)) return;
        (offersByHotel[h.id] || D.offersFor(h, q, state.date)).forEach(o => { if (bookable(o) && passOffer(o, Infinity)) m = Math.min(m, o.price); });
      });
      return m;
    };
    const destChips = my.map(id => {
      const m = minFor(id);
      return { id, name: countryName(id), on: dests.indexOf(id) >= 0, price: isFinite(m) ? t('from_price', { p: money(shown(m)) }) : '—' };
    });

    // "Mening davlatlarim" oynasi: qidiruv barcha tillardagi nomlar bo'yicha ishlaydi
    const cq = state.cq.trim().toLowerCase();
    const matches = (c) => {
      if (!cq) return true;
      const names = Object.values(L.NAMES.countries[c.id]);
      c.cities.forEach(ct => names.push(...Object.values(L.NAMES.cities[ct])));
      return names.some(n => n.toLowerCase().indexOf(cq) >= 0);
    };
    const regions = D.REGIONS.map(rg => ({
      name: nm('regions', rg),
      items: D.COUNTRIES.filter(c => c.region === rg && matches(c)).map(c => {
        const hot = D.hotFor(c.id, state.from, today, isHotels());
        const n = D.HOTELS.filter(h => h.country === c.id).length;
        return {
          id: c.id, name: countryName(c.id), on: my.indexOf(c.id) >= 0, cities: c.cities.map(cityName).join(', '),
          meta: t('hotels_n', { n }) + (hot ? ' · ' + t('for2_from', { p: money(hot.price) }) : '')
        };
      })
    })).filter(rg => rg.items.length > 0);

    // Qaynoq takliflar: 2 kishi uchun jami narx (davlat tugmalari bilan bir xil o'lchov). Haqiqiy narxlar rejimida — yashiriladi (demo)
    const hot = liveMode ? [] : my.map(id => ({ id, best: D.hotFor(id, state.from, today, isHotels()) })).filter(x => x.best).map(x => {
      const h = D.HOTEL_BY_ID[x.best.hotelId];
      return {
        id: x.id, country: countryName(x.id), tint: D.byId[x.id].tint, photo: countryPhoto(x.id),
        date: wd(x.best.date) + ', ' + fmtDay(x.best.date) + ' · ' + t('nights_n', { n: 7 }),
        hotel: h.name + ' ' + '★'.repeat(h.stars),
        price: t('hot_price', { p: money(x.best.price) })
      };
    });

    // Sana tasmasi: tanlangan kun ±3 kun, barcha filtrlar va narx chegarasi bilan
    const dayRaw = [-3, -2, -1, 0, 1, 2, 3].map(off => {
      const d = dt.addDays(state.date, off);
      const past = d < today;
      let m = Infinity;
      if (!past) {
        hotelsAll.forEach(h => {
          if (!hotelVisible(h)) return;
          D.offersFor(h, q, d).forEach(o => { if (bookable(o) && passOffer(o, cap)) m = Math.min(m, o.price); });
        });
      }
      return { d, off, m, past };
    });
    const minDay = Math.min.apply(null, dayRaw.map(x => x.m));
    const days = dayRaw.map(x => {
      const cheapest = isFinite(x.m) && x.m === minDay;
      return {
        iso: x.d, label: wd(x.d) + ', ' + fmtDay(x.d), past: x.past, selected: x.off === 0, cheapest,
        price: isFinite(x.m) ? money(shown(x.m)) : '—',
        tag: cheapest ? t('tag_cheapest') : x.off === 0 ? t('tag_selected') : ''
      };
    });

    // Operatorlar filtri. Jonli rejimda: haqiqiy narx bergan operatorlar "demo" belgisisiz
    const liveOps = {};
    if (liveMode) dests.forEach(c => { const e = D.live.entry(c, q, state.date); if (e) e.ops.forEach(x => { if (x.status === 'ok') liveOps[x.id] = true; }); });
    const ops = D.OPS.map(o => {
      let cnt = 0, mn = Infinity;
      rows.forEach(r => {
        if (!hotelVisible(r.h)) return;
        r.offers.forEach(x => { if (x.op.id === o.id) { cnt++; mn = Math.min(mn, x.price); } });
      });
      return { id: o.id, name: o.name, color: o.color, site: o.site, sys: o.sys, live: o.live || !!liveOps[o.id], cnt, on: state.ops[o.id] !== false,
        sub: t('offers_n', { n: cnt }) + (isFinite(mn) ? ' · ' + t('from_price', { p: money(shown(mn)) }) : '') };
    }).sort((a, b) => b.cnt - a.cnt);    // ko'p taklif berganlari tepada

    const cityChecks = [];
    dests.forEach(id => D.byId[id].cities.forEach(city => {
      const k = id + ':' + city;
      cityChecks.push({ key: k, label: cityName(city), sub: multi ? countryName(id) : '', on: cityOn(k) });
    }));

    // Faol filtrlar soni (telefondagi "Filtrlar" tugmasi uchun)
    let active = 0;
    ['ops', 'stars', 'meals'].forEach(k => { active += Object.values(state[k]).filter(v => v === false).length; });
    active += cityChecks.filter(c => !c.on).length;
    if (state.onlyAvail) active++;
    if (state.instant) active++;
    if (state.maxPrice != null && cap < capMax) active++;
    if (hotelQuery) active++;

    const destNames = dests.map(countryName);
    const summary = [
      multi ? destNames.join(', ') : null,
      isHotels() ? t('hotel_only') : fromForm(state.from), datesLabel, t('nights_n', { n: state.nights }), guests,
      t('ops_offers', { ops: t('ops_from', { n: Object.keys(opSet).length }), offers: t('offers_n', { n: offerTotal }) })
    ].filter(Boolean).join(' · ');

    return {
      my, dests, multi, destChips, allDestsOn: dests.length === my.length,
      regions, hot, days, ops, cityChecks, capMin, capMax, cap, active, hotels,
      resultsTitle: (multi ? t('countries_n', { n: dests.length }) : destNames[0]) + ': ' + t('hotels_n', { n: hotels.length }),
      summary,
      live: liveMode ? liveStatus(dests, q) : null
    };
  }

  // ---------- Ko'rinish (HTML) ----------
  function viewHeader() {
    const seg = (action, items, current, label) => `
        <div class="seg-dark" role="group" aria-label="${esc(label)}">
          ${items.map(x => `<button type="button" data-action="${action}" data-arg="${x.id}" aria-pressed="${current === x.id}"${x.lang ? ` lang="${x.lang}" title="${esc(x.title)}"` : ''}>${x.text}</button>`).join('')}
        </div>`;
    return `
<header class="topbar${state.menuOpen ? ' menu-open' : ''}" id="top">
  <div class="container topbar-inner">
    <a href="#top" class="logo" aria-label="TezBooking">${I.logo}</a>
    <button type="button" class="menu-btn" data-action="menu" aria-expanded="${state.menuOpen}" aria-controls="top-menu" aria-label="${esc(t('menu_btn'))}">${I.menu}</button>
    <div class="top-menu" id="top-menu">
      <nav class="nav" aria-label="${esc(t('aria_menu'))}">
        ${[['tours', 'nav_tours'], ['hotels', 'nav_hotels'], ['flights', 'nav_flights']].map(([id, key]) => `
        <button type="button" data-action="tab" data-arg="${id}"${state.tab === id ? ' aria-current="page"' : ''}>${esc(t(key))}</button>`).join('')}
        <button type="button" data-action="navOffers">${esc(t('nav_offers'))}${state.offer.length ? ` <span class="count">${state.offer.length}</span>` : ''}</button>
      </nav>
      <div class="topbar-right">
        ${seg('lang', L.LANGS.map(l => ({ id: l.id, text: l.short, lang: l.id, title: l.label })), state.lang, t('aria_lang'))}
        ${seg('cur', [{ id: 'USD', text: 'USD' }, { id: 'UZS', text: 'UZS' }], state.cur, t('aria_currency'))}
        <button type="button" class="theme-btn" data-action="theme" aria-label="${esc(t(theme() === 'dark' ? 'theme_light' : 'theme_dark'))}" title="${esc(t(theme() === 'dark' ? 'theme_light' : 'theme_dark'))}">${theme() === 'dark' ? I.sun : I.moon}</button>
        ${viewAccountBtn()}
        <span class="badge-demo">${esc(t('demo_badge'))}</span>
      </div>
    </div>
  </div>
</header>`;
  }

  // Yuqori panel: "Kirish" yoki firma nomi + tarif holati
  function viewAccountBtn() {
    const a = account();
    if (!a.available) return '';
    if (!a.loggedIn) return `<button type="button" class="btn btn-accent btn-sm acc-top" data-action="account">${I.user}<span>${esc(t('acc_login'))}</span></button>`;
    const status = a.canBook ? t('plan_until', { d: window.TezAccount.dateOf(a.agency.paidUntil) }) : a.pending ? t('plan_pending') : t('plan_none');
    return `<button type="button" class="acc-top acc-top-in" data-action="account" aria-haspopup="dialog">
      <span class="acc-dot${a.canBook ? ' on' : ''}" aria-hidden="true"></span>
      <span class="acc-top-text"><b class="ellipsis">${esc(a.agency.name)}</b><span>${esc(status)}</span></span>
    </button>`;
  }

  function viewSettings(vm) {
    return `
  <div id="my-countries" class="settings" data-key="settings">
    <div class="row-between" style="align-items:flex-start">
      <div class="grow" style="flex-basis:320px">
        <h2 class="h2">${esc(t('settings_title'))}</h2>
        <p class="muted" style="margin:4px 0 0;font-size:14px">${esc(t('settings_desc'))}</p>
      </div>
      <div class="btn-row">
        <button type="button" class="btn" data-action="selectAllMy">${esc(t('select_all'))}</button>
        <button type="button" class="btn btn-dark" data-action="closeSettings">${esc(t('done'))}</button>
      </div>
    </div>
    <div class="settings-tools">
      <label for="f-csearch" class="sr-only">${esc(t('search_country'))}</label>
      <input id="f-csearch" class="input" type="search" placeholder="${esc(t('country_ph'))}" value="${esc(state.cq)}" data-input="cq" autocomplete="off">
      <span class="muted" style="font-size:14px">${esc(t('selected_count', { a: vm.my.length, b: D.COUNTRIES.length }))}</span>
    </div>
    ${vm.regions.map(r => `
    <fieldset data-key="${esc(r.name)}">
      <legend>${esc(r.name)}</legend>
      <div class="country-grid">
        ${r.items.map(m => `
        <label class="country-card${m.on ? ' on' : ''}" data-key="${m.id}">
          <input type="checkbox" data-change="my" data-arg="${m.id}"${m.on ? ' checked' : ''}>
          <span><span class="t">${esc(m.name)}</span><span class="s">${esc(m.cities)}</span><span class="s">${esc(m.meta)}</span></span>
        </label>`).join('')}
      </div>
    </fieldset>`).join('')}
    ${vm.regions.length ? '' : `<p class="muted" style="margin:0;font-size:14px">${esc(t('no_country', { q: state.cq }))}</p>`}
    <p class="muted small" style="margin:0">${esc(t('settings_note'))}</p>
  </div>`;
  }

  function viewGuests(noRooms) {
    const a = state.adults, c = children(), r = state.rooms;
    const stepper = (groupKey, value, dec, inc, decKey, incKey, decOff, incOff) => `
        <div class="stepper" role="group" aria-label="${esc(t(groupKey))}">
          <button type="button" data-action="${dec}" aria-label="${esc(t(decKey))}"${decOff ? ' disabled' : ''}>−</button>
          <span>${esc(value)}</span>
          <button type="button" data-action="${inc}" aria-label="${esc(t(incKey))}"${incOff ? ' disabled' : ''}>+</button>
        </div>`;
    const ageOptions = (sel) => Array.from({ length: 18 }, (_, n) => `<option value="${n}"${n === sel ? ' selected' : ''}>${esc(n === 0 ? t('age_under1') : t('age_n', { n }))}</option>`).join('');
    return `
    <div class="field f-guests">
      <span class="label">${esc(t(noRooms ? 'f_pax' : 'f_guests'))}</span>
      <div class="steppers">
        ${stepper('adults_group', t('adults_n', { n: a }), 'decA', 'incA', 'dec_adults', 'inc_adults', a <= 1, a >= MAX_ADULTS)}
        ${stepper('children_group', t('children_n', { n: c }), 'decC', 'incC', 'dec_children', 'inc_children', c <= 0, c >= MAX_CHILDREN)}
        ${noRooms ? '' : stepper('rooms_group', t('rooms_n', { n: r }), 'decR', 'incR', 'dec_rooms', 'inc_rooms', r <= minRooms(a), r >= Math.min(MAX_ROOMS, a))}
      </div>
      ${c ? `<div class="ages">${state.childAges.map((age, i) => `
        <label class="age" for="f-age-${i}"><span class="label">${esc(t('child_age', { i: i + 1 }))}</span>
          <select id="f-age-${i}" class="input input-sm" data-change="age" data-arg="${i}">${ageOptions(age)}</select>
        </label>`).join('')}</div>` : ''}
    </div>`;
  }

  function viewSearch(vm) {
    const hOnly = isHotels();
    const fromField = hOnly ? '' : `
    <div class="field">
      <label for="f-from" class="label">${esc(t('f_from'))}</label>
      <select id="f-from" class="input" data-change="from">
        ${D.FROM.map(f => `<option value="${f.id}"${f.id === state.from ? ' selected' : ''}>${esc(fromName(f.id))}</option>`).join('')}
      </select>
    </div>`;
    return `
<section class="card search" aria-labelledby="h-search" data-key="search-${state.tab}">
  <div class="search-hero" style="background-image:url('${hOnly ? 'images/hotel-resort-1.jpg' : countryPhoto(vm.dests[0])}')">
    <h1 id="h-search">${esc(t(hOnly ? 'h1_h' : 'h1'))}</h1>
    <p class="lead">${esc(t(hOnly ? 'lead_h' : 'lead', { n: D.OPS.length }))}</p>
  </div>
  <div class="row-between">
    <span id="l-dest" class="label">${esc(t('dest_label'))}</span>
    <button type="button" class="btn" data-action="toggleSettings" aria-expanded="${state.settings}" aria-controls="my-countries">${I.plus}<span>${esc(t('my_countries'))}</span></button>
  </div>
  <div class="chips" role="group" aria-labelledby="l-dest">
    <button type="button" class="chip chip-all" data-action="allDests" aria-pressed="${vm.allDestsOn}">${esc(t('all'))}</button>
    ${vm.destChips.map(c => `
    <button type="button" class="chip" data-action="dest" data-arg="${c.id}" data-key="${c.id}" aria-pressed="${c.on}">
      <span class="tick" aria-hidden="true">${I.check}</span>
      <span class="name">${esc(c.name)}</span>
      <span class="price">${esc(c.price)}</span>
    </button>`).join('')}
  </div>
  ${state.settings ? viewSettings(vm) : ''}
  <div class="fields">
    ${fromField}
    ${dateButton('f-date', 'date', state.date, t(hOnly ? 'f_checkin' : 'f_date'))}
    <div class="field f-nights">
      <label for="f-nights" class="label">${esc(t('f_nights'))}</label>
      <select id="f-nights" class="input" data-change="nights">
        ${NIGHTS.map(n => `<option value="${n}"${n === state.nights ? ' selected' : ''}>${esc(t('nights_n', { n }))}</option>`).join('')}
      </select>
    </div>
    ${viewGuests()}
    <a href="#natijalar" class="btn btn-accent search-btn">${I.search} ${esc(t(hOnly ? 'search_btn_h' : 'search_btn'))}</a>
  </div>
</section>`;
  }

  function viewFlightSearch(vm) {
    const seg = (action, items, current, label) => `
    <div class="seg" role="group" aria-label="${esc(label)}">${items.map(o => `<button type="button" data-action="${action}" data-arg="${o.id}" aria-pressed="${current === o.id}">${esc(o.label)}</button>`).join('')}</div>`;
    return `
<section class="card search" aria-labelledby="h-search" data-key="search-flights">
  <div class="search-hero" style="background-image:url('images/flight-plane.jpg');background-position:center 42%">
    <h1 id="h-search">${esc(t('h1_f'))}</h1>
    <p class="lead">${esc(t('lead_f', { n: D.AIRLINES.length }))}</p>
  </div>
  <div class="seg-group">
    ${seg('trip', [{ id: 'rt', label: t('trip_rt') }, { id: 'ow', label: t('trip_ow') }], state.trip, t('trip_label'))}
    ${seg('cabin', [{ id: 'eco', label: t('cabin_eco') }, { id: 'bus', label: t('cabin_bus') }], state.cabin, t('cabin_label'))}
  </div>
  <div class="fields">
    <div class="field">
      <label for="f-from" class="label">${esc(t('f_from'))}</label>
      <select id="f-from" class="input" data-change="from">
        ${D.FROM.map(f => `<option value="${f.id}"${f.id === state.from ? ' selected' : ''}>${esc(fromAirport(f.id))}</option>`).join('')}
      </select>
    </div>
    <div class="field f-to">
      <label for="f-to" class="label">${esc(t('f_to'))}</label>
      <select id="f-to" class="input" data-change="fTo">
        ${vm.destOptions.map(o => `<option value="${o.id}"${o.id === vm.to ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}
      </select>
    </div>
    ${dateButton('f-date', 'date', state.date, t('f_date'))}
    ${vm.rt ? dateButton('f-ret', 'fRet', vm.ret, t('f_ret')) : ''}
    ${viewGuests(true)}
    <a href="#natijalar" class="btn btn-accent search-btn">${I.search} ${esc(t('search_btn_f'))}</a>
  </div>
</section>`;
  }

  function viewFlightFilters(vm) {
    const check = (change, on, label) => `
      <label class="check" data-key="${change}"><input type="checkbox" data-change="${change}"${on ? ' checked' : ''}><span>${esc(label)}</span></label>`;
    return `
<aside id="filters" class="card filters${state.filtersOpen ? ' open' : ''}" aria-label="${esc(t('filters'))}" data-key="ffilters">
  <div class="row-between">
    <h2 class="h2" style="font-size:18px">${esc(t('filters'))}</h2>
    <button type="button" class="btn-link" data-action="fReset">${esc(t('reset'))}</button>
  </div>
  <fieldset>
    <legend>${esc(t('f_airlines'))}</legend>
    ${vm.airlines.map(a => `
    <label class="check op-check" data-key="${a.id}">
      <input type="checkbox" data-change="fAir" data-arg="${a.id}"${a.on ? ' checked' : ''}>
      <span class="dot" style="background:${a.color}" aria-hidden="true"></span>
      <span class="grow"><span class="op-name">${esc(a.name)}</span><span class="op-sub">${esc(a.sub)}</span></span>
    </label>`).join('')}
  </fieldset>
  <fieldset>
    <legend>${esc(t('f_more'))}</legend>
    ${check('fDirect', state.fDirect, t('direct_only'))}
    ${check('fBag', state.fBag, t('bag_only'))}
  </fieldset>
</aside>`;
  }

  function viewFlight(f) {
    const leg = (l, i) => `
      <div class="leg">
        <span class="leg-kind xs bold muted">${esc(t(i === 0 ? 'leg_out' : 'leg_back'))} · ${esc(l.no)} · ${esc(l.date)}</span>
        <div class="leg-row">
          <div class="leg-pt"><span class="time">${esc(l.dep)}</span><span class="xs muted">${esc(l.from)} · ${esc(l.fromCity)}</span></div>
          <div class="leg-mid">
            <span class="xs muted">${esc(l.dur)}</span>
            <span class="leg-line${l.direct === false ? ' stop' : ''}" aria-hidden="true"></span>
            <span class="xs ${l.direct ? 'leg-direct' : 'muted'}">${esc(l.stops)}</span>
          </div>
          <div class="leg-pt end"><span class="time">${esc(l.arr)}${l.plus ? `<sup>${esc(l.plus)}</sup>` : ''}</span><span class="xs muted">${esc(l.to)} · ${esc(l.toCity)}</span></div>
        </div>
      </div>`;
    return `
<article class="hotel flight" data-key="${esc(f.key)}">
  <div class="hotel-main">
    <div class="hotel-info">
      <div class="meta">
        <span class="airline"><span class="dot" style="background:${f.color}" aria-hidden="true"></span>${esc(f.airline)}</span>
        ${f.best ? `<span class="pill best-pill">${esc(t('tag_best'))}</span>` : ''}
      </div>
      ${f.legs.map(leg).join('')}
      <div class="pills">
        <span class="pill${f.hand ? ' av-few' : ''}">${esc(f.bag)}</span>
        <span class="pill av-${f.seatsCode}">${esc(f.seats)}</span>
        <span class="pill">${esc(t('cabin_' + state.cabin))}</span>
      </div>
    </div>
    <div class="price-box">
      <span class="xs muted">${esc(t(f.legs.length > 1 ? 'price_rt' : 'price_ow'))}</span>
      <span class="big-price">${esc(f.price)}</span>
      <span class="xs muted">${esc(f.perPerson)}</span>
      <div class="actions">
        <button type="button" class="btn" data-action="book" data-arg="${esc(f.key)}">${esc(t('book'))}</button>
        <button type="button" class="btn btn-accent btn-add" data-action="add" data-arg="${esc(f.key)}" aria-pressed="${f.added}">${esc(f.added ? t('in_offer') : t('add_offer'))}</button>
      </div>
    </div>
  </div>
</article>`;
  }

  // Tarif yo'q bo'lsa natijalar tepasida: "Bron qilish uchun tarifni sotib oling"
  function viewGate() {
    const a = account();
    if (a.canBook || !syncChecked) return '';      // server hali tekshirilmoqda — xabar miltillamasin
    const text = !a.available ? t('acc_need_server') : !a.loggedIn ? t('gate_login') : a.pending ? t('gate_pending') : t('gate_text');
    return `
  <div class="gate" data-key="gate" role="note">
    <span class="gate-ico" aria-hidden="true">${I.lock}</span>
    <div class="grow"><b>${esc(t('gate_title'))}</b><p>${esc(text)}</p></div>
    ${a.available ? `<button type="button" class="btn btn-accent" data-action="account">${esc(t(a.loggedIn ? 'gate_btn' : 'acc_login'))}</button>` : ''}
  </div>`;
  }
  // Akkaunt holati (js/account.js); server bo'lmasa — available: false
  function account() {
    const A = window.TezAccount, i = A ? A.info() : null;
    if (!i || !i.available) return { available: false, loggedIn: false, canBook: false };
    return { available: true, loggedIn: i.loggedIn, agency: i.agency, canBook: A.canBook(), pending: i.pending.length > 0 };
  }

  function viewFlightResults(vm) {
    const seg = (action, items, current) => items.map(o => `<button type="button" data-action="${action}" data-arg="${o.id}" aria-pressed="${current === o.id}">${esc(o.label)}</button>`).join('');
    return `
<section id="natijalar" class="results" aria-labelledby="h-results" data-key="fresults">
  <div class="results-head">
    <div style="min-width:0">
      <h2 id="h-results" tabindex="-1">${esc(vm.resultsTitle)}</h2>
      <p>${esc(vm.summary)}</p>
    </div>
    <div class="seg-group">
      <div class="seg" role="group" aria-label="${esc(t('sort_label'))}">${seg('fSort', [{ id: 'price', label: t('sort_price') }, { id: 'dur', label: t('sort_dur') }, { id: 'dep', label: t('sort_dep') }], state.fSort)}</div>
      <div class="seg" role="group" aria-label="${esc(t('price_type'))}">${seg('mode', [{ id: 'net', label: t('mode_net') }, { id: 'client', label: t('mode_client', { m: MARKUP }) }], state.mode)}</div>
    </div>
  </div>
  ${vm.live ? `
  <p class="live-note${vm.live.loading ? ' loading' : ''}" data-key="live-note" role="status">
    <span class="live-dot" aria-hidden="true"></span>
    ${esc(vm.live.loading ? t('live_loading') : vm.live.failed && !vm.live.done ? t('live_failed') : t('live_note_f', { n: vm.live.ops }))}
  </p>` : `<p class="demo-note">${esc(t('demo_note_f'))}</p>`}
  ${viewGate()}
  ${vm.flights.map(viewFlight).join('')}
  ${vm.flights.length || (vm.live && vm.live.loading) ? '' : vm.live ? `
  <div class="empty" data-key="empty-live">
    <p class="bold" style="font-size:17px">${esc(t('live_empty_title_f'))}</p>
    <p class="muted" style="margin:6px 0 14px;font-size:14px">${esc(t('live_empty_text_f'))}</p>
  </div>` : `
  <div class="empty" data-key="empty">
    <p class="bold" style="font-size:17px">${esc(t('empty_title_f'))}</p>
    <p class="muted" style="margin:6px 0 14px;font-size:14px">${esc(t('empty_text_f'))}</p>
    <button type="button" class="btn btn-dark" data-action="fReset">${esc(t('empty_btn'))}</button>
  </div>`}
</section>`;
  }

  function viewHot(vm) {
    return `
<section class="section" aria-labelledby="h-hot">
  <div class="row-between" style="align-items:baseline">
    <h2 id="h-hot" class="h2">${esc(t('hot_title'))}</h2>
    <span class="small muted">${esc(isHotels() ? t('hot_sub_h') : t('hot_sub', { from: fromForm(state.from) }))}</span>
  </div>
  <div class="hot-grid">
    ${vm.hot.map(h => `
    <button type="button" class="hot" data-action="hot" data-arg="${h.id}" data-key="${h.id}">
      <img class="hot-img" src="${h.photo}" alt="" loading="lazy" style="background:${h.tint}">
      <span class="c"><span class="sw" style="background:${h.tint}" aria-hidden="true"></span>${esc(h.country)}</span>
      <span class="muted">${esc(h.date)}</span>
      <span class="muted ellipsis">${esc(h.hotel)}</span>
      <span class="p">${esc(h.price)}</span>
    </button>`).join('')}
  </div>
</section>`;
  }

  function viewDays(vm) {
    return `
<section class="section" aria-labelledby="h-days">
  <h2 id="h-days" class="h2">${esc(t('days_title'))} <span class="muted" style="font-family:var(--font);font-weight:500;font-size:13px">${esc(t('days_sub'))}</span></h2>
  <div class="days">
    ${vm.days.map(d => `
    <button type="button" class="day${d.selected ? ' selected' : d.cheapest ? ' cheapest' : ''}" data-action="day" data-arg="${d.iso}" data-key="${d.iso}" aria-pressed="${d.selected}"${d.past ? ' disabled' : ''}>
      <span class="d">${esc(d.label)}</span>
      <span class="p">${esc(d.price)}</span>
      <span class="tag">${d.tag ? esc(d.tag) : '&nbsp;'}</span>
    </button>`).join('')}
  </div>
</section>`;
  }

  function viewFilters(vm) {
    const check = (change, arg, on, label, key) => `
      <label class="check"${key ? ` data-key="${esc(key)}"` : ''}><input type="checkbox" data-change="${change}"${arg != null ? ` data-arg="${esc(arg)}"` : ''}${on ? ' checked' : ''}><span>${label}</span></label>`;
    return `
<aside id="filters" class="card filters${state.filtersOpen ? ' open' : ''}" aria-label="${esc(t('filters'))}">
  <div class="row-between">
    <h2 class="h2" style="font-size:18px">${esc(t('filters'))}</h2>
    <button type="button" class="btn-link" data-action="reset">${esc(t('reset'))}</button>
  </div>

  <div class="filter-search">
    <label for="hotel-filter" class="bold" style="font-size:14px">${esc(t('f_hotel_search'))}</label>
    <input id="hotel-filter" type="search" data-input="hotelQuery" value="${esc(state.hotelQuery)}" placeholder="${esc(t('hotel_search_ph'))}">
  </div>

  <fieldset class="ops-filter">
    <legend>${esc(t('f_ops'))} <span class="muted">(${vm.ops.length})</span></legend>
    <div class="ops-tools">
      <button type="button" class="btn-link" data-action="opsAll" data-arg="on">${esc(t('ops_all'))}</button>
      <button type="button" class="btn-link" data-action="opsAll" data-arg="off">${esc(t('ops_none'))}</button>
    </div>
    ${(state.opsMore ? vm.ops : vm.ops.slice(0, OPS_SHORT)).map(o => `
    <div class="op-row" data-key="${o.id}">
      <label class="check op-check">
        <input type="checkbox" data-change="op" data-arg="${o.id}"${o.on ? ' checked' : ''}>
        <span class="dot" style="background:${o.color}" aria-hidden="true"></span>
        <span class="grow"><span class="op-name">${esc(o.name)}${o.live ? '' : ` <span class="op-demo" title="${esc(t('op_demo_hint'))}">demo</span>`}</span><span class="op-sub">${esc(o.sub)}</span></span>
      </label>
      <a class="op-site" href="${esc(o.site)}" target="_blank" rel="noopener noreferrer" title="${esc(t('op_site', { op: o.name }))}" aria-label="${esc(t('op_site', { op: o.name }))}">${I.ext}</a>
    </div>`).join('')}
    ${vm.ops.length > OPS_SHORT ? `<button type="button" class="btn-link ops-more" data-action="opsMore" aria-expanded="${!!state.opsMore}">${esc(state.opsMore ? t('ops_less') : t('ops_more', { n: vm.ops.length - OPS_SHORT }))}</button>` : ''}
    <p class="hint">${esc(t('ops_note'))}</p>
  </fieldset>

  <div style="display:flex;flex-direction:column;gap:8px">
    <label for="f-price" class="bold" style="font-size:14px">${esc(t('f_price'))}</label>
    <input id="f-price" type="range" min="${vm.capMin}" max="${vm.capMax}" step="10" value="${vm.cap}" data-change="price">
    <div class="range-labels"><span>${esc(money(shown(vm.capMin)))}</span><strong id="cap-label">${esc(t('upto', { p: money(shown(vm.cap)) }))}</strong></div>
  </div>

  <fieldset>
    <legend>${esc(t('f_stars'))}</legend>
    <div class="star-row">
      ${[3, 4, 5].map(n => `<button type="button" class="star-btn" data-action="star" data-arg="${n}" aria-pressed="${starOn(n)}" aria-label="${esc(t('stars_aria', { n }))}">${n} ★</button>`).join('')}
    </div>
  </fieldset>

  <fieldset>
    <legend>${esc(t('f_meals'))}</legend>
    ${['BB', 'HB', 'AI', 'UAI'].map(k => check('meal', k, state.meals[k] !== false, esc(mealLong(k)), k)).join('')}
  </fieldset>

  <fieldset>
    <legend>${esc(t('f_city'))}</legend>
    ${vm.cityChecks.map(c => check('city', c.key, c.on, esc(c.label) + (c.sub ? ` <span class="muted">· ${esc(c.sub)}</span>` : ''), c.key)).join('')}
  </fieldset>

  <fieldset>
    <legend>${esc(t('f_more'))}</legend>
    ${check('onlyAvail', null, state.onlyAvail, esc(t('only_avail')), 'onlyAvail')}
    ${check('instant', null, state.instant, esc(t('instant_only')), 'instant')}  </fieldset>
</aside>`;
  }

  function viewHotel(h) {
    const hOnly = isHotels();  // faqat mehmonxona: "Reysda joy" ustuni kerak emas
    const offers = !h.open ? '' : `
  <div class="offers${hOnly ? ' no-flight' : ''}">
    <div class="offers-inner">
      <div class="orow head"><span>${esc(t('th_op'))}</span><span>${esc(t('th_meal'))}</span><span>${esc(t('th_room'))}</span><span>${esc(t('th_hotel'))}</span>${hOnly ? '' : `<span>${esc(t('th_seats'))}</span>`}<span>${esc(t('th_confirm'))}</span><span>${esc(t('th_price'))}</span><span></span></div>
      ${h.offers.map(o => `
      <div class="orow${o.best ? ' best' : ''}${o.canBook ? '' : ' stopped'}" data-key="${esc(o.key)}">
        <span class="op"><span class="dot sm" style="background:${o.color}" aria-hidden="true"></span>${esc(o.op)}${o.site ? ` <a class="op-site sm" href="${esc(o.site)}" target="_blank" rel="noopener noreferrer" title="${esc(t('op_site', { op: o.op }))}" aria-label="${esc(t('op_site', { op: o.op }))}">${I.ext}</a>` : ''}</span>
        <span>${esc(o.meal)}</span>
        <span>${esc(o.room)}</span>
        <span><span class="pill av-${o.availCode}">${esc(o.avail)}</span></span>
        ${hOnly ? '' : `<span>${esc(o.seats)}</span>`}
        <span>${esc(o.confirm)}</span>
        <span class="bold">${esc(o.price)}</span>
        <span class="acts">
          <button type="button" class="btn btn-sm" data-action="book" data-arg="${esc(o.key)}"${o.canBook ? '' : ' disabled'}>${esc(o.bookLabel)}</button>
          <button type="button" class="btn btn-sm btn-add btn-add-sm" data-action="add" data-arg="${esc(o.key)}" aria-pressed="${o.added}"${o.canBook ? '' : ' disabled'}>${esc(o.added ? t('in_offer') : t('add_sm'))}</button>
        </span>
      </div>`).join('')}
    </div>
  </div>`;
    return `
<article class="hotel" data-key="${h.id}">
  <div class="hotel-main">
    <div class="tile" style="background:${h.tint}" aria-hidden="true"><img src="${h.photo}" alt="" loading="lazy"><span>${esc(h.country)}</span></div>
    <div class="hotel-info">
      <div class="meta">
        <span class="stars" role="img" aria-label="${esc(t('stars_aria', { n: h.stars }))}">${'★'.repeat(h.stars)}</span>
        ${h.rating ? `<span class="rating">${h.rating}</span><span class="small muted">${esc(h.ratingWord)}</span>` : ''}
        ${h.live ? `<span class="live-badge" title="${esc(t('live_badge_hint'))}"><span class="live-dot" aria-hidden="true"></span>${esc(t('live_badge'))}</span>` : ''}
      </div>
      <h3>${esc(h.name)}</h3>
      <div class="place">${I.pin}<span>${esc(h.place)} · ${esc(h.dates)}</span></div>
      ${h.tour ? `<div class="xs muted live-tour">${esc(h.tour)}</div>` : ''}
      <div class="pills">
        <span class="pill">${esc(h.meal)}</span>
        <span class="pill">${esc(h.room)}</span>
        <span class="pill av-${h.availCode}">${esc(h.avail)}</span>
        ${h.instant ? `<span class="pill instant">${I.bolt}${esc(t('instant'))}</span>` : ''}
      </div>
    </div>
    <div class="price-box">
      <span class="xs muted">${esc(t('cheapest_by', { op: h.bestOp }))}</span>
      <span class="big-price">${esc(h.bestPrice)}</span>
      <span class="xs muted">${esc(h.perPerson)}</span>
      ${h.hasSave ? `<span class="save">${esc(t('op_diff', { p: h.save }))}</span>` : ''}
      <div class="actions">
        <button type="button" class="btn" data-action="book" data-arg="${esc(h.bestKey)}"${h.canBook ? '' : ' disabled'}>${esc(h.bookLabel)}</button>
        <button type="button" class="btn btn-accent btn-add" data-action="add" data-arg="${esc(h.bestKey)}" aria-pressed="${h.added}"${h.canBook ? '' : ' disabled'}>${esc(h.added ? t('in_offer') : t('add_offer'))}</button>
      </div>
    </div>
  </div>
  <div class="compare">
    <span class="small muted">${esc(t('op_prices'))}</span>
    ${h.pills.map(p => `<span class="op-pill${p.best ? ' best' : ''}"><span class="dot sm" style="background:${p.color}" aria-hidden="true"></span>${esc(p.op)} <strong>${esc(p.price)}</strong></span>`).join('')}
    ${h.more ? `<span class="small muted">${esc(h.more)}</span>` : ''}
    <button type="button" class="btn-link ml-auto" data-action="open" data-arg="${h.id}" aria-expanded="${h.open}">${esc(h.open ? t('hide') : t('all_offers', { n: h.count }))}</button>
  </div>
  ${offers}
</article>`;
  }

  function viewResults(vm) {
    const seg = (action, items, current) => items.map(o => `<button type="button" data-action="${action}" data-arg="${o.id}" aria-pressed="${current === o.id}">${esc(o.label)}</button>`).join('');
    return `
<section id="natijalar" class="results" aria-labelledby="h-results">
  <div class="results-head">
    <div style="min-width:0">
      <h2 id="h-results" tabindex="-1">${esc(vm.resultsTitle)}</h2>
      <p>${esc(vm.summary)}</p>
    </div>
    <div class="seg-group">
      <div class="seg" role="group" aria-label="${esc(t('sort_label'))}">${seg('sort', [{ id: 'price', label: t('sort_price') }, { id: 'rating', label: t('sort_rating') }, { id: 'stars', label: t('sort_stars') }], state.sort)}</div>
      <div class="seg" role="group" aria-label="${esc(t('price_type'))}">${seg('mode', [{ id: 'net', label: t('mode_net') }, { id: 'client', label: t('mode_client', { m: MARKUP }) }], state.mode)}</div>
    </div>
  </div>
  ${vm.live ? `
  <p class="live-note${vm.live.loading ? ' loading' : ''}" data-key="live-note" role="status">
    <span class="live-dot" aria-hidden="true"></span>
    ${esc(vm.live.loading ? t('live_loading') : vm.live.failed && !vm.live.done ? t('live_failed') : t('live_note', { n: vm.live.ops }))}
  </p>` : `<p class="demo-note">${esc(t(isHotels() ? 'demo_note_h' : 'demo_note'))}</p>`}
  ${viewGate()}
  ${vm.hotels.map(viewHotel).join('')}
  ${vm.hotels.length || (vm.live && vm.live.loading) ? '' : vm.live ? `
  <div class="empty" data-key="empty-live">
    <p class="bold" style="font-size:17px">${esc(t(isHotels() ? 'live_empty_title_h' : 'live_empty_title'))}</p>
    <p class="muted" style="margin:6px 0 14px;font-size:14px">${esc(t('live_empty_text'))}</p>
  </div>` : `
  <div class="empty" data-key="empty">
    <p class="bold" style="font-size:17px">${esc(t('empty_title'))}</p>
    <p class="muted" style="margin:6px 0 14px;font-size:14px">${esc(t('empty_text'))}</p>
    <button type="button" class="btn btn-dark" data-action="reset">${esc(t('empty_btn'))}</button>
  </div>`}
</section>`;
  }

  function viewDock(vm) {
    let out = '<div class="dock">';
    if (state.note) {
      out += `
  <div class="container" data-key="toast">
    <div class="toast" role="status">
      <span class="grow">${esc(state.note)}</span>
      ${state.undo ? `<button type="button" class="btn btn-sm btn-ghost" data-action="undoBook">${esc(t('undo'))}</button>` : ''}
      <button type="button" class="icon-btn" data-action="clearNote" aria-label="${esc(t('dismiss'))}">${I.close}</button>
    </div>
  </div>`;
    }
    if (vm.panelOpen) {
      const opts = t('options_n', { n: state.offer.length });
      out += `
  <section id="taklif" class="container" aria-labelledby="h-offer" data-key="panel">
    <div class="panel">
      <div class="row-between" style="align-items:flex-start;gap:12px">
        <div style="min-width:0">
          <h2 id="h-offer" tabindex="-1">${esc(t('panel_title', { x: opts }))}</h2>
          <p class="muted" style="margin:4px 0 0;font-size:14px">${esc(t('panel_desc', { m: MARKUP }))}</p>
        </div>
        <div class="btn-row">
          <button type="button" class="btn btn-blue" data-action="telegram">${esc(t('send_tg'))}</button>
          <button type="button" class="btn" data-action="copyText">${esc(t('copy_text'))}</button>
          <button type="button" class="btn" data-action="pdf">${esc(t('make_pdf'))}</button>
        </div>
      </div>
      <div class="offer-grid">
        ${vm.offerItems.map(x => `
        <div class="offer-card" data-key="${esc(x.key)}">
          <img class="offer-img" src="${x.photo}" alt="" loading="lazy">
          <div class="row-between" style="align-items:flex-start;flex-wrap:nowrap">
            <span class="xs bold muted">${esc(t('variant_n', { n: x.n }))} · ${esc(t('kind_' + x.kind))}</span>
            <button type="button" class="icon-btn remove" data-action="removeOffer" data-arg="${esc(x.key)}" aria-label="${esc(t('remove_aria', { h: x.title }))}">${I.close}</button>
          </div>
          <span class="t">${esc(x.title)}${x.stars ? ` <span class="stars" style="font-size:13px">${x.stars}</span>` : ''}</span>
          ${x.lines.map(l => `<span class="muted">${esc(l)}</span>`).join('')}
          <span class="pr">${esc(x.price)}</span>
          <span class="agent-only">${esc(t('agent_only', { p: x.net, op: x.op }))}</span>
        </div>`).join('')}
      </div>
    </div>
  </section>`;
    }
    if (state.offer.length) {
      out += `
  <div class="bar" data-key="bar" role="region" aria-label="${esc(t('nav_offers'))}">
    <div class="container">
      <strong>${esc(t('bar_title', { x: t('options_n', { n: state.offer.length }) }))}</strong>
      <span class="bar-range">${esc(t('client_range', { a: vm.range }))}</span>
      <div class="btn-row ml-auto">
        <button type="button" class="btn btn-accent" data-action="panel" aria-expanded="${vm.panelOpen}" aria-controls="taklif">${esc(vm.panelOpen ? t('hide_offer') : t('view_offer'))}</button>
        <button type="button" class="btn btn-ghost" data-action="clearOffer">${esc(t('clear'))}</button>
      </div>
    </div>
  </div>`;
    }
    return out + '</div>';
  }

  function view(vm) {
    if (state.tab === 'flights') {
      return viewHeader() +
        '<main class="container">' + viewFlightSearch(vm) + viewDays(vm) +
        `<div class="filters-bar"><button type="button" class="btn" data-action="filters" aria-expanded="${state.filtersOpen}" aria-controls="filters">${I.sliders}<span>${esc(t('filters_btn'))}</span>${vm.active ? `<span class="count">${vm.active}</span>` : ''}</button></div>` +
        '<div class="layout">' + viewFlightFilters(vm) + viewFlightResults(vm) + '</div></main>' +
        viewDock(vm);
    }
    return viewHeader() +
      '<main class="container">' + viewSearch(vm) + viewHot(vm) + viewDays(vm) +
      `<div class="filters-bar"><button type="button" class="btn" data-action="filters" aria-expanded="${state.filtersOpen}" aria-controls="filters">${I.sliders}<span>${esc(t('filters_btn'))}</span>${vm.active ? `<span class="count">${vm.active}</span>` : ''}</button></div>` +
      '<div class="layout">' + viewFilters(vm) + viewResults(vm) + '</div></main>' +
      viewDock(vm);
  }

  // ---------- DOM'ni yangilash (morph) ----------
  // Yangi HTML eski DOM bilan solishtiriladi va faqat farqlari o'zgartiriladi.
  function sameNode(a, b) {
    if (a.nodeType !== b.nodeType || a.nodeName !== b.nodeName) return false;
    if (a.nodeType !== 1) return true;
    return (a.getAttribute('data-key') || '') === (b.getAttribute('data-key') || '');
  }
  function morphChildren(from, to) {
    const next = Array.from(to.childNodes);
    for (let i = 0; i < next.length; i++) {
      const cur = from.childNodes[i];
      if (!cur) from.appendChild(next[i]);
      else if (sameNode(cur, next[i])) morphNode(cur, next[i]);
      else from.replaceChild(next[i], cur);
    }
    while (from.childNodes.length > next.length) from.removeChild(from.lastChild);
  }
  function morphNode(from, to) {
    if (from.nodeType === 3 || from.nodeType === 8) {
      if (from.nodeValue !== to.nodeValue) from.nodeValue = to.nodeValue;
      return;
    }
    Array.from(from.attributes).forEach(a => { if (!to.hasAttribute(a.name)) from.removeAttribute(a.name); });
    Array.from(to.attributes).forEach(a => { if (from.getAttribute(a.name) !== a.value) from.setAttribute(a.name, a.value); });
    const tag = from.tagName;
    if (tag === 'INPUT') {
      if (from.type === 'checkbox' || from.type === 'radio') from.checked = to.hasAttribute('checked');
      else if (from !== document.activeElement) {
        const v = to.getAttribute('value') || '';
        if (from.value !== v) from.value = v;
      }
      return;
    }
    morphChildren(from, to);
    if (tag === 'SELECT') {
      const sel = to.querySelector('option[selected]');
      if (sel && from.value !== sel.value) from.value = sel.value;
    }
  }

  const app = document.getElementById('app');
  let lastDate = null;

  function focusSelector(el) {
    if (el.id) return '#' + el.id;
    const attr = el.dataset.action ? 'data-action' : el.dataset.change ? 'data-change' : null;
    if (!attr) return null;
    let sel = '[' + attr + '="' + el.getAttribute(attr) + '"]';
    if (el.dataset.arg != null) sel += '[data-arg="' + el.dataset.arg.replace(/["\\]/g, '\\$&') + '"]';
    return sel;
  }

  function centerSelectedDay() {
    const strip = app.querySelector('.days');
    const sel = strip && strip.querySelector('.day.selected');
    if (!sel) return;
    const a = strip.getBoundingClientRect(), b = sel.getBoundingClientRect();
    strip.scrollLeft += (b.left + b.width / 2) - (a.left + a.width / 2);
  }

  let lastVm = null;

  // Pastki panel balandligi — AI chat tugmasi uning ustida turishi uchun
  function updateDockHeight() {
    const dock = app.querySelector('.dock');
    document.documentElement.style.setProperty('--dock-h', (dock ? Math.round(dock.getBoundingClientRect().height) : 0) + 'px');
  }

  function render() {
    document.documentElement.lang = state.lang;
    document.title = t(state.tab === 'flights' ? 'title_f' : state.tab === 'hotels' ? 'title_h' : 'title');
    const active = document.activeElement;
    const activeSel = active && active !== document.body && app.contains(active) ? focusSelector(active) : null;
    const tpl = document.createElement('div');
    lastVm = compute();
    tpl.innerHTML = view(lastVm);
    morphChildren(app, tpl);
    updateDockHeight();
    document.dispatchEvent(new CustomEvent('tez:render', { detail: { lang: state.lang } }));
    // Fokus: kerakli joyga qaytariladi (element olib tashlangan bo'lsa ham)
    let target = null;
    if (pendingFocus) target = app.querySelector(pendingFocus);
    else if (activeSel && !app.contains(active)) target = app.querySelector(activeSel);
    pendingFocus = null;
    if (target) target.focus({ preventScroll: true });
    // Tanlangan kun har doim ko'rinib tursin (telefonda ham)
    if (lastDate !== state.date) { lastDate = state.date; centerSelectedDay(); }
    // Haqiqiy narxlar: joriy qidiruv uchun hali so'ralmagan bo'lsa — operatorlardan so'raladi
    fetchLive();
  }

  // ---------- Amallar ----------
  function toggleOffer(key) {
    if (state.offer.some(x => x.key === key)) { setState({ offer: state.offer.filter(x => x.key !== key) }); return; }
    const x = offerIndex[key];
    if (!x) return;
    let item;
    if (x.f) {
      // Aviachipta: reys ma'lumotlari nusxasi saqlanadi (keyin qidiruv o'zgarsa ham taklifda qoladi)
      const f = x.f;
      item = {
        product: 'flight', key, airline: f.al.name, no: f.no, backNo: f.backNo, from: state.from, to: f.to,
        fromCode: f.fromCode, toCode: f.toCode, out: f.out, back: f.back, cabin: state.cabin, bag: f.bag,
        adults: state.adults, childAges: state.childAges.slice(), price: f.price
      };
    } else {
      if (!bookable(x.o)) return;
      item = {
        product: isHotels() ? 'hotel' : 'tour', key, hotelId: x.h.id, opId: x.o.op.id, date: state.date, nights: state.nights,
        adults: state.adults, childAges: state.childAges.slice(), rooms: state.rooms,
        meal: x.o.meal, room: x.o.room, price: x.o.price
      };
    }
    setState({ offer: state.offer.concat([item]), note: '' });
  }

  function offerText() {
    const lines = [t('ot_hello', { x: t('options_n', { n: state.offer.length }) }), ''];
    state.offer.forEach((x, i) => {
      const v = offerView(x);
      lines.push((i + 1) + ') ' + v.title + (v.stars ? ' ' + v.stars : ''));
      v.lines.forEach(l => lines.push('   ' + l));
      lines.push('   ' + t(v.priceNote, { p: v.price }));
      lines.push('');
    });
    lines.push(t('ot_bye'));
    return lines.join('\n');
  }

  function setAdults(n) {
    const adults = Math.max(1, Math.min(MAX_ADULTS, n));
    let rooms = Math.min(state.rooms, adults);
    let note = state.note;
    if (rooms < minRooms(adults)) { rooms = minRooms(adults); note = t('room_limit'); }
    setState({ adults, rooms, maxPrice: null, note });
  }

  const actions = {
    lang: (id) => setState({ lang: id }),
    cur: (id) => setState({ cur: id }),
    theme: () => { if (window.TezTheme) window.TezTheme.toggle(); },   // 'tez:theme' hodisasi qayta chizadi
    menu: () => setState({ menuOpen: !state.menuOpen }),
    tab: (id) => {
      if (TABS.indexOf(id) < 0) return;
      if (id === state.tab) { setState({ menuOpen: false }); return; }
      pendingFocus = '#h-search';
      setState({ tab: id, menuOpen: false, filtersOpen: false, settings: false, open: {}, maxPrice: null });
      window.scrollTo(0, 0);
    },
    trip: (id) => setState({ trip: id === 'ow' ? 'ow' : 'rt' }),
    cabin: (id) => setState({ cabin: id === 'bus' ? 'bus' : 'eco' }),
    fSort: (id) => setState({ fSort: id }),
    fReset: () => setState({ fAir: {}, fDirect: false, fBag: false }),
    navOffers: () => {
      if (state.offer.length) { pendingFocus = '#h-offer'; setState({ panel: true, menuOpen: false }); }
      else setState({ note: t('n_no_offers'), menuOpen: false });
    },
    toggleSettings: () => setState({ settings: !state.settings, cq: '' }),
    closeSettings: () => { pendingFocus = '[data-action="toggleSettings"]'; setState({ settings: false, cq: '' }); },
    selectAllMy: () => setMy(ALL_IDS.slice()),
    dest: (id) => {
      const d = destList();
      if (d.indexOf(id) >= 0) {
        if (d.length > 1) setState({ dests: d.filter(x => x !== id), maxPrice: null, open: {} });
        else setState({ note: t('n_last_dest') });
      } else setState({ dests: d.concat([id]), maxPrice: null, open: {} });
    },
    allDests: () => setState({ dests: myList(), maxPrice: null, open: {} }),
    decA: () => setAdults(state.adults - 1),
    incA: () => setAdults(state.adults + 1),
    decC: () => setState({ childAges: state.childAges.slice(0, -1), maxPrice: null }),
    incC: () => { if (children() < MAX_CHILDREN) setState({ childAges: state.childAges.concat([DEFAULT_CHILD_AGE]), maxPrice: null }); },
    decR: () => { if (state.rooms > minRooms(state.adults)) setState({ rooms: state.rooms - 1, maxPrice: null }); },
    incR: () => { if (state.rooms < Math.min(MAX_ROOMS, state.adults)) setState({ rooms: state.rooms + 1, maxPrice: null }); },
    hot: (id) => {
      const b = D.hotFor(id, state.from, today, isHotels());
      if (b) setState({ dests: [id], date: b.date, nights: 7, adults: 2, childAges: [], rooms: 1, cities: {}, maxPrice: null, open: {} });
    },
    day: (iso) => {
      const patch = { date: iso, maxPrice: null, open: {} };
      // Aviachipta: qaytish sanasi ham shuncha kunga suriladi (safar davomiyligi o'zgarmaydi)
      if (state.tab === 'flights' && state.trip === 'rt') patch.fRet = dt.addDays(retDate(), daysBetween(state.date, iso));
      setState(patch);
    },
    // Aylanma sana tanlagich (js/wheel.js). Bron qilingan kunlar qizil va tanlab bo'lmaydi.
    pickDate: (field) => {
      const isRet = field === 'fRet';
      const min = isRet ? dt.addDays(state.date, 1) : today;
      window.WheelPicker.open({
        value: isRet ? retDate() : state.date,
        min, max: dt.addDays(today, 730),
        booked: bookedDays(),
        months: L.CAL[state.lang].months, wd: L.CAL[state.lang].wd,
        fmt: fmtLong,
        labels: {
          title: t(isRet ? 'f_ret' : isHotels() ? 'f_checkin' : 'f_date'),
          day: t('wp_day'), month: t('wp_month'), year: t('wp_year'),
          done: t('wp_done'), cancel: t('wp_cancel'), today: t('wp_today'), booked: t('wp_booked'),
          bookedN: (n) => t('wp_booked_n', { n }), skipped: (d) => t('wp_skipped', { d })
        },
        returnFocus: document.getElementById(isRet ? 'f-ret' : 'f-date'),
        onPick: (iso) => {
          if (isRet) { if (iso > state.date && iso !== state.fRet) setState({ fRet: iso }); }
          else if (iso >= today && iso !== state.date) setState({ date: iso, maxPrice: null, open: {} });
        }
      });
    },
    filters: () => setState({ filtersOpen: !state.filtersOpen }),
    // Operatorlar filtri: hammasini yoqish / o'chirish, to'liq ro'yxat
    opsAll: (v) => {
      const ops = {};
      if (v === 'off') D.OPS.forEach(o => { ops[o.id] = false; });
      setState({ ops, maxPrice: null });
    },
    opsMore: () => setState({ opsMore: !state.opsMore }),
    reset: () => setState({ ops: {}, stars: {}, meals: {}, cities: {}, onlyAvail: false, instant: false, maxPrice: null, hotelQuery: '' }),
    star: (n) => setState({ stars: Object.assign({}, state.stars, { [n]: !starOn(n) }) }),
    sort: (id) => setState({ sort: id }),
    mode: (id) => setState({ mode: id }),
    open: (hid) => setState({ open: Object.assign({}, state.open, { [hid]: !state.open[hid] }) }),
    add: (key) => toggleOffer(key),
    // Kirish / tariflar oynasi (js/account.js)
    account: () => {
      if (!window.TezAccount || !window.TezAccount.open()) setState({ note: t('acc_need_server') });
    },
    book: (key) => {
      const x = offerIndex[key];
      if (!x || D.isGone(key)) return;
      // Bron qilish faqat kirgan va tarifi faol tur firmaga
      const acc = account();
      if (!acc.canBook) {
        if (!acc.available) setState({ note: t(syncChecked ? 'acc_need_server' : 'acc_offline') });
        else window.TezAccount.open();
        return;
      }
      // "So'rov bo'yicha" — operator hali tasdiqlamagan, shuning uchun ro'yxatdan olinmaydi
      if (x.o && x.o.avail === 'req') { setState({ note: t('n_request', { op: x.o.op.name }), undo: null }); return; }
      if (x.o && !bookable(x.o)) return;
      // Bron qilindi: natijalardan va mijozga taklifdan olib tashlanadi
      const title = x.f ? x.f.no + ' ' + x.f.fromCode + ' → ' + x.f.toCode : x.h.name;
      const op = x.f ? x.f.al.name : x.o.op.name;
      pendingFocus = '#h-results';
      setState({
        booked: state.booked.concat([{ key, title, op, at: Date.now() }]).slice(-500),
        offer: state.offer.filter(o => o.key !== key),
        note: t(x.f ? 'n_booked_f' : 'n_booked', { x: title, op }), undo: key
      });
      // Server bazasiga yoziladi (ekranda darhol ko'rinadi, server keyin tasdiqlaydi)
      const product = x.f ? 'flight' : isHotels() ? 'hotel' : 'tour';
      sync.create({ key, product, title, op, price: x.f ? x.f.price : x.o.price }).catch(err => {
        const rest = state.booked.filter(b => b.key !== key);
        if (err.status === 409) { setState({ booked: rest, taken: state.taken.concat([key]), note: t('n_already_booked', { x: title }) }); return; }
        if (err.status === 401 || err.status === 402) { setState({ booked: rest, note: '' }); window.TezAccount.init().then(() => window.TezAccount.open()); return; }
        setState({ booked: rest, note: t('n_sync_fail') });
      });
    },
    undoBook: () => {
      const key = state.undo;
      if (!key) return;
      setState({ booked: state.booked.filter(b => b.key !== key), undo: null, note: t('n_unbooked') });
      if (sync && sync.online()) sync.cancel(key).catch(() => { setState({ note: t('n_sync_fail') }); pullBookings(); });
    },
    clearNote: () => { pendingFocus = '#h-results'; setState({ note: '' }); },
    panel: () => setState({ panel: !state.panel }),
    clearOffer: () => { pendingFocus = '#h-results'; setState({ offer: [], panel: false }); },
    removeOffer: (key) => {
      const rest = state.offer.filter(x => x.key !== key);
      pendingFocus = rest.length ? '[data-action="removeOffer"]' : '#h-results';
      setState({ offer: rest });
    },
    telegram: () => setState({ note: t('n_tg') }),
    copyText: () => {
      const text = offerText();
      const done = () => setState({ note: t('n_copied') });
      const fallback = () => {
        // Eski brauzerlar uchun zaxira usul
        const ta = document.createElement('textarea');
        ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        let ok = false;
        try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
        document.body.removeChild(ta);
        setState({ note: ok ? t('n_copied') : t('n_copy_fail') });
      };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
      else fallback();
    },
    pdf: () => setState({ note: t('n_pdf') })
  };

  const changes = {
    from: (el) => setState({ from: el.value, maxPrice: null, open: {} }),
    nights: (el) => setState({ nights: +el.value, maxPrice: null, open: {} }),
    fTo: (el) => setState({ fTo: el.value }),
    fAir: (el) => setState({ fAir: Object.assign({}, state.fAir, { [el.dataset.arg]: el.checked }) }),
    fDirect: (el) => setState({ fDirect: el.checked }),
    fBag: (el) => setState({ fBag: el.checked }),
    age: (el) => {
      const ages = state.childAges.slice();
      ages[+el.dataset.arg] = +el.value;
      setState({ childAges: ages, maxPrice: null });
    },
    my: (el) => {
      const id = el.dataset.arg, my = myList();
      setMy(el.checked ? my.concat([id]) : my.filter(x => x !== id));
    },
    op: (el) => setState({ ops: Object.assign({}, state.ops, { [el.dataset.arg]: el.checked }) }),
    meal: (el) => setState({ meals: Object.assign({}, state.meals, { [el.dataset.arg]: el.checked }) }),
    city: (el) => setState({ cities: Object.assign({}, state.cities, { [el.dataset.arg]: el.checked }) }),
    onlyAvail: (el) => setState({ onlyAvail: el.checked }),
    instant: (el) => setState({ instant: el.checked }),
    price: (el) => setState({ maxPrice: +el.value })
  };

  // ---------- Hodisalar ----------
  app.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || !app.contains(el) || el.disabled) return;
    const fn = actions[el.dataset.action];
    if (fn) fn(el.dataset.arg);
  });
  app.addEventListener('change', (e) => {
    const fn = changes[e.target.dataset.change];
    if (fn) fn(e.target);
  });
  app.addEventListener('input', (e) => {
    const el = e.target;
    if (el.dataset.input === 'cq') setState({ cq: el.value });
    if (el.dataset.input === 'hotelQuery') setState({ hotelQuery: el.value });
    // Slayder surilayotganda faqat yozuv yangilanadi; qo'yib yuborilganda natijalar yangilanadi
    if (el.dataset.change === 'price') {
      const label = document.getElementById('cap-label');
      if (label) label.textContent = t('upto', { p: money(shown(+el.value)) });
    }
  });
  // Esc: ochiq oyna yoki panelni yopadi
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (state.settings) { pendingFocus = '[data-action="toggleSettings"]'; setState({ settings: false, cq: '' }); }
    else if (state.panel && state.offer.length) { pendingFocus = '[data-action="panel"]'; setState({ panel: false }); }
    else if (state.menuOpen) { pendingFocus = '[data-action="menu"]'; setState({ menuOpen: false }); }
    else if (state.filtersOpen) { pendingFocus = '[data-action="filters"]'; setState({ filtersOpen: false }); }
    else if (state.note) setState({ note: '' });
  });

  window.addEventListener('resize', updateDockHeight);

  // ---------- Real vaqtda yangilash ----------
  // Har 30 soniyada mavjudlik qayta tekshiriladi: sotilib ketganlar natijalardan yo'qoladi,
  // mijozga taklifdagi sotilganlar olib tashlanadi va agentga xabar beriladi.
  const REFRESH_MS = 30000;
  function refreshLive() {
    if (document.hidden) return;
    const gone = state.offer.filter(x => D.isGone(x.key));
    if (gone.length) {
      setState({
        offer: state.offer.filter(x => !D.isGone(x.key)),
        note: t('n_sold_out', { list: gone.map(x => offerView(x).title).join(', ') })
      });
    } else render();
  }
  setInterval(refreshLive, REFRESH_MS);
  document.addEventListener('visibilitychange', refreshLive);

  // ---------- Server bazasi bilan sinxronlash (js/sync.js, server/bookings.js) ----------
  // Server ishlayotgan bo'lsa, bronlar bazada saqlanadi va boshqa agentlarning bronlari ham jonli ko'rinadi.
  // Server topilmasa — avvalgidek faqat shu brauzerda.
  // Firma o'z bronlarini (nomi bilan) ko'radi; boshqalarniki faqat qidiruvdan yashiriladi.
  let syncChecked = false;
  async function pullBookings() {
    let list;
    try { list = await sync.list(); } catch (e) { return; }
    let booked = list.filter(b => b.mine).map(b => ({ key: b.key, title: b.title, op: b.op, at: b.at }));
    const taken = list.filter(b => !b.mine).map(b => b.key);
    // Brauzerdagi eski bronlar hali bazaga ko'chirilmagan bo'lsa — yo'qolmasin
    if (!store.get('migrated', false)) {
      const have = new Set(list.map(b => b.key));
      booked = booked.concat(state.booked.filter(b => !have.has(b.key)));
    }
    D.setBooked(booked.map(b => b.key).concat(taken));
    const gone = state.offer.filter(x => D.isGone(x.key));
    const patch = { booked, taken, offer: state.offer.filter(x => !D.isGone(x.key)) };
    if (gone.length) patch.note = t('n_sold_out', { list: gone.map(x => offerView(x).title).join(', ') });
    setState(patch);
  }
  // Brauzerda avval qilingan bronlar firma kirib, tarifi faol bo'lganda bazaga bir marta ko'chiriladi
  let migrating = false;
  async function migrateLocal() {
    if (migrating || store.get('migrated', false) || !window.TezAccount.canBook()) return;
    migrating = true;
    try {
      const have = new Set((await sync.list()).map(b => b.key));
      for (const b of state.booked) {
        if (have.has(b.key)) continue;
        const product = b.key.indexOf('F|') === 0 ? 'flight' : /\|H$/.test(b.key) ? 'hotel' : 'tour';
        await sync.create({ key: b.key, product, title: b.title || b.key, op: b.op || '', at: b.at, source: 'import' }).catch(() => {});
      }
      store.set('migrated', true);
    } catch (e) { /* keyingi safar qayta urinadi */ }
    migrating = false;
  }
  async function initSync() {
    const found = !!sync && await sync.find();
    syncChecked = true;
    if (!found) { render(); return; }
    // Akkaunt o'zgarsa (kirdi / chiqdi / to'ladi): bronlar qayta olinadi, xabar ko'rsatiladi
    window.TezAccount.onChange(async (note) => {
      await migrateLocal();
      await pullBookings();
      if (note) setState({ note }); else render();
    });
    // Server operatorlardan haqiqiy narxlarni ola oladimi (demo rejimda — yo'q)
    try { await sync.request('/api/live/status'); liveReady = true; } catch (e) { liveReady = false; }
    await window.TezAccount.init();
    await pullBookings();
    sync.subscribe(pullBookings);
  }
  initSync();

  // ---------- AI chat uchun (js/chat.js) ----------
  // Chat joriy tilni va ekrandagi qidiruv natijalarini (qisqacha) shu yerdan oladi.
  window.TezApp = {
    refresh: refreshLive,
    lang: () => state.lang,
    t: (key, params) => t(key, params),
    context: () => {
      if (!lastVm) return null;
      if (state.tab === 'flights') {
        return {
          note: 'Demo flight search from the agent screen. Times are local. Prices are totals for all passengers.',
          search: lastVm.resultsTitle + ' — ' + lastVm.summary,
          currency: state.cur,
          priceType: state.mode === 'client' ? 'client price incl. ' + MARKUP + '% agency markup' : 'net price (agency cost)',
          flights: lastVm.flights.slice(0, 10).map(f => ({
            airline: f.airline, price: f.price, baggage: f.bag, seats: f.seats,
            legs: f.legs.map(l => l.no + ' ' + l.date + ' ' + l.from + ' ' + l.dep + ' → ' + l.to + ' ' + l.arr + (l.plus ? ' (' + l.plus + ' day)' : '') + ', ' + l.dur + ', ' + l.stops).join(' / ')
          }))
        };
      }
      return {
        note: isHotels()
          ? 'Demo hotel-only search from the agent screen. Prices are totals for the whole group, accommodation only (no flights).'
          : 'Demo data from the agent screen. Prices are totals for the whole group, flights included.',
        search: lastVm.resultsTitle + ' — ' + lastVm.summary,
        currency: state.cur,
        priceType: state.mode === 'client' ? 'client price incl. ' + MARKUP + '% agency markup' : 'net price (agency cost)',
        hotels: lastVm.hotels.slice(0, 10).map(h => ({
          name: h.name, stars: h.stars, rating: h.rating, place: h.place, meal: h.meal, room: h.room,
          availability: h.avail, cheapest: h.bestOp + ' ' + h.bestPrice,
          operators: h.pills.map(p => p.op + ' ' + p.price).join(', ')
        }))
      };
    }
  };

  render();
})();
