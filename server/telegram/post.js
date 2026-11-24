/*
 * TezBooking — Telegram kanal uchun post matni (o'zbek va rus tillarida).
 *
 * Post tarkibi: davlat va shahar, mehmonxona va yulduzlar, qayerdan va qachon uchish (sana, hafta kuni, soat),
 * necha kecha / kun, ovqatlanish, xona, kishilar soni, narx (firma foizi qo'shilgan — mijoz narxi), so'mda taxminiy narx,
 * bron uchun telefon, firma nomi va heshteglar. Matn HTML (parse_mode: HTML), Telegram rasm izohi chegarasi — 1024 belgi.
 *
 * Saytdagi nomlar (davlat, shahar, ovqat, xona, uchish shahri) js/i18n.js dan olinadi — sayt bilan bir xil.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const MONTHS = {
  uz: ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'],
  ru: ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
};
const WEEKDAYS = {
  uz: ['yakshanba', 'dushanba', 'seshanba', 'chorshanba', 'payshanba', 'juma', 'shanba'],
  ru: ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота']
};
const T = {
  uz: {
    fly: '✈️ {from} uchish: <b>{d}</b>', at: ' · soat <b>{t}</b>', nights: '🌙 {n} kecha / {k} kun ({a} – {b})',
    pax: '👥 {n} kishi uchun', price: '💰 <b>{p}</b> — {n} kishi uchun', pp: ' (kishi boshiga {p})', som: '≈ {p} so\'m',
    call: '📞 Bron: {p}', gds: '✈️ Muntazam reys (GDS)', flight: '🛫 Reys: {x}', room: '🛏 {x}',
    demo: '⚠️ DEMO — narxlar namuna sifatida', top: '🔥 <b>{c}GA ENG ARZON TURLAR</b>', top_sub: '✈️ {from} · {n} kecha · {k} kishi uchun',
    hot: '🔥 <b>{c}</b>', tags: ['tur', 'arzontur', 'sayohat'], more: 'Boshqa sanalar va mehmonxonalar — so\'rang!'
  },
  ru: {
    fly: '✈️ Вылет {from}: <b>{d}</b>', at: ' · в <b>{t}</b>', nights: '🌙 {n} ноч. / {k} дн. ({a} – {b})',
    pax: '👥 на {n} чел.', price: '💰 <b>{p}</b> — за {n} чел.', pp: ' ({p} с человека)', som: '≈ {p} сум',
    call: '📞 Бронирование: {p}', gds: '✈️ Регулярный рейс (GDS)', flight: '🛫 Рейс: {x}', room: '🛏 {x}',
    demo: '⚠️ ДЕМО — цены для примера', top: '🔥 <b>САМЫЕ ВЫГОДНЫЕ ТУРЫ: {c}</b>', top_sub: '✈️ {from} · {n} ноч. · на {k} чел.',
    hot: '🔥 <b>{c}</b>', tags: ['тур', 'горящийтур', 'отдых'], more: 'Другие даты и отели — спрашивайте!'
  }
};
const DIGITS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣'];

// Saytning js/i18n.js va js/data.js fayllarini Node ichida yuklash (nomlar, operatorlar, so'm kursi, demo narxlar)
let site = null;
function loadSite(root) {
  if (site) return site;
  const sandbox = { window: {}, Math, Date, Object, Array, JSON, String, Number, isNaN, parseInt, parseFloat, RegExp, Set, Map };
  vm.createContext(sandbox);
  ['i18n.js', 'data.js'].forEach(f => vm.runInContext(fs.readFileSync(path.join(root, 'js', f), 'utf8'), sandbox, { filename: f }));
  site = { I18N: sandbox.window.I18N, TB: sandbox.window.TB };
  return site;
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));
const fill = (s, p) => s.replace(/\{(\w+)\}/g, (m, k) => (p[k] != null ? p[k] : m));
const group = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const pad2 = (n) => String(n).padStart(2, '0');
const hhmm = (m) => pad2(Math.floor(m / 60) % 24) + ':' + pad2(m % 60);
function addDays(iso, n) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function longDate(iso, lang) {
  const d = new Date(iso + 'T00:00:00Z');
  return d.getUTCDate() + ' ' + MONTHS[lang][d.getUTCMonth()] + ', ' + WEEKDAYS[lang][d.getUTCDay()];
}
const shortDate = (iso) => iso.slice(8, 10) + '.' + iso.slice(5, 7);
// Mijoz narxi: netto + firma foizi, 5 dollarga yaxlitlangan (saytdagi clientP bilan bir xil)
const clientPrice = (net, markup) => Math.round(net * (1 + (Number(markup) || 0) / 100) / 5) * 5;
const hashtag = (s) => '#' + String(s || '').replace(/[^0-9A-Za-zА-Яа-яЁёЎўҚқҒғҲҳ]+/g, '');

function names(I18N, lang) {
  const N = I18N.NAMES;
  const pick = (group, id) => { const g = N[group] && N[group][id]; return g ? (g[lang] || g.uz) : null; };
  return {
    country: (id) => pick('countries', id) || id,
    city: (id) => pick('cities', id),
    meal: (code) => { const m = pick('meals', code); return m ? m[1] : code; },
    room: (code) => pick('rooms', code),
    fromForm: (id) => { const f = pick('from', id); return f ? f[1] : id; },
    fromName: (id) => { const f = pick('from', id); return f ? f[0] : id; }
  };
}

/*
 * offer: { co: davlat id, cid?: shahar id (demo) | c: shahar matni (jonli), h: mehmonxona, s: yulduz, d: kirish sanasi, n: tunlar,
 *          m: ovqat kodi, mr?: ovqat matni, rc?: xona kodi | r?: xona matni, p: netto narx (USD), adults, fr: uchish shahri,
 *          dep?: uchish (daqiqa), fn?: reys raqami, al?: aviakompaniya, g?: GDS }
 * opts:  { lang: uz|ru, markup, phone, agency, rate (so'm kursi), demo, I18N }
 */
function buildPost(o, opts) {
  const lang = opts.lang === 'ru' ? 'ru' : 'uz';
  const t = T[lang], nm = names(opts.I18N, lang);
  const country = nm.country(o.co);
  const city = (o.cid && nm.city(o.cid)) || o.c || '';
  const price = clientPrice(o.p, opts.markup);
  const pax = o.adults || 2;
  const lines = [];
  if (opts.demo) lines.push(t.demo, '');
  lines.push(fill(t.hot, { c: esc((country + (city ? ' · ' + city : '')).toUpperCase()) }), '');
  lines.push('🏨 <b>' + esc(o.h) + '</b>' + (o.s ? ' ' + '⭐'.repeat(Math.min(5, o.s)) : ''));
  const fromF = nm.fromForm(o.fr || 'tas');
  // Reys sanasi (tunda uchsa kirish kunidan farq qilishi mumkin) — operator javobidan, bo'lmasa kirish kuni
  lines.push(fill(t.fly, { from: esc(cap(fromF, lang)), d: esc(longDate(o.dd || o.d, lang)) }) + (o.dep != null ? fill(t.at, { t: hhmm(o.dep) }) : ''));
  if (o.g) lines.push(t.gds);
  if (o.fn || o.al) lines.push(fill(t.flight, { x: esc([o.al, o.fn].filter(Boolean).join(' ')) }));
  lines.push(fill(t.nights, { n: o.n, k: o.n + 1, a: shortDate(o.d), b: shortDate(addDays(o.d, o.n)) }));
  lines.push('🍽 ' + esc(o.m ? nm.meal(o.m) : (o.mr || '')));
  const room = (o.rc && nm.room(o.rc)) || o.r;
  if (room) lines.push(fill(t.room, { x: esc(room) }));
  lines.push('');
  lines.push(fill(t.price, { p: '$' + group(price), n: pax }) + (pax > 1 ? fill(t.pp, { p: '$' + group(Math.round(price / pax)) }) : ''));
  if (opts.rate) lines.push(fill(t.som, { p: group(Math.round(price * opts.rate / 1000) * 1000) }));
  const contact = [opts.phone ? fill(t.call, { p: esc(opts.phone) }) : '', opts.agency ? '🏢 ' + esc(opts.agency) : ''].filter(Boolean);
  if (contact.length) lines.push('', ...contact);
  lines.push('', [hashtag(country), city ? hashtag(city) : '', ...t.tags.map(x => '#' + x)].filter(x => x && x !== '#').join(' '));
  return fit(lines.join('\n'));
}

// Bitta postda bir nechta eng arzon tur (top)
function buildDigest(list, opts) {
  const lang = opts.lang === 'ru' ? 'ru' : 'uz';
  const t = T[lang], nm = names(opts.I18N, lang);
  const o0 = list[0];
  const country = nm.country(o0.co);
  const lines = [];
  if (opts.demo) lines.push(t.demo, '');
  lines.push(fill(t.top, { c: esc(country.toUpperCase()) }));
  lines.push(fill(t.top_sub, { from: esc(cap(nm.fromForm(o0.fr || 'tas'), lang)), n: o0.n, k: o0.adults || 2 }), '');
  list.slice(0, 8).forEach((o, i) => {
    const city = (o.cid && nm.city(o.cid)) || o.c || '';
    const d = new Date((o.dd || o.d) + 'T00:00:00Z');
    const day = d.getUTCDate() + ' ' + MONTHS[lang][d.getUTCMonth()];
    lines.push(DIGITS[i] + ' <b>' + esc(o.h) + '</b>' + (o.s ? ' ' + o.s + '⭐' : '') + (city ? ', ' + esc(city) : ''));
    lines.push('     📅 ' + esc(day) + (o.dep != null ? ' · ' + hhmm(o.dep) : '') + ' · ' + esc(o.m || o.mr || '') + ' — <b>$' + group(clientPrice(o.p, opts.markup)) + '</b>');
  });
  lines.push('', t.more);
  if (opts.phone) lines.push(fill(t.call, { p: esc(opts.phone) }));
  if (opts.agency) lines.push('🏢 ' + esc(opts.agency));
  lines.push('', [hashtag(country), ...t.tags.map(x => '#' + x)].join(' '));
  return fit(lines.join('\n'));
}

// "Toshkentdan" -> "Toshkentdan", "из Ташкента" -> "из Ташкента" (ruschada kichik harf saqlanadi)
const cap = (s, lang) => (lang === 'uz' ? s.charAt(0).toUpperCase() + s.slice(1) : s);
// Rasm izohi 1024 belgidan oshmasin (oshsa — heshteglar va oxirgi qatorlar qisqartiriladi)
function fit(text) {
  if (text.length <= 1024) return text;
  const lines = text.split('\n');
  while (lines.join('\n').length > 1020 && lines.length > 3) lines.splice(lines.length - 2, 1);
  return lines.join('\n').slice(0, 1024);
}

module.exports = { buildPost, buildDigest, loadSite, clientPrice, longDate, hhmm, addDays, names, MONTHS };
