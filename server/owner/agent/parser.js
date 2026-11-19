'use strict';

const { COUNTRY_RU } = require('../../live/samo');

const COUNTRIES = [
  ['tr', ['turkey', 'türkiye', 'turkiya', 'turkiyada', 'турция']],
  ['ge', ['georgia', 'грузия', 'sakartvelo']],
  ['az', ['azerbaijan', 'азербайджан']],
  ['ae', ['uae', 'united arab emirates', 'emirates', 'оаэ', 'объединенные арабские эмираты']],
  ['eg', ['egypt', 'misr', 'египет']],
  ['my', ['malaysia', 'малайзия']],
  ['th', ['thailand', 'тайланд', 'таиланд']],
  ['vn', ['vietnam', 'вьетнам']],
  ['id', ['indonesia', 'индонезия']],
  ['lk', ['sri lanka', 'шри-ланка', 'шри ланка']],
  ['mv', ['maldives', 'мальдивы']]
];

const DESTINATIONS = [
  ['Antalya', 'tr', ['antalya', 'анталья']],
  ['Alanya', 'tr', ['alanya', 'аланья']],
  ['Istanbul', 'tr', ['istanbul', 'стамбул']],
  ['Bodrum', 'tr', ['bodrum', 'бодрум']],
  ['Tbilisi', 'ge', ['tbilisi', 'тбилиси']],
  ['Batumi', 'ge', ['batumi', 'батуми']],
  ['Baku', 'az', ['baku', 'баку']],
  ['Dubai', 'ae', ['dubai', 'дубай']],
  ['Abu Dhabi', 'ae', ['abu dhabi', 'абу даби']],
  ['Hurghada', 'eg', ['hurghada', 'хургада']],
  ['Sharm El Sheikh', 'eg', ['sharm el sheikh', 'шарм-эль-шейх']],
  ['Phuket', 'th', ['phuket', 'пхукет']],
  ['Bangkok', 'th', ['bangkok', 'бангкок']],
  ['Nha Trang', 'vn', ['nha trang', 'нячанг']],
  ['Bali', 'id', ['bali', 'бали']],
  ['Colombo', 'lk', ['colombo', 'коломбо']],
  ['Male', 'mv', ['male', 'мале']],
  ['Maldives', 'mv', ['maldives', 'мальдивы']]
];

function normalizedText(text) {
  return ` ${String(text).toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;
}

function includesWord(text, alias) {
  return text.includes(` ${alias.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `);
}

function countryCode(value) {
  const candidate = String(value || '').trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(COUNTRY_RU, candidate)) return candidate;
  const normalized = normalizedText(candidate);
  const match = COUNTRIES.find(([, aliases]) => aliases.some(alias => includesWord(normalized, alias)));
  return match ? match[0] : null;
}

function parseDate(text) {
  const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dotted = text.match(/\b(\d{1,2})[./](\d{1,2})[./](20\d{2})\b/);
  if (!dotted) return null;
  return `${dotted[3]}-${dotted[2].padStart(2, '0')}-${dotted[1].padStart(2, '0')}`;
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

  const adultsMatch = text.match(/\b(\d{1,2})\s*(?:adults?|grown[- ]?ups?|kattalar|взросл(?:ых|ые|ый))\b/i);
  const nightsMatch = text.match(/\b(\d{1,2})\s*(?:nights?|nights?|tun(?:lar)?|kecha(?:lar)?|ноч(?:ь|и|ей))\b/i);
  const children = parseChildren(text);
  let mealPlan = null;
  if (/\b(?:ultra\s+all[- ]inclusive|uai)\b/i.test(text)) mealPlan = 'UAI';
  else if (/\b(?:all[- ]inclusive|ai)\b/i.test(text)) mealPlan = 'AI';
  else if (/\b(?:full[- ]board|fb)\b/i.test(text)) mealPlan = 'FB';
  else if (/\b(?:half[- ]board|hb)\b/i.test(text)) mealPlan = 'HB';
  else if (/\b(?:breakfast(?:\s+included)?|bb)\b/i.test(text)) mealPlan = 'BB';
  else if (/\b(?:room[- ]only|ro)\b/i.test(text)) mealPlan = 'RO';

  const budgetMatch = text.match(/(?:budget|up\s+to|максимум|бюджет)\s*[:=]?\s*(\$|€)?\s*([\d,]+(?:\.\d+)?)\s*(USD|EUR|UZS|сум|so['’]?m)?/i);
  const currencyMatch = text.match(/\b(USD|EUR|UZS)\b/i);
  const budget = budgetMatch ? Number(budgetMatch[2].replace(/,/g, '')) : null;
  const currency = budgetMatch && budgetMatch[3]
    ? (/^(сум|so['’]?m)$/i.test(budgetMatch[3]) ? 'UZS' : budgetMatch[3].toUpperCase())
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

module.exports = { parseNaturalLanguage, countryCode, COUNTRIES, DESTINATIONS };
