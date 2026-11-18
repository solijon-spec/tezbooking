/*
 * TezBooking — demo ma'lumotlar va narx hisoblash.
 *
 * DIQQAT: operatorlar, mehmonxonalar va narxlar o'ylab topilgan (demo).
 * Haqiqiy versiyada offersFor() o'rniga turoperatorlarning API'si (masalan, SAMO XML-shlyuzi) ishlatiladi.
 * Interfeys (app.js) har bir taklifni quyidagi ko'rinishda kutadi:
 *   { key, op: {id, name, color}, meal: 'BB'|'HB'|'AI'|'UAI', room: 'std'|'sup'|'dlx', price,
 *     avail: 'ok'|'few'|'req'|'stop', seats: 'ok'|'few'|'none', instant: true|false }
 * Nomlar (davlat, shahar, ovqat, xona) tilga qarab js/i18n.js dan olinadi.
 */
(function (global) {
  'use strict';

  // ---------- Turoperatorlar (demo) ----------
  const OPS = [
    { id: 'silk', name: 'Silk Way Tour', color: '#2563EB', f: 1.0 },
    { id: 'orient', name: 'Orient Travel', color: '#C2410C', f: 1.03 },
    { id: 'sky', name: 'SkyBridge Tours', color: '#0F766E', f: 0.985 },
    { id: 'navruz', name: "Navro'z Travel", color: '#7C3AED', f: 1.05 },
    { id: 'kamalak', name: 'Kamalak Tour', color: '#BE185D', f: 1.015 }
  ];

  // ---------- Davlatlar ----------
  // flight — bir kishilik aviareys (USD), k — mehmonxona narxi koeffitsienti
  const COUNTRIES = [
    { id: 'tr', region: 'kavkaz', flight: 260, k: 1.0, tint: '#1E5A8A', cities: ['antalya', 'alanya', 'kemer', 'side', 'belek'] },
    { id: 'ge', region: 'kavkaz', flight: 220, k: 0.8, tint: '#2F6B3A', cities: ['batumi', 'tbilisi'] },
    { id: 'az', region: 'kavkaz', flight: 210, k: 0.75, tint: '#3B4F8F', cities: ['baku', 'naftalan', 'gabala'] },
    { id: 'ae', region: 'sharq', flight: 230, k: 1.25, tint: '#7A5410', cities: ['dubai', 'sharjah', 'rak'] },
    { id: 'eg', region: 'sharq', flight: 300, k: 0.85, tint: '#8A3B12', cities: ['sharm', 'hurghada'] },
    { id: 'my', region: 'osiyo', flight: 420, k: 0.9, tint: '#14636B', cities: ['kl', 'langkawi'] },
    { id: 'th', region: 'osiyo', flight: 480, k: 0.85, tint: '#6B3A82', cities: ['phuket', 'pattaya'] },
    { id: 'vn', region: 'osiyo', flight: 520, k: 0.7, tint: '#8A2E3B', cities: ['nhatrang', 'phuquoc'] },
    { id: 'id', region: 'osiyo', flight: 560, k: 0.95, tint: '#2E6B4F', cities: ['kuta', 'ubud', 'nusadua'] },
    { id: 'lk', region: 'osiyo', flight: 450, k: 0.75, tint: '#93450F', cities: ['bentota', 'hikkaduwa'] },
    { id: 'mv', region: 'osiyo', flight: 520, k: 2.0, tint: '#0E6E8C', cities: ['male', 'ari'] }
  ];
  const REGIONS = ['kavkaz', 'sharq', 'osiyo'];

  // ---------- Mehmonxonalar (demo) ----------
  // [id, nomi, davlat, shahar, yulduz, reyting]
  const RAW_HOTELS = [
    ['tr1', 'Lara Sunset Resort', 'tr', 'antalya', 5, 9.1],
    ['tr2', 'Antaliya City Inn', 'tr', 'antalya', 3, 7.9],
    ['tr3', 'Konyaalti Beach Hotel', 'tr', 'antalya', 4, 8.3],
    ['tr4', 'Alanya Blue Coast', 'tr', 'alanya', 4, 8.4],
    ['tr5', 'Alanya Sun Club', 'tr', 'alanya', 3, 7.6],
    ['tr6', 'Alanya Family Club', 'tr', 'alanya', 4, 8.0],
    ['tr7', 'Kemer Pine Hotel', 'tr', 'kemer', 4, 8.6],
    ['tr8', 'Kemer Marina Suites', 'tr', 'kemer', 5, 8.9],
    ['tr9', 'Side Olive Garden', 'tr', 'side', 5, 9.0],
    ['tr10', 'Side Aqua Park Hotel', 'tr', 'side', 4, 8.2],
    ['tr11', 'Belek Royal Palace', 'tr', 'belek', 5, 9.3],
    ['tr12', 'Belek Golf Resort', 'tr', 'belek', 5, 8.8],
    ['ae1', 'Dubai Creek View', 'ae', 'dubai', 4, 8.5],
    ['ae2', 'Marina Pearl Hotel', 'ae', 'dubai', 5, 9.0],
    ['ae3', 'Deira Business Hotel', 'ae', 'dubai', 3, 7.8],
    ['ae4', 'Al Barsha Sands Hotel', 'ae', 'dubai', 4, 8.3],
    ['ae5', 'Sharja Corniche Inn', 'ae', 'sharjah', 3, 7.7],
    ['ae6', 'Al Majaz Lake Hotel', 'ae', 'sharjah', 4, 8.1],
    ['ae7', 'RAK Beach Resort', 'ae', 'rak', 5, 8.9],
    ['ae8', 'Al Marjan Island Hotel', 'ae', 'rak', 4, 8.4],
    ['eg1', 'Red Sea Coral Resort', 'eg', 'sharm', 5, 8.8],
    ['eg2', 'Naama Bay Hotel', 'eg', 'sharm', 4, 8.2],
    ['eg3', 'Sharm Garden Inn', 'eg', 'sharm', 3, 7.6],
    ['eg4', 'Hurghada Palm Beach', 'eg', 'hurghada', 4, 8.3],
    ['eg5', 'Sahl Hasheesh Resort', 'eg', 'hurghada', 5, 9.0],
    ['eg6', 'Makadi Garden Hotel', 'eg', 'hurghada', 3, 7.8],
    ['ge1', 'Batumi Sea Tower', 'ge', 'batumi', 4, 8.6],
    ['ge2', 'Batumi Boulevard Inn', 'ge', 'batumi', 3, 8.0],
    ['ge3', 'Black Sea Grand Hotel', 'ge', 'batumi', 5, 9.0],
    ['ge4', 'Old Tbilisi Boutique', 'ge', 'tbilisi', 4, 8.9],
    ['ge5', 'Tbilisi Riverside Hotel', 'ge', 'tbilisi', 3, 7.9],
    ['az1', 'Caspian Boulevard Hotel', 'az', 'baku', 4, 8.5],
    ['az2', 'Baku Old City Inn', 'az', 'baku', 3, 8.1],
    ['az3', 'Baku Skyline Hotel', 'az', 'baku', 5, 9.0],
    ['az4', 'Naftalan Health Resort', 'az', 'naftalan', 4, 8.4],
    ['az5', 'Gabala Mountain Lodge', 'az', 'gabala', 4, 8.7],
    ['my1', 'KL Twin View Hotel', 'my', 'kl', 4, 8.6],
    ['my2', 'Bukit Bintang Suites', 'my', 'kl', 3, 8.0],
    ['my3', 'Langkawi Cenang Resort', 'my', 'langkawi', 4, 8.5],
    ['my4', 'Langkawi Rainforest Resort', 'my', 'langkawi', 5, 9.1],
    ['th1', 'Patong Bay Hotel', 'th', 'phuket', 4, 8.4],
    ['th2', 'Kata Palm Resort', 'th', 'phuket', 5, 8.9],
    ['th3', 'Pattaya Beach Inn', 'th', 'pattaya', 3, 7.7],
    ['th4', 'Jomtien Garden Hotel', 'th', 'pattaya', 4, 8.2],
    ['vn1', 'Nha Trang Bay Hotel', 'vn', 'nhatrang', 4, 8.3],
    ['vn2', 'Tran Phu Inn', 'vn', 'nhatrang', 3, 7.8],
    ['vn3', 'Phu Quoc Pearl Resort', 'vn', 'phuquoc', 5, 9.0],
    ['id1', 'Kuta Surf Hotel', 'id', 'kuta', 3, 7.9],
    ['id2', 'Ubud Jungle Villas', 'id', 'ubud', 4, 9.0],
    ['id3', 'Nusa Dua Lagoon Resort', 'id', 'nusadua', 5, 9.1],
    ['lk1', 'Bentota Beach Resort', 'lk', 'bentota', 4, 8.4],
    ['lk2', 'Golden Sands Bentota', 'lk', 'bentota', 5, 8.8],
    ['lk3', 'Hikkaduwa Coral Inn', 'lk', 'hikkaduwa', 3, 7.8],
    ['mv1', 'Maafushi Beach Hotel', 'mv', 'male', 3, 8.2],
    ['mv2', 'Blue Reef Island', 'mv', 'male', 4, 8.7],
    ['mv3', 'Coral Lagoon Island Resort', 'mv', 'ari', 5, 9.3]
  ];
  const HOTELS = RAW_HOTELS.map(a => ({ id: a[0], name: a[1], country: a[2], city: a[3], stars: a[4], rating: a[5] }));
  const HOTEL_BY_ID = {};
  HOTELS.forEach(h => { HOTEL_BY_ID[h.id] = h; });

  // ---------- Uchish shaharlari: add — aviareysga qo'shimcha (USD) ----------
  const FROM = [{ id: 'tas', add: 0, code: 'TAS' }, { id: 'skd', add: 35, code: 'SKD' }, { id: 'dyu', add: 55, code: 'DYU' }];
  const HOME_TZ = 5; // Toshkent / Samarqand / Dushanbe: UTC+5

  // ---------- Aviachiptalar (demo) ----------
  // Aviakompaniyalar o'ylab topilgan. f — narx koeffitsienti, low — arzon (bagajsiz tariflar ko'p)
  const AIRLINES = [
    { id: 'silkair', code: 'SX', name: 'Silk Air', color: '#0284C7', f: 1.0 },
    { id: 'turan', code: 'TW', name: 'Turan Wings', color: '#B45309', f: 0.97 },
    { id: 'pamir', code: 'PJ', name: 'Pamir Jet', color: '#15803D', f: 0.9, low: true },
    { id: 'caspian', code: 'KW', name: 'Caspian Wings', color: '#7C3AED', f: 1.04 },
    { id: 'aral', code: 'AV', name: 'Aral Avia', color: '#BE123C', f: 1.08 }
  ];
  // Har bir davlatning asosiy aeroporti: hrs — Toshkentdan to'g'ri reys davomiyligi, tz — UTC farqi
  const AIRPORTS = {
    tr: { code: 'AYT', city: 'antalya', hrs: 5.0, tz: 3 },
    ge: { code: 'TBS', city: 'tbilisi', hrs: 3.0, tz: 4 },
    az: { code: 'GYD', city: 'baku', hrs: 2.6, tz: 4 },
    ae: { code: 'DXB', city: 'dubai', hrs: 3.3, tz: 4 },
    eg: { code: 'SSH', city: 'sharm', hrs: 5.5, tz: 2 },
    my: { code: 'KUL', city: 'kl', hrs: 6.5, tz: 8 },
    th: { code: 'HKT', city: 'phuket', hrs: 7.0, tz: 7 },
    vn: { code: 'CXR', city: 'nhatrang', hrs: 7.5, tz: 7 },
    id: { code: 'DPS', city: 'denpasar', hrs: 9.5, tz: 8 },
    lk: { code: 'CMB', city: 'colombo', hrs: 5.5, tz: 5.5 },
    mv: { code: 'MLE', city: 'malecity', hrs: 5.0, tz: 5 }
  };
  const HUBS = ['IST', 'DXB', 'GYD', 'KUL', 'DOH'];

  const MEALS = { BB: { f: 1 }, HB: { f: 1.15 }, AI: { f: 1.32 }, UAI: { f: 1.45 } };
  const ROOMS = [{ id: 'std', f: 1 }, { id: 'sup', f: 1.07 }, { id: 'dlx', f: 1.15 }];

  const byId = {};
  COUNTRIES.forEach(c => { byId[c.id] = c; });

  const UZS_RATE = 12100; // demo kurs: 1 USD = 12 100 so'm (haqiqiy versiyada Markaziy bank kursi olinadi)

  // ---------- Yordamchilar ----------
  // Demo narxlar har safar bir xil chiqishi uchun "urug'li" tasodifiy son
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function rnd(str) {
    let t = (hash(str) + 0x6D2B79F5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  const date = {
    parse(iso) { const p = String(iso).split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); },
    iso(d) { return d.toISOString().slice(0, 10); },
    localToday() { const n = new Date(); return date.iso(new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()))); },
    addDays(iso, n) { const d = date.parse(iso); d.setUTCDate(d.getUTCDate() + n); return date.iso(d); },
    isValid(iso) { return /^\d{4}-\d{2}-\d{2}$/.test(String(iso)) && !isNaN(date.parse(iso)); }
  };

  // ---------- Real vaqtdagi mavjudlik ----------
  // Demo: takliflarning bir qismi kun davomida tasodifiy paytda sotilib ketadi (vaqt o'tishi bilan ro'yxatdan yo'qoladi).
  // Haqiqiy versiyada bu yerda operator API'sidan joylar soni muntazam so'raladi.
  // Bron qilingan takliflar (booked) ham qidiruvdan olib tashlanadi.
  let now = () => Date.now();
  const booked = {};
  let goneVer = 0;  // bron ro'yxati o'zgarganda keshni yangilash uchun
  function soldOut(key) {
    if (rnd(key + 'so') >= 0.12) return false;
    const n = new Date(now());
    const dayStart = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
    return now() >= dayStart + rnd(key + 'sot') * 86400000;
  }
  const isGone = (key) => !!booked[key] || soldOut(key);
  function setBooked(keys) {
    Object.keys(booked).forEach(k => { delete booked[k]; });
    keys.forEach(k => { booked[k] = true; });
    goneVer++;
  }

  // Bolalar narxi yoshiga qarab: 2 yoshgacha — mehmonxona bepul, reysning 10 %;
  // 2–11 yosh — mehmonxonaning 50 %, reysning 75 %; 12+ — katta kishi kabi.
  const childHotelF = (age) => (age < 2 ? 0 : age < 12 ? 0.5 : 1);
  const childFlightF = (age) => (age < 2 ? 0.1 : age < 12 ? 0.75 : 1);

  // ---------- Bitta mehmonxona uchun barcha operatorlarning takliflari ----------
  // q = { from, nights, adults, childAges: [yosh, ...], rooms }
  function offersFor(h, q, dateIso) {
    const c = byId[h.country];
    const from = FROM.find(x => x.id === q.from) || FROM[0];
    const ages = q.childAges || [];
    const rooms = q.rooms || 1;
    const base = ({ 3: 38, 4: 62, 5: 105 })[h.stars] * (0.9 + 0.3 * rnd(h.id + 'b')) * c.k;
    const mealOpts = h.stars === 5 ? ['AI', 'UAI'] : h.stars === 4 ? ['HB', 'AI'] : ['BB', 'HB'];
    const dow = date.parse(dateIso).getUTCDay();
    const dateF = (dow === 5 || dow === 6 ? 1.06 : 1) * (0.95 + 0.1 * rnd(dateIso + c.id));
    let ops = OPS.filter(o => rnd(h.id + o.id) < 0.7);
    if (ops.length < 2) ops = OPS.slice().sort((a, b) => rnd(h.id + a.id + 's') - rnd(h.id + b.id + 's')).slice(0, 2);
    const pax = q.adults + ages.reduce((s, a) => s + childHotelF(a), 0);
    const fpax = q.adults + ages.reduce((s, a) => s + childFlightF(a), 0);
    const roomsF = 1 + 0.12 * (rooms - 1);
    return ops.map(o => {
      const meal = mealOpts[rnd(h.id + o.id + 'm') < 0.5 ? 0 : 1];
      const room = ROOMS[Math.min(2, Math.floor(rnd(h.id + o.id + 'r') * 2.4))];
      const of = o.f * (0.95 + 0.1 * rnd(h.id + o.id + dateIso));
      const hotelPart = base * q.nights * pax * MEALS[meal].f * room.f * roomsF;
      // q.noFlight — faqat mehmonxona (Mehmonxonalar bo'limi): aviareys narxga qo'shilmaydi
      const flight = q.noFlight ? 0 : (c.flight + from.add) * fpax;
      const price = Math.round((hotelPart + flight) * dateF * of / 5) * 5;
      const ra = rnd(h.id + o.id + dateIso + 'a');
      const avail = ra < 0.62 ? 'ok' : ra < 0.82 ? 'few' : ra < 0.94 ? 'req' : 'stop';
      const rf = rnd(h.id + o.id + dateIso + 'f');
      const seats = rf < 0.75 ? 'ok' : rf < 0.93 ? 'few' : 'none';
      const instant = rnd(h.id + o.id + 'i') < 0.55;
      const key = [h.id, o.id, dateIso, q.nights, q.adults, ages.join('.'), rooms, q.noFlight ? 'H' : q.from].join('|');
      return { key, op: o, meal, room: room.id, price, avail, seats, instant };
    // Sotilganlar umuman qaytarilmaydi: sotuvi to'xtagan, reysda joy qolmagan (tur uchun), sotilib ketgan yoki bron qilingan
    }).filter(o => o.avail !== 'stop' && (q.noFlight || o.seats !== 'none') && !isGone(o.key));
  }

  // ---------- Qaynoq taklif: keyingi 3 hafta ichidagi eng arzon tur (2 katta, 7 tun) ----------
  const hotCache = {};
  let hotStamp = '';
  function hotFor(countryId, from, today, noFlight) {
    // Kesh har daqiqada va har bron qilinganda tozalanadi (sotilganlar qaynoq takliflarda qolmasin)
    const stamp = Math.floor(now() / 60000) + '|' + goneVer;
    if (stamp !== hotStamp) { hotStamp = stamp; Object.keys(hotCache).forEach(k => { delete hotCache[k]; }); }
    const key = countryId + '|' + from + '|' + today + '|' + (noFlight ? 'H' : 'T');
    if (hotCache[key] !== undefined) return hotCache[key];
    const q = { from, adults: 2, childAges: [], rooms: 1, nights: 7, noFlight: !!noFlight };
    const hs = HOTELS.filter(h => h.country === countryId);
    let best = null;
    for (let i = 3; i <= 24; i++) {
      const d = date.addDays(today, i);
      hs.forEach(h => offersFor(h, q, d).forEach(o => {
        if ((o.avail === 'ok' || o.avail === 'few') && (!best || o.price < best.price)) {
          best = { price: o.price, date: d, hotelId: h.id };
        }
      }));
    }
    hotCache[key] = best;
    return best;
  }

  // ---------- Aviareyslar ----------
  // Bitta yo'nalish (leg): dep/arr — mahalliy vaqt (daqiqa, 0..1439), days — kelish necha kun keyin, dur — davomiylik (daqiqa)
  function legFor(seed, dateIso, hrs, tzDiff, direct, avoid) {
    const dep = 5 * Math.floor(rnd(seed + 'd') * 287);
    let dur = Math.round(hrs * 60 * (0.95 + 0.1 * rnd(seed + 'u')) / 5) * 5;
    let via = null;
    if (!direct) {
      dur += 5 * Math.round((80 + rnd(seed + 'w') * 200) / 5);
      const hubs = HUBS.filter(x => avoid.indexOf(x) < 0);
      via = hubs[Math.floor(rnd(seed + 'v') * hubs.length)];
    }
    const arrAbs = dep + dur + Math.round(tzDiff * 60);
    return { date: dateIso, dep, arr: ((arrAbs % 1440) + 1440) % 1440, days: Math.floor(arrAbs / 1440), dur, via };
  }

  // q = { from, to (davlat id), ret (qaytish sanasi yoki null), adults, childAges, cabin: 'eco'|'bus' }
  // Narx — barcha yo'lovchilar uchun jami (borish yoki borish-qaytish)
  function flightsFor(q, dateIso) {
    const c = byId[q.to], ap = AIRPORTS[q.to];
    const from = FROM.find(x => x.id === q.from) || FROM[0];
    const ages = q.childAges || [];
    const fpax = q.adults + ages.reduce((s, a) => s + childFlightF(a), 0);
    const route = from.id + '-' + q.to;
    const dow = date.parse(dateIso).getUTCDay();
    const dateF = (dow === 5 || dow === 6 ? 1.07 : 1) * (0.92 + 0.16 * rnd(dateIso + route));
    const out = [];
    AIRLINES.forEach(al => {
      if (rnd(route + al.id) > 0.78) return;                    // bu yo'nalishda uchmaydi
      if (rnd(route + al.id + dateIso) > 0.85) return;          // shu kuni reys yo'q
      const n = rnd(route + al.id + 'n') < 0.35 ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const seed = route + al.id + i;
        const direct = rnd(seed + 'x') < (ap.hrs > 7 ? 0.25 : 0.62);
        const avoid = [ap.code, from.code];
        const leg = legFor(seed, dateIso, ap.hrs, ap.tz - HOME_TZ, direct, avoid);
        const back = q.ret ? legFor(seed + 'r', q.ret, ap.hrs * 0.95, HOME_TZ - ap.tz, direct, avoid) : null;
        const hand = q.cabin === 'eco' && rnd(seed + 'b') < (al.low ? 0.7 : 0.25);
        const bag = q.cabin === 'bus' ? 'b2x32' : hand ? 'hand' : (rnd(seed + 'g') < 0.5 ? 'b20' : 'b23');
        let pp = (c.flight + from.add) * 0.62 * al.f * dateF * (direct ? 1.12 : 0.9) * (hand ? 0.85 : 1) * (0.95 + 0.1 * rnd(seed + dateIso + 'p'));
        if (q.ret) pp *= 1.8 * (0.95 + 0.1 * rnd(seed + q.ret + 'p'));
        if (q.cabin === 'bus') pp *= 2.7;
        const rs = rnd(seed + dateIso + 's');
        if (rs > 0.93) continue;                                // joy qolmagan — ko'rsatilmaydi
        const key = ['F', al.id, i, from.id, q.to, dateIso, q.ret || '', q.adults, ages.join('.'), q.cabin].join('|');
        if (isGone(key)) continue;                              // sotilib ketgan yoki bron qilingan
        const num = 100 + Math.floor(rnd(seed + 'no') * 800) * 2;
        out.push({
          key,
          al, to: q.to, no: al.code + ' ' + num, backNo: al.code + ' ' + (num + 1),
          fromCode: from.code, toCode: ap.code, out: leg, back, direct, bag,
          price: Math.round(pp * fpax / 5) * 5, seats: rs < 0.68 ? 'ok' : 'few'
        });
      }
    });
    return out;
  }

  global.TB = { OPS, COUNTRIES, REGIONS, HOTELS, HOTEL_BY_ID, FROM, MEALS, ROOMS, AIRLINES, AIRPORTS, byId, UZS_RATE, date, offersFor, hotFor, flightsFor,
    isGone, setBooked, setClock: (fn) => { now = fn; } };
})(window);
