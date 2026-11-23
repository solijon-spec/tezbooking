/*
 * Main Agent'ning qoidaviy (deterministic) tahlilchisi: oddiy matndan qidiruv parametrlari.
 * Bitta fayl ikki joyda ishlaydi: serverda (server/owner/agent/parser.js orqali) va brauzerdagi
 * demo'da (js/demo-api.js → admin panel "Agentlar" bo'limi, window.TezAgentParser).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TezAgentParser = factory();
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

// O'zbek (lotin/kirill), rus va ingliz nomlari. 4+ harfli nomlar so'z boshi bo'yicha ham topiladi:
// "Antalyaga", "Turkiyaga", "Турцию", "Дубае" kabi qo'shimchali shakllar ham tushuniladi.
const COUNTRIES = [
  ['tr', ['turkey', 'türkiye', 'turkiya', 'туркия', 'турци', 'турция']],
  ['ge', ['georgia', 'gruziya', 'грузия', 'грузи', 'sakartvelo']],
  ['az', ['azerbaijan', 'ozarbayjon', 'озарбайжон', 'азербайджан']],
  ['ae', ['uae', 'baa', 'united arab emirates', 'emirates', 'arab amirliklari', 'оаэ', 'объединенные арабские эмираты', 'эмират']],
  ['eg', ['egypt', 'misr', 'миср', 'египет', 'египт']],
  ['my', ['malaysia', 'malayziya', 'малайзия', 'малайзи']],
  ['th', ['thailand', 'tailand', 'tayland', 'тайланд', 'таиланд']],
  ['vn', ['vietnam', 'vyetnam', 'вьетнам']],
  ['id', ['indonesia', 'indoneziya', 'индонезия', 'индонези']],
  ['lk', ['sri lanka', 'shri lanka', 'шри-ланка', 'шри ланка']],
  ['mv', ['maldives', 'maldiv', 'мальдив']]
];
const COUNTRY_CODES = COUNTRIES.map(([code]) => code);   // server/live/samo.js COUNTRY_RU bilan bir xil 11 ta

const DESTINATIONS = [
  ['Antalya', 'tr', ['antalya', 'анталья', 'анталь', 'анталия']],
  ['Alanya', 'tr', ['alanya', 'аланья', 'алань']],
  ['Istanbul', 'tr', ['istanbul', 'стамбул']],
  ['Bodrum', 'tr', ['bodrum', 'бодрум']],
  ['Tbilisi', 'ge', ['tbilisi', 'тбилиси']],
  ['Batumi', 'ge', ['batumi', 'батуми']],
  ['Baku', 'az', ['baku', 'boku', 'баку', 'боку']],
  ['Dubai', 'ae', ['dubai', 'dubay', 'дубай', 'дубаи', 'дубае']],
  ['Abu Dhabi', 'ae', ['abu dhabi', 'abu dabi', 'абу даби']],
  ['Hurghada', 'eg', ['hurghada', 'xurgada', 'хургада', 'хургад']],
  ['Sharm El Sheikh', 'eg', ['sharm el sheikh', 'sharm', 'шарм-эль-шейх', 'шарм']],
  ['Phuket', 'th', ['phuket', 'pxuket', 'puket', 'пхукет']],
  ['Bangkok', 'th', ['bangkok', 'бангкок']],
  ['Nha Trang', 'vn', ['nha trang', 'nyachang', 'нячанг']],
  ['Bali', 'id', ['bali', 'бали']],
  ['Colombo', 'lk', ['colombo', 'kolombo', 'коломбо']],
  ['Male', 'mv', ['male', 'мале']],
  ['Maldives', 'mv', ['maldives', 'maldiv', 'мальдив']]
];

function normalizedText(text) {
  return ` ${String(text).toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;
}

function includesWord(text, alias) {
  const a = alias.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  if (text.includes(` ${a} `)) return true;
  // So'z boshi: faqat 4+ harfli nomlarda (qisqa so'zlarda tasodifiy moslik bo'lmasin)
  return a.length >= 4 && text.includes(` ${a}`);
}

// Oy nomlari: o'zbek (lotin/kirill), rus, ingliz — so'z boshi bo'yicha
const MONTHS = [
  ['yanvar', 'январ', 'jan'], ['fevral', 'феврал', 'feb'], ['mart', 'март', 'mar'], ['aprel', 'апрел', 'apr'],
  ['may', 'май', 'мая', 'ма'], ['iyun', 'июн', 'jun'], ['iyul', 'июл', 'jul'], ['avgust', 'август', 'aug'],
  ['sentabr', 'sentyabr', 'сентябр', 'sep'], ['oktabr', 'oktyabr', 'октябр', 'oct'], ['noyabr', 'ноябр', 'nov'],
  ['dekabr', 'декабр', 'dec']
];
function monthIndex(word) {
  const w = word.toLocaleLowerCase();
  for (let i = 0; i < MONTHS.length; i++) {
    if (MONTHS[i].some(m => (m.length <= 2 ? w === 'мая' || w === 'май' : w.startsWith(m)))) return i;
  }
  return -1;
}
function today() { return new Date().toISOString().slice(0, 10); }

function countryCode(value) {
  const candidate = String(value || '').trim().toLowerCase();
  if (COUNTRY_CODES.includes(candidate)) return candidate;
  const normalized = normalizedText(candidate);
  const match = COUNTRIES.find(([, aliases]) => aliases.some(alias => includesWord(normalized, alias)));
  return match ? match[0] : null;
}

function parseDate(text) {
  const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dotted = text.match(/\b(\d{1,2})[./](\d{1,2})[./](20\d{2})\b/);
  if (dotted) return `${dotted[3]}-${dotted[2].padStart(2, '0')}-${dotted[1].padStart(2, '0')}`;
  // "15-dekabr", "15 декабря 2026", "December 15", "dekabr 15"
  const pad = n => String(n).padStart(2, '0');
  const build = (day, month, year) => {
    if (month < 0 || !(day >= 1 && day <= 31)) return null;
    let y = year ? Number(year) : Number(today().slice(0, 4));
    let iso = `${y}-${pad(month + 1)}-${pad(day)}`;
    if (!year && iso < today()) iso = `${++y}-${pad(month + 1)}-${pad(day)}`;   // yil yozilmasa — eng yaqin kelajak
    return iso;
  };
  const dayFirst = /(?:^|[^\p{L}\p{N}])(\d{1,2})\s*[-.]?\s*([\p{L}]{3,})\.?(?:\s+(20\d{2}))?/gu;
  let m;
  while ((m = dayFirst.exec(text))) {
    const r = build(Number(m[1]), monthIndex(m[2]), m[3]);
    if (r) return r;
  }
  const monthFirst = /(?:^|[^\p{L}\p{N}])([\p{L}]{3,})\.?\s+(\d{1,2})(?![\d\p{L}])(?:,?\s+(20\d{2}))?/gu;
  while ((m = monthFirst.exec(text))) {
    const r = build(Number(m[2]), monthIndex(m[1]), m[3]);
    if (r) return r;
  }
  return null;
}

function parseChildren(text) {
  const ages = [];
  const explicitList = text.match(/(?:children|kids|child|bolalar|bola|дет(?:и|ей|и))\s*(?:ages?|aged?|yosh(?:lari)?|лет)\s*[:=]?\s*(\d{1,2}(?:\s*(?:,|and|&|ва|и)\s*\d{1,2})*)/i);
  if (explicitList) {
    ages.push(...explicitList[1].match(/\d{1,2}/g).map(Number));
  } else {
    const agePattern = /(?:child|kid|bola|ребен\w*)\D{0,18}(\d{1,2})\s*(?:years?\s*old|years?|yrs?|y\/o|yosh(?:li)?|лет)/giu;
    let match;
    while ((match = agePattern.exec(text))) ages.push(Number(match[1]));
  }
  const countMatch = text.match(/\b(\d{1,2})\s*(?:child(?:ren)?|kids?|bolalar|bola|ребен(?:ок|ка|ей))\b/i);
  const childCount = countMatch ? Number(countMatch[1]) : ages.length;
  return { ages, childCount };
}

function parseNaturalLanguage(text) {
  const normalized = normalizedText(text);
  const destination = DESTINATIONS.find(([, , aliases]) => aliases.some(alias => includesWord(normalized, alias)));
  let country = destination ? destination[1] : null;
  if (!country) {
    const found = COUNTRIES.find(([, aliases]) => aliases.some(alias => includesWord(normalized, alias)));
    country = found ? found[0] : null;
  }

  // \b kirill harflarida ishlamaydi — shuning uchun (?![\p{L}]) ishlatiladi
  const adultsMatch = text.match(/(?<![\p{L}\p{N}])(\d{1,2})\s*(?:adults?|grown[- ]?ups?|kattalar|katta|kishi|odam|nafar|pax|persons?|people|взросл\p{L}*|человек\p{L}*|чел)(?![\p{L}])/iu);
  const nightsMatch = text.match(/(?<![\p{L}\p{N}])(\d{1,2})\s*(?:nights?|tun(?:lar|ga)?|kecha(?:lar|ga)?|ноч\p{L}*)(?![\p{L}])/iu);
  const children = parseChildren(text);
  let mealPlan = null;
  if (/\b(?:ultra\s+all[- ]inclusive|uai)\b/i.test(text)) mealPlan = 'UAI';
  else if (/\b(?:all[- ]inclusive|ai)\b|hammasi\s+kiritilgan|все\s+включено/iu.test(text)) mealPlan = 'AI';
  else if (/\b(?:full[- ]board|fb)\b|полный\s+пансион/iu.test(text)) mealPlan = 'FB';
  else if (/\b(?:half[- ]board|hb)\b|полупансион/iu.test(text)) mealPlan = 'HB';
  else if (/\b(?:breakfast(?:\s+included)?|bb)\b|nonushta|завтрак/iu.test(text)) mealPlan = 'BB';
  else if (/\b(?:room[- ]only|ro)\b|без\s+питания/iu.test(text)) mealPlan = 'RO';

  const budgetMatch = text.match(/(?:budget|byudjet|up\s+to|максимум|бюджет)\s*[:=]?\s*(\$|€)?\s*([\d,]+(?:\.\d+)?)\s*(USD|EUR|UZS|сум|so['’]?m|dollar)?/iu)
    || text.match(/(\$)?\s*([\d,]+(?:\.\d+)?)\s*(USD|EUR|UZS|so['’]?m|dollar)?\s*gacha/iu);
  const currencyMatch = text.match(/\b(USD|EUR|UZS)\b/i);
  const budget = budgetMatch ? Number(budgetMatch[2].replace(/,/g, '')) : null;
  const currency = budgetMatch && budgetMatch[3]
    ? (/^(сум|so['’]?m)$/i.test(budgetMatch[3]) ? 'UZS' : /^dollar$/i.test(budgetMatch[3]) ? 'USD' : budgetMatch[3].toUpperCase())
    : budgetMatch && budgetMatch[1] === '€' ? 'EUR'
      : budgetMatch && budgetMatch[1] === '$' ? 'USD'
    : currencyMatch ? currencyMatch[1].toUpperCase() : 'USD';

  const missing = [];
  if (!destination) missing.push('destination');
  if (!country) missing.push('country');
  const date = parseDate(text);
  if (!date) missing.push('date');
  if (!adultsMatch) missing.push('adults');
  if (!nightsMatch) missing.push('nights');
  if (children.childCount > children.ages.length) missing.push('childrenAges');

  const parameters = {
    destination: destination ? destination[0] : null,
    country,
    date,
    adults: adultsMatch ? Number(adultsMatch[1]) : null,
    nights: nightsMatch ? Number(nightsMatch[1]) : null,
    childrenAges: children.ages,
    mealPlan,
    budget: Number.isFinite(budget) ? budget : null,
    currency,
    hotelStars: null,
    departureAirport: null
  };
  return { parameters, missing: [...new Set(missing)], mode: 'deterministic' };
}

return { parseNaturalLanguage, countryCode, COUNTRIES, DESTINATIONS };
});
