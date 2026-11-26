'use strict';

/*
 * Mehmonxona nomi bo'yicha moslik (agent topshirig'idagi "CAMIA RESORT" -> operatordagi nom).
 * So'ralgan nomdagi har bir muhim so'z operatordagi nomda so'z boshi sifatida bo'lishi kerak:
 *   "Camia Resort"  ~ "CAMIA RESORT & SPA", "Camia Phu Quoc"   ("resort", "hotel", "spa" — umumiy so'zlar, majburiy emas)
 *   "Rixos Belek"   ~ "Rixos Premium Belek"
 *   "Rixos Belek"   ≁ "Rixos The Palm Dubai"
 */

const GENERIC = new Set(['hotel', 'hotels', 'otel', 'отель', 'resort', 'resorts', 'spa', 'the', 'and', 'by']);

const words = (text) => String(text || '').toLowerCase().replace(/ё/g, 'е')
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(Boolean);

// So'ralgan nomdan eski nom va izohni olib tashlash: "ORCHID HOTEL AL BARSHA EX. (GOLDEN TULIP AL BARSHA)" -> "ORCHID HOTEL AL BARSHA",
// "Concorde Deira (ex. Golden Tulip Deira)" -> "Concorde Deira", "Rixos Premium 5*" -> "Rixos Premium". Operatorlar eski nomni har xil yozadi.
function coreName(name) {
  const s = String(name || '')
    .replace(/\([^)]*\)/g, ' ')                                     // qavs ichidagi izoh
    .replace(/(^|[\s,.;-])(ex|former|formerly|бывш\p{L}*)([.\s-]).*$/iu, '$1')  // "ex. ..." — eski nom
    .replace(/\b\d\s*\*+|\*+/g, ' ');                               // yulduz
  return s.trim() ? s : String(name || '');
}

// name -> (hotelName) => boolean; nom bo'sh bo'lsa — null (filtr yo'q)
function hotelMatcher(name) {
  const all = words(coreName(name)).filter(word => word.length >= 2 || /\d/.test(word));
  const key = all.filter(word => !GENERIC.has(word));
  const tokens = key.length ? key : all;
  if (!tokens.length) return null;
  return (hotel) => {
    const text = ' ' + words(hotel).join(' ');
    return tokens.every(token => text.includes(' ' + token));
  };
}

module.exports = { hotelMatcher, coreName };
