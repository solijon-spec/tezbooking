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

const { createSafeFetch } = require('./safe-http');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36 TezBooking/1.0';
const TIMEOUT = Number(process.env.LIVE_TIMEOUT_MS) || 25000;
const safeFetch = createSafeFetch({ timeoutMs: TIMEOUT });

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
const sessions = new Map();          // opId|page -> { base, cookie, at }
const metaCache = new Map();         // opId|shahar -> { states, at }  (davlatlar ro'yxati, 6 soat)

async function http(op, url, opts, signal) {
  const allowedOrigin = new URL(op.search).origin;
  const r = await safeFetch(url, Object.assign({ signal, allowedOrigin }, opts));
  if (!r.ok) {
    const error = new Error('supplier request failed');
    error.code = 'LIVE_UPSTREAM_STATUS';
    error.status = r.status;
    throw error;
  }
  return r;
}
// page: search_tour (turlar) | search_hotel (faqat mehmonxona) | tickets (aviachiptalar)
const pageUrl = (op, page) => (page === 'search_tour' ? op.search : op.search.replace(/[^/]*$/, page));
const selectOptions = (html, name) => {
  const sel = html.match(new RegExp('<select[^>]*name="' + name + '"[^>]*>([\\s\\S]*?)</select>', 'i'));
  return sel ? [...sel[1].matchAll(/<option[^>]*value="([\d.]+)"[^>]*>([^<]+)/g)].map(x => ({ inc: x[1], title: x[2].trim() })) : [];
};
async function session(op, signal, page) {
  page = page || 'search_tour';
  const sk = op.id + '|' + page;
  const s = sessions.get(sk);
  if (s && Date.now() - s.at < 20 * 60000) return s;
  const r = await http(op, pageUrl(op, page), { headers: { 'User-Agent': UA, Accept: 'text/html' } }, signal);
  const cookie = (r.headers.getSetCookie ? r.headers.getSetCookie() : []).map(c => c.split(';')[0]).join('; ');
  const html = await r.text();
  // Jo'nash shaharlari va davlatlar sahifaning o'zida: <select name="TOWNFROMINC"> <option value="1853">Ташкент</option>
  const ns = { base: r.url.split('?')[0], cookie, towns: selectOptions(html, 'TOWNFROMINC'), states: selectOptions(html, 'STATEINC'), at: Date.now() };
  sessions.set(sk, ns);
  return ns;
}
async function samo(op, qs, signal, page) {
  const s = await session(op, signal, page);
  const r = await http(op, s.base + '?' + qs, { headers: { 'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest', Referer: s.base, Cookie: s.cookie } }, signal);
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
const shiftIso = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const tomorrowIso = () => shiftIso(new Date().toISOString().slice(0, 10), 1);

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
    // "Consul Hotel *** (Баку)", "Rixos 5* (Antalya)", "SAN MARINO HOTEL ** (Dubai (Deira))" — oxirgi qavs (ichma-ich ham) shahar
    let rest = text(hotelTd.html), city = '';
    if (rest.endsWith(')')) {
      for (let i = rest.length - 1, d = 0; i >= 0; i--) {
        if (rest[i] === ')') d++;
        else if (rest[i] === '(' && --d === 0) { city = rest.slice(i + 1, -1).trim(); rest = rest.slice(0, i).trim(); break; }
      }
    }
    const sm = rest.match(/\s*(\*{1,5}|\d\s*\*)\s*$/);
    const stars = sm ? (/\d/.test(sm[1]) ? +sm[1].match(/\d/)[0] : sm[1].length) : 0;
    const name = (sm ? rest.slice(0, sm.index) : rest).trim();
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

// ---------- Faqat mehmonxona (search_hotel): reyssiz narx ----------
// q = { country, date, nights, adults, childAges, window }
async function searchHotels(op, q) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    let s;
    try { s = await session(op, ctl.signal, 'search_hotel'); }
    catch (e) { if (e.status === 404) return { offers: [], note: 'no_page' }; throw e; }   // operatorda "faqat mehmonxona" sahifasi yo'q
    const want = (COUNTRY_RU[q.country] || []).map(norm);
    let st = s.states.find(x => want.includes(norm(x.title)));
    if (!st) st = options(await samo(op, 'samo_action=STATEINC', ctl.signal, 'search_hotel'), 'STATEINC').find(x => want.includes(norm(x.title)));
    if (!st) return { offers: [], note: 'no_country' };
    const tm = tomorrowIso();
    const beg = shiftIso(q.date, -(q.window || 0)) < tm ? tm : shiftIso(q.date, -(q.window || 0));
    const end = shiftIso(q.date, q.window || 0);
    const ages = (q.childAges || []).slice(0, 4);
    const qs = new URLSearchParams({
      samo_action: 'PRICES', STATEINC: st.inc, TOURINC: '0', CHECKIN_BEG: ymd(beg), CHECKIN_END: ymd(end),
      NIGHTS_FROM: String(q.nights), NIGHTS_TILL: String(q.nights), ADULT: String(q.adults), CHILD: String(ages.length),
      CURRENCY: '2', PRICEPAGE: '1', DOLOAD: '1'
    });
    ages.forEach((a, i) => qs.set('AGES' + (i + 1), String(a)));
    const js = await samo(op, qs.toString(), ctl.signal, 'search_hotel');
    if (/временно недоступен/.test(unescapeJs(js))) return { offers: [], note: 'closed' };
    const offers = parseRows(op, js).filter(o => o.checkIn >= beg && o.checkIn <= end && o.nights === q.nights);
    return { offers, note: offers.length ? '' : 'empty' };
  } finally { clearTimeout(timer); }
}

// ---------- Aviachiptalar (tickets): charter va blok reyslar ----------
// q = { to (davlat kodi), from, date, ret|null, adults, childAges, cabin: eco|bus, window }
const dmyOf = (iso) => iso.slice(8, 10) + '.' + iso.slice(5, 7) + '.' + iso.slice(0, 4);
const isoOfDmy = (s) => { const m = String(s || '').match(/^(\d{2})\.(\d{2})\.(\d{4})$/); return m ? m[3] + '-' + m[2] + '-' + m[1] : ''; };
const minutes = (hhmm) => { const m = String(hhmm || '').match(/(\d+):(\d+)/); return m ? +m[1] * 60 + +m[2] : 0; };
// Reys bor kunlar: datePicker({"start":"19.11.2026","valid":"0001000..."}) — har bir raqam bitta kun
function validDays(js, ctl) {
  const m = js.match(new RegExp('controls\\.' + ctl + '\\)\\.datePicker\\(\\{[^}]*?"start":"([^"]+)","valid":"([0-9]+)"'));
  if (!m) return [];
  const start = isoOfDmy(m[1]), out = [];
  for (let i = 0; i < m[2].length; i++) if (m[2][i] !== '0') out.push(shiftIso(start, i));
  return out;
}
// Qayerga uchish mumkin: davlatlar bo'yicha guruhlangan shaharlar
function destGroups(js) {
  const m = js.match(/controls\.TOWNTOINC\)\.addOptions\(\s*\[([\s\S]*?)\]\s*\);/);
  if (!m) return [];
  return [...m[1].matchAll(/\{title:\s*'([^']*)',\s*children:\s*\[([\s\S]*?)\]\s*\}/g)].map(g => ({
    country: unescapeJs(g[1]),
    towns: [...g[2].matchAll(/inc:\s*'([\d.]+)',\s*title:\s*'([^']*)'/g)].map(x => ({ inc: x[1].split('.')[0], title: unescapeJs(x[2]) }))
  }));
}
// "marker = [ ... ]" dagi JSON massivni qavslarni sanab ajratish (satr ichidagi qavslar hisobga olinmaydi)
function jsonArrayAfter(js, marker) {
  let i = js.indexOf(marker);
  if (i < 0) return null;
  i = js.indexOf('[', i);
  if (i < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let j = i; j < js.length; j++) {
    const c = js[j];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') { depth--; if (depth === 0) { try { return JSON.parse(js.slice(i, j + 1)); } catch (e) { return null; } } }
  }
  return null;
}
function seatsCode(status, text) {
  const code = typeof status === 'number' || /^\d+$/.test(String(status)) ? Number(status) : null;
  if (/нет мест/i.test(text || '') || code === 0) return 'none';
  if (/мало/i.test(text || '') || code === 3) return 'few';
  return 'unknown';
}
async function searchFlights(op, q) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    let s;
    try { s = await session(op, ctl.signal, 'tickets'); }
    catch (e) { if (e.status === 404) return { offers: [], note: 'no_page' }; throw e; }   // operatorda aviachipta sahifasi yo'q
    const wantFrom = (FROM_RU[q.from] || FROM_RU.tas).map(norm);
    const from = s.towns.find(t => wantFrom.some(w => norm(t.title).indexOf(w) === 0));
    if (!from) return { offers: [], note: 'no_departure' };
    const fromInc = from.inc.split('.')[0];
    const want = (COUNTRY_RU[q.to] || []).map(norm);
    const groups = destGroups(await samo(op, 'samo_action=TOWNFROMINC&TOWNFROMINC=' + fromInc, ctl.signal, 'tickets'));
    const towns = [].concat(...groups.filter(g => want.includes(norm(g.country))).map(g => g.towns)).slice(0, 3);
    if (!towns.length) return { offers: [], note: 'no_country' };
    const w = q.window || 0;
    const tm = tomorrowIso();
    const beg = shiftIso(q.date, -w) < tm ? tm : shiftIso(q.date, -w), end = shiftIso(q.date, w);
    const offers = [];
    for (const town of towns) {
      // Reys bor kunlardan tanlangan sanaga eng yaqinini olamiz (charter har kuni uchmaydi)
      const days = validDays(await samo(op, `samo_action=TOWNTOINC&TOWNFROMINC=${fromInc}&TOWNTOINC=${town.inc}`, ctl.signal, 'tickets'), 'CHECKIN')
        .filter(d => d >= beg && d <= end);
      if (!days.length) continue;
      const near = days.slice().sort((a, b) => Math.abs(Date.parse(a) - Date.parse(q.date)) - Math.abs(Date.parse(b) - Date.parse(q.date)))[0];
      const ages = (q.childAges || []).slice(0, 3);
      const p = new URLSearchParams({
        samo_action: 'PRICES', TOWNFROMINC: fromInc, TOWNTOINC: town.inc, CHECKIN: dmyOf(near), CHECKIN_DELTA: String(Math.max(w, 1)),
        ADULT: String(q.adults), CHILD: String(ages.length), CLASS: q.cabin === 'bus' ? '1' : '0', AIRLINE: '0', CURRENCYINC: '2',
        DIRECT_FLIGHT: '0', YESPLACES: '1'
      });
      ages.forEach((a, i) => p.set('age' + (i + 1), String(a)));
      if (q.ret) { p.set('ONEWAY', '0'); p.set('FREIGHTBACK', '1'); p.set('CHECKOUT', dmyOf(q.ret)); p.set('CHECKOUT_DELTA', String(Math.max(w, 1))); }
      else { p.set('ONEWAY', '1'); p.set('FREIGHTBACK', '0'); }
      const js = await samo(op, p.toString(), ctl.signal, 'tickets');
      const list = jsonArrayAfter(js, 'samo.priceAirlines');
      if (!list) continue;
      list.forEach(f => {
        if (+f.CurrencyInc !== 2) return;
        const date = isoOfDmy(f.DateBeg);
        if (!date || date < beg || date > end) return;
        const back = q.ret && f.DateBegBack ? {
          date: isoOfDmy(f.DateBegBack), no: f.FreightNameBack, dep: minutes(f.SrcTimeBack), arr: minutes(f.TrgTimeBack), dur: minutes(f.FlyTimeBack),
          fromCode: f.SrcPortAliasBack, toCode: f.TrgPortAliasBack, seats: seatsCode(f.BlockStatusOut, f.BlockCountOut)
        } : null;
        if (q.ret && !back) return;
        const seats = seatsCode(f.BlockStatusIn, f.BlockCountIn);
        if (seats === 'none' || (back && back.seats === 'none')) return;
        offers.push({
          opId: op.id, freight: String(f.FreightInc) + (back ? '-' + f.FreightIncBack : ''), airline: f.PartnerInName || '', no: f.FreightName || '',
          aircraft: f.TranTypeNameIn || '', fromCode: f.SrcPortAlias, fromCity: f.SrcTownName, toCode: f.TrgPortAlias, toCity: f.TrgTownName,
          date, dep: minutes(f.SrcTime), arr: minutes(f.TrgTime), dur: minutes(f.FlyTimeTo), back,
          price: Math.round(+f.TotalCost), seats: back && back.seats === 'few' ? 'few' : seats, bagKg: null, direct: null
        });
      });
    }
    return { offers, note: offers.length ? '' : 'empty' };
  } finally { clearTimeout(timer); }
}

module.exports = { search, searchHotels, searchFlights, parseRows, mealCode, seatsCode, COUNTRY_RU };
