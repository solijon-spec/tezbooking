'use strict';

/*
 * Agent ishchilari (worker adapterlar) — saytning jonli qidiruvi orqali (server/live, SAMO ochiq qidiruv sahifalari).
 *
 * Main Agent topshirig'i (davlat, kurort, sana, kechalar, kishilar, ...) har bir ulangan operator ishchisiga tarqatiladi.
 * Ishchi shu operatorning ochiq "Поиск тура" sahifasidan turlarni oladi (sayt va Telegram bot bilan umumiy kesh),
 * so'ng topshiriq bo'yicha saralaydi: kurort/shahar, ovqatlanish, yulduz, byudjet. Login va himoya chetlab o'tilmaydi.
 *
 * Sayt operatorlari (server/live OPERATORS) bilan Owner bazasidagi operatorlar id'lari: "vietra" -> "vietratour",
 * qolganlari bir xil. Jonli ulagichi yo'q operatorlar (Asialuxe, Pegas, Rezlive, ...) "Ulanmagan" bo'lib qoladi.
 */

const { DESTINATIONS, countryCode } = require('../../js/agent-parser.js');

const SITE_TO_LIVE = {
  aqua: 'aqua', crystalbay: 'crystalbay', kompas: 'kompas', prestige: 'prestige', vietra: 'vietratour',
  fstravel: 'fstravel', kazunion: 'kazunion', centrum: 'centrum', flykhiva: 'flykhiva', easybooking: 'easybooking',
  selfie: 'selfie', savtour: 'savtour', malva: 'malva'
};
const MAX_OFFERS = 100;   // service.completeExecution chegarasi

// Kurort nomi -> operator yozadigan shahar/hudud nomlari (so'z boshi bo'yicha). "Antalya" — butun Antaliya sohili.
const ALANYA = ['alany', 'алань', 'avsallar', 'авсаллар', 'konakli', 'конаклы', 'okurcalar', 'окурджалар', 'incekum', 'инджекум',
  'mahmutlar', 'махмутлар', 'turkler', 'тюрклер', 'payallar', 'паяллар', 'kargicak', 'каргыджак'];
const REGIONS = {
  antalya: ['antal', 'анталь', 'анталия', 'kemer', 'кемер', 'belek', 'белек', 'side', 'сиде', 'lara', 'лара', 'kundu', 'кунду',
    'konyaalt', 'коньяалт', 'beldibi', 'бельдиби', 'tekirova', 'текиров', 'goynuk', 'гейнюк', 'camyuva', 'чамьюв', 'kiris', 'кириш',
    'manavgat', 'манавгат', 'evrenseki', 'эвренсеки', 'kizilagac', 'кызылагач', 'kizilot', 'кызылот', 'titreyengol', 'титрейенгель',
    'colakli', 'чолаклы', 'sorgun', 'соргун', 'bogazkent', 'богазкент', 'kadriye', 'кадрие'].concat(ALANYA),
  alanya: ALANYA,
  hurghada: ['hurghad', 'хургад', 'makadi', 'макади', 'sahl hasheesh', 'сахл хашиш', 'soma bay', 'сома бей', 'el gouna', 'эль гуна',
    'safaga', 'сафага'],
  'sharm el sheikh': ['sharm', 'шарм', 'nabq', 'набк', 'naama', 'наама'],
  phuket: ['phuket', 'пхукет', 'patong', 'патонг', 'karon', 'карон', 'kata', 'ката', 'kamala', 'камала', 'bang tao', 'банг тао'],
  bali: ['bali', 'бали', 'kuta', 'кута', 'nusa dua', 'нуса дуа', 'ubud', 'убуд', 'seminyak', 'семиньяк', 'jimbaran', 'джимбаран',
    'sanur', 'санур', 'canggu', 'чангу', 'legian', 'легиан'],
  dubai: ['dubai', 'дубай', 'дубаи', 'deira', 'дейра', 'jumeirah', 'джумейр', 'bur dubai', 'бур дубай'],
  'nha trang': ['nha trang', 'нячанг', 'нья чанг', 'cam ranh', 'камрань']
};
// Butun davlat bitta kurort (Maldiv orollari) — filtr qo'llanmaydi
const WHOLE_COUNTRY = new Set(['mv']);

const norm = (s) => ' ' + String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim() + ' ';

// Topshiriqdagi kurort -> moslik funksiyasi (null — filtr yo'q, butun davlat)
function destinationMatcher(destination, country) {
  const text = String(destination || '').trim();
  if (!text || WHOLE_COUNTRY.has(country) || countryCode(text) === country) return null;
  // "Antalya", "Antalyaga", "Анталья", "Дубае" — tahlilchidagi kabi so'z boshi bo'yicha (4+ harf)
  const typed = norm(text);
  const known = DESTINATIONS.find(([name, , aliases]) => [name].concat(aliases).some(alias => {
    const a = norm(alias).trim();
    return typed.includes(' ' + a + ' ') || (a.length >= 4 && typed.includes(' ' + a));
  }));
  const aliases = known
    ? (REGIONS[known[0].toLowerCase()] || []).concat(known[2], [known[0]])
    : [text];
  const wanted = [...new Set(aliases.map(a => norm(a).trim()).filter(a => a.length >= 3))];
  if (!wanted.length) return null;
  return (offer) => {
    const where = norm(offer.city) + norm(offer.hotel);
    return wanted.some(a => where.includes(' ' + a));
  };
}

const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const hhmm = (m) => String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
const AVAILABILITY = { ok: 'available', few: 'available', req: 'on_request' };

// Jonli taklif (samo.js) -> agent taklifi (normalize.js kutadigan ko'rinish)
function toAgentOffer(o, parameters, sourceUrl) {
  const route = o.fromCode && o.toCode ? o.fromCode + ' → ' + o.toCode : '';
  const when = o.depDate ? o.depDate + (o.dep != null ? ' ' + hhmm(o.dep) : '') : '';
  return {
    hotelName: o.hotel,
    sourceUrl,
    totalPrice: o.price,
    currency: 'USD',
    hotelStars: Number.isInteger(o.stars) && o.stars >= 1 ? o.stars : undefined,
    hotelLocation: o.city || undefined,
    city: o.city || undefined,
    roomType: o.room || undefined,
    mealPlan: o.meal,
    checkIn: o.checkIn,
    checkOut: o.checkIn && o.nights ? addDays(o.checkIn, o.nights) : undefined,
    nights: o.nights,
    adults: parameters.adults,
    children: (parameters.childrenAges || []).length,
    availability: AVAILABILITY[o.avail] || 'unknown',
    flightIncluded: true,               // tur paket qidiruvi (search_tour): parvoz paket ichida
    flightIncludedVerified: true,
    departure: [route, when].filter(Boolean).join(' · ') || undefined,
    gds: !!o.gds,
    verified: false                     // narx operatorning ochiq qidiruv sahifasidan; bron paytida operator tasdiqlaydi
  };
}

// Topshiriq bo'yicha saralash: kurort, ovqatlanish, yulduz, byudjet; sotuvda yo'q / reysda joy yo'q — chiqarilmaydi
function selectOffers(offers, parameters, { uzsRate, limit }) {
  let list = offers.filter(o => o && o.hotel && o.price > 0 && o.avail !== 'stop' && o.seats !== 'none');
  const soldOut = offers.length > 0 && list.length === 0;   // turlar bor, lekin joy yo'q (mehmonxona yoki reys)
  const matchesPlace = destinationMatcher(parameters.destination, parameters.country);
  const before = list.length;
  if (matchesPlace) list = list.filter(matchesPlace);
  const placeFiltered = !!matchesPlace && before > 0 && list.length === 0;
  if (parameters.mealPlan) list = list.filter(o => o.meal === parameters.mealPlan || (parameters.mealPlan === 'AI' && o.meal === 'UAI'));
  if (parameters.hotelStars) list = list.filter(o => o.stars >= parameters.hotelStars);
  if (parameters.budget) {
    const cap = parameters.currency === 'USD' ? parameters.budget
      : parameters.currency === 'UZS' && uzsRate > 0 ? parameters.budget / uzsRate : null;   // EUR kursi yo'q — filtr qo'llanmaydi
    if (cap) list = list.filter(o => o.price <= cap);
  }
  // Qidiruv ±3 kun (saytdagidek); chegara bo'lsa — aynan so'ralgan kundagilar birinchi, keyin eng arzoni
  const offDay = (o) => (o.checkIn === parameters.date ? 0 : 1);
  list.sort((a, b) => offDay(a) - offDay(b) || a.price - b.price || (a.avail === 'req') - (b.avail === 'req'));
  return { offers: list.slice(0, limit), placeFiltered, soldOut };
}

function liveParams(parameters) {
  const params = {
    country: parameters.country, date: parameters.date, nights: String(parameters.nights),
    // ±3 kun — sayt va Telegram bot bilan bir xil (kesh umumiy; charter reyslar haftaning ma'lum kunlarida)
    adults: String(parameters.adults), from: parameters.departureAirport || 'tas', window: '3'
  };
  if ((parameters.childrenAges || []).length) params.children = parameters.childrenAges.join(',');
  return params;
}

function workerError(code) {
  return Object.assign(new Error('live worker: ' + code), { code });
}

/*
 * Ishchilarni ro'yxatga olish va operatorlarni "ulangan" deb belgilash.
 *   live: createLive() natijasi (searchOne kerak), service: Owner service, workers: worker registry
 *   maxOffers: bitta operatordan nechta eng arzon taklif (1..100), uzsRate: so'm byudjetini USD ga o'tkazish uchun
 */
function registerLiveWorkers({ live, service, workers, maxOffers = 30, uzsRate = 0, now = Date.now }) {
  const limit = Math.max(1, Math.min(MAX_OFFERS, Number(maxOffers) || 30));
  const liveOps = new Map((live.OPERATORS || []).map(op => [op.id, op]));
  const known = new Set(service.listWebsites().map(site => site.id));
  const registered = [];
  Object.entries(SITE_TO_LIVE).forEach(([siteId, liveId]) => {
    const operator = liveOps.get(liveId);
    if (!operator || !known.has(siteId) || workers.get(siteId)) return;
    workers.register({
      operatorId: siteId,
      workerType: 'samo-live',
      supports: parameters => !!parameters && typeof parameters.country === 'string',
      async execute(context) {
        const parameters = context.task.parameters;
        const started = now();
        if (context.signal.aborted) throw workerError('worker_aborted');
        const result = await live.searchOne('tours', liveId, liveParams(parameters));
        if (context.signal.aborted) throw workerError('worker_aborted');
        if (result.status === 'error' || result.status === 'busy') throw workerError(result.error || 'upstream_unavailable');
        const picked = selectOffers(result.offers || [], parameters, { uzsRate, limit });
        context.log(result.cached ? 'search_cached' : 'search_done', { recordCount: Math.min(1000, (result.offers || []).length), durationMs: now() - started });
        // Natija yo'qligi sababi jurnalda: no_country (operator bu davlatga sotmaydi), no_departure, empty, closed, ...
        if (!picked.offers.length) {
          context.log(picked.soldOut ? 'no_seats' : picked.placeFiltered ? 'destination_no_match'
            : result.status === 'ok' ? 'no_match_filters' : 'no_offers_' + String(result.status || 'empty').replace(/[^a-z0-9_-]/gi, ''), {});
        }
        return { offers: picked.offers.map(o => toAgentOffer(o, parameters, operator.search)) };
      }
    });
    service.markWorkerConnected(siteId, 'samo');
    registered.push(siteId);
  });
  return registered;
}

module.exports = { registerLiveWorkers, selectOffers, toAgentOffer, destinationMatcher, liveParams, SITE_TO_LIVE };
