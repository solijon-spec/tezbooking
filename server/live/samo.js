/*
 * TezBooking — SAMO-Tour Online ulagichi (operatorning OCHIQ qidiruv sahifasi, login'siz).
 *
 * Ko'p tur operatorlar (Prestige, Kazunion, Selfie, Savtour, Vietratour, ...) SAMO tizimida ishlaydi va
 * "Поиск тура" sahifasi agentliklar uchun ochiq. Bu ulagich o'sha sahifa brauzerga beradigan so'rovni yuboradi
 * (samo_action=PRICES) va javobdagi narx qatorlarini o'qiydi. Kabinetga kirilmaydi, hech qanday himoya chetlab o'tilmaydi.
 *
 * Operator API kalitini bergach, shu fayl o'rniga rasmiy SAMO export API'si ulanadi — natija formati o'zgarmaydi.
 *
 *   search(op, { country, date, nights, adults, childAges, from })  ->  { offers: [...], note }
 *   offer = { opId, hotelKey, hotel, stars, city, tour, checkIn, nights, meal, mealRaw, room, roomKey, mealKey,
 *             price (USD), avail: ok|few|req|stop, seats: ok|few|none }
 */
'use strict';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36 TezBooking/1.0';
const TIMEOUT = 25000;

// TezBooking davlat kodlari -> SAMO'dagi ruscha nomlar
const COUNTRY_RU = {
  tr: ['Турция'], ge: ['Грузия'], az: ['Азербайджан'], ae: ['ОАЭ', 'Объединенные Арабские Эмираты', 'Объединённые Арабские Эмираты'],
  eg: ['Египет'], my: ['Малайзия'], th: ['Таиланд', 'Тайланд'], vn: ['Вьетнам'], id: ['Индонезия', 'Бали'], lk: ['Шри-Ланка', 'Шри Ланка'], mv: ['Мальдивы']
};
const FROM_RU = { tas: ['Ташкент'], skd: ['Самарканд'], dyu: ['Душанбе'] };

const ymd = (iso) => iso.replace(/-/g, '');
const isoFromYmd = (s) => s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8);
const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, ' ').trim();

// SAMO javobi — JavaScript; ichidagi \uXXXX va \/ larni ochish
function unescapeJs(s) {
  return s.replace(/\\u([0-9a-fA-F]{4})/g, (m, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\\//g, '/').replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\t/g, ' ');
}
const text = (html) => html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/&quot;/g, '"').replace(/&#039;|&#39;/g, "'").replace(/\s+/g, ' ').trim();
function options(js, ctl) {
  const m = js.match(new RegExp('controls\\.' + ctl + '\\)\\.addOptions\\(\\s*\\[([\\s\\S]*?)\\]'));
  if (!m) return [];
  return [...m[1].matchAll(/inc:\s*'(\d+)',\s*title:\s*'([^']*)'(?:,\s*selected:\s*(true|false))?/g)]
    .map(x => ({ inc: x[1], title: unescapeJs(x[2]), sel: x[3] === 'true' }));
}

// Ovqatlanish: SAMO matni -> TezBooking kodi
function mealCode(raw) {
  const s = String(raw || '').toUpperCase();
  if (/UAI|ULTRA/.test(s)) return 'UAI';
  if (/\bAI\b|ALL INC|\bALL\b|\bAL\b|ВСЕ ВКЛ|ВСЁ ВКЛ/.test(s)) return 'AI';
  if (/\bFB\b|FULL BOARD|ПОЛНЫЙ ПАНС|ТР[ЕЁ]ХРАЗ/.test(s)) return 'FB';
  if (/\bHB\b|HALF BOARD|ПОЛУПАНС|ДВУХРАЗ/.test(s)) return 'HB';
  if (/\bBB\b|BREAKFAST|\bABF\b|ЗАВТРАК/.test(s)) return 'BB';
  return 'RO';
}
// Mehmonxonada joy: Y — bor, R — so'rov bo'yicha, F/N/S — yo'q, L — kam
function availOf(cls) {
  const m = [...cls.matchAll(/hotel_availability_([A-Z])/g)].map(x => x[1]);
  if (!m.length) return 'req';
  if (m.includes('Y')) return 'ok';
  if (m.includes('L')) return 'few';
  if (m.includes('R')) return 'req';
  return 'stop';
}
function seatsOf(html) {
  const m = [...html.matchAll(/fr_place_[rl]\s+([A-Z])/g)].map(x => x[1]);
  if (!m.length) return 'ok';
  if (m.every(x => x === 'Y')) return 'ok';
  if (m.some(x => x === 'N' || x === 'F')) return 'none';
  return 'few';
}

// ---------- So'rovlar (har bir operator uchun cookie sessiyasi) ----------
const sessions = new Map();          // opId -> { base, cookie, at }
const metaCache = new Map();         // opId|shahar -> { states, at }  (davlatlar ro'yxati, 6 soat)

async function http(url, opts, signal) {
  const r = await fetch(url, Object.assign({ redirect: 'follow', signal }, opts));
  if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
  return r;
}
async function session(op, signal) {
  const s = sessions.get(op.id);
  if (s && Date.now() - s.at < 20 * 60000) return s;
  const r = await http(op.search, { headers: { 'User-Agent': UA, Accept: 'text/html' } }, signal);
  const cookie = (r.headers.getSetCookie ? r.headers.getSetCookie() : []).map(c => c.split(';')[0]).join('; ');
  const html = await r.text();
  // Jo'nash shaharlari sahifaning o'zida: <select name="TOWNFROMINC"> <option value="1853">Ташкент</option>
  const sel = html.match(/<select[^>]*TOWNFROMINC[^>]*>([\s\S]*?)<\/select>/i);
  const towns = sel ? [...sel[1].matchAll(/<option[^>]*value="(\d+)"[^>]*>([^<]+)/g)].map(x => ({ inc: x[1], title: x[2].trim() })) : [];
  const ns = { base: r.url.split('?')[0], cookie, towns, at: Date.now() };
  sessions.set(op.id, ns);
  return ns;
}
async function samo(op, qs, signal) {
  const s = await session(op, signal);
  const r = await http(s.base + '?' + qs, { headers: { 'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest', Referer: s.base, Cookie: s.cookie } }, signal);
  return r.text();
}

// Tanlangan shahardan qaysi davlatlarga tur bor (6 soat keshda)
async function states(op, townInc, signal) {
  const k = op.id + '|' + townInc, c = metaCache.get(k);
  if (c && Date.now() - c.at < 6 * 3600000) return c.states;
  const st = options(await samo(op, 'samo_action=TOWNFROMINC&TOWNFROMINC=' + townInc, signal), 'STATEINC');
  metaCache.set(k, { states: st, at: Date.now() });
  return st;
}
async function departure(op, from, signal) {
  const s = await session(op, signal);
  const want = (FROM_RU[from] || FROM_RU.tas).map(norm);
  return s.towns.find(t => want.includes(norm(t.title)));
}

// ---------- Natija qatorlarini o'qish ----------
function parseRows(op, js) {
  const html = unescapeJs(js);
  const out = [];
  const rowRe = /<tr\s+class="([^"]*\bprice_info\b[^"]*)"([^>]*)>([\s\S]*?)<\/tr>/g;
  let m;
  while ((m = rowRe.exec(html))) {
    const cls = m[1], attrs = m[2], body = m[3];
    const attr = (n) => (attrs.match(new RegExp('data-' + n + '="([^"]*)"')) || [])[1] || '';
    const key = (n) => (cls.match(new RegExp('\\b' + n + '-(\\d+)')) || [])[1] || '';
    const tds = [...body.matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/g)].map(x => ({ cls: x[1], html: x[2] }));
    const hotelTd = tds.find(t => /link-hotel/.test(t.cls));
    const priceM = body.match(/data-cat-price="([\d.]+)"[\s\S]*?data-cat-currency="(\d+)"/) || body.match(/data-converted-price-number="([\d.]+)"/);
    if (!hotelTd || !priceM) continue;
    const currency = priceM[2] || attr('currency') || '2';
    if (currency !== '2') continue;                    // faqat USD (so'rovda CURRENCY=2)
    const hotelText = text(hotelTd.html);
    // "Consul Hotel *** (Баку)"  yoki  "Rixos 5* (Antalya)"
    const hm = hotelText.match(/^(.*?)\s*(\*{1,5}|\d\s*\*)?\s*(?:\(([^)]+)\))?$/);
    const name = (hm && hm[1] || hotelText).replace(/\s+\d\*?$/, '').trim();
    const starsRaw = hm && hm[2] ? hm[2] : '';
    const stars = starsRaw ? (starsRaw.match(/\d/) ? +starsRaw.match(/\d/)[0] : starsRaw.length) : 0;
    const city = hm && hm[3] ? hm[3].trim() : '';
    const plain = tds.map(t => text(t.html));
    const idx = tds.indexOf(hotelTd);
    const mealRaw = plain[idx + 2] || '';
    const room = plain[idx + 3] || '';
    const tourTd = tds.find(t => /\btour\b/.test(t.cls));
    out.push({
      opId: op.id, hotelKey: attr('hotel') || key('hotelKey'), hotel: name, stars: Math.min(5, stars), city,
      tour: tourTd ? text(tourTd.html) : '', checkIn: isoFromYmd(attr('checkin') || key('checkIn')), nights: +(attr('nights') || key('nights')),
      meal: mealCode(mealRaw), mealRaw, room, roomKey: key('roomKey'), mealKey: key('mealKey'),
      price: Math.round(parseFloat(priceM[1])), avail: availOf(body), seats: seatsOf(body)
    });
  }
  return out;
}

// ---------- Qidiruv ----------
async function search(op, q) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const town = await departure(op, q.from, ctl.signal);
    if (!town) return { offers: [], note: 'no_departure' };
    const want = (COUNTRY_RU[q.country] || []).map(norm);
    const st = (await states(op, town.inc, ctl.signal)).find(s => want.includes(norm(s.title)));
    if (!st) return { offers: [], note: 'no_country' };
    const ages = (q.childAges || []).slice(0, 4);
    // Bitta so'rovda tanlangan kun ±3 kun (sayt kunlar tasmasi uchun ham)
    const shift = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
    const tomorrow = shift(new Date().toISOString().slice(0, 10), 1);
    const beg = shift(q.date, -(q.window || 0)) < tomorrow ? tomorrow : shift(q.date, -(q.window || 0));
    const end = shift(q.date, q.window || 0);
    const qs = new URLSearchParams({
      samo_action: 'PRICES', TOWNFROMINC: town.inc, STATEINC: st.inc, TOURINC: '0', FREIGHTTYPE: '0',
      CHECKIN_BEG: ymd(beg), CHECKIN_END: ymd(end), NIGHTS_FROM: String(q.nights), NIGHTS_TILL: String(q.nights),
      ADULT: String(q.adults), CHILD: String(ages.length), CURRENCY: '2', PRICEPAGE: '1', DOLOAD: '1'
    });
    ages.forEach((a, i) => qs.set('AGES' + (i + 1), String(a)));
    if (ages.length) qs.set('AGES', ages.join(','));
    const js = await samo(op, qs.toString(), ctl.signal);
    if (/временно недоступен/.test(unescapeJs(js))) return { offers: [], note: 'closed' };
    const offers = parseRows(op, js).filter(o => o.checkIn >= beg && o.checkIn <= end && o.nights === q.nights);
    return { offers, note: offers.length ? '' : 'empty' };
  } finally { clearTimeout(timer); }
}

module.exports = { search, parseRows, mealCode, COUNTRY_RU };
