/*
 * TezBooking — Telegram bot tur agentliklar uchun (o'zbek va rus tillarida).
 *
 * Nima qiladi:
 *   📝 Post yaratish — davlat, tunlar va sanani tanlaysiz; bot operatorlarning haqiqiy narxlaridan (server/live) eng arzon
 *      turlarni topadi va kanal uchun tayyor post yozadi: mehmonxona, qayerdan va qachon uchish (sana, hafta kuni, soat),
 *      necha kecha / kun, ovqat, xona, narx (firmangiz foizi bilan), so'mda, telefon, heshteglar va rasm.
 *   📰 Top-5 — bitta postda eng arzon 5 ta tur.
 *   📤 Kanalga joylash — bot kanalingizda admin bo'lsa, postni bir tugma bilan joylaydi.
 *   🖼 O'z rasmingizni yuborsangiz — post shu rasm bilan chiqadi (sukut bo'yicha — yo'nalish rasmi).
 *   ⚙️ Sozlamalar — bot tili, post tili (UZ / RU / ikkalasi), uchish shahri, kanal, telefon, ustama foizi.
 *
 * Kirish: firma saytda (Kirish → tariflar oynasi → "Botni ulash kodi") kod oladi va botga /link KOD yuboradi.
 * TELEGRAM_OPEN=1 bo'lsa — ulanmagan foydalanuvchilar ham ishlata oladi (sinov uchun).
 *
 * Narxlar: faqat operatorlarning haqiqiy narxlari (server/live). Demo rejimda (npm run demo yoki TELEGRAM_DEMO=1)
 * namunaviy narxlar ishlatiladi va postda "DEMO" deb yoziladi — o'ylab topilgan tur haqiqiy kanalga haqiqiy deb chiqmasin.
 *
 * Ishlash usuli: long polling (getUpdates) — serverga tashqaridan kiruvchi manzil (webhook) ochish shart emas.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { createTelegramApi } = require('./api');
const P = require('./post');

const COUNTRIES = ['tr', 'ae', 'eg', 'ge', 'az', 'th', 'vn', 'my', 'lk', 'mv', 'id'];
const FROM_IDS = ['tas', 'skd', 'bhk', 'ugc', 'nma', 'feg', 'azn', 'tmj', 'nvi', 'ksq', 'ncu', 'dyu'];
const NIGHTS = [5, 7, 10, 14];
const MAX_RESULTS = 8;
const ACTIONS_PER_MIN = 25;
const SEARCHES_PER_10MIN = 8;
const POSTS_PER_DAY = 40;

const TXT = {
  uz: {
    menu_post: '📝 Post yaratish', menu_settings: '⚙️ Sozlamalar', menu_help: '❓ Yordam',
    hello: 'Assalomu alaykum! Men <b>TezBooking</b> botiman.\n\nTur operatorlarning haqiqiy narxlaridan eng yaxshi turlarni topib, kanalingiz uchun tayyor post yozib beraman: mehmonxona, qayerdan va qachon uchish, necha kecha, narx (sizning foizingiz bilan) va rasm. O\'zbek va rus tillarida.',
    need_link: '🔗 Avval akkauntingizni ulang: saytda <b>Kirish</b> → tariflar oynasi → <b>«Botni ulash kodi»</b>, so\'ng shu yerga yuboring:\n<code>/link 123456</code>',
    linked: '✅ Ulandi: <b>{a}</b>. Ustamangiz: {m}%.\nEndi «📝 Post yaratish» ni bosing.', link_bad: '❌ Kod noto\'g\'ri yoki muddati o\'tgan. Saytdan yangi kod oling.',
    unlinked: 'Akkaunt botdan uzildi.',
    choose_lang: 'Bot tilini tanlang:',
    choose_country: '🌍 Qaysi davlatga?', choose_nights: '🌙 Necha kecha?', choose_when: '📅 Qachon uchiladi?',
    when_soon: 'Yaqin 2 hafta', when_month: 'Keyingi oy', when_date: '📆 Sanani yozaman',
    ask_date: 'Uchish sanasini yozing, masalan: <code>15.12</code> yoki <code>2026-12-15</code>', bad_date: 'Sana tushunilmadi yoki o\'tib ketgan. Masalan: <code>15.12</code>',
    searching: '🔎 Operatorlardan narxlar so\'ralmoqda… (10–40 soniya)',
    found: '<b>{c}</b> · {from} · {n} kecha · 2 kishi\nTopildi: {k} ta tur. Eng arzonlari (narx — ustamangiz {m}% bilan):\nPost uchun turni tanlang 👇',
    none: '😕 Bu sanalarga {c} bo\'yicha haqiqiy narx topilmadi. Boshqa sana, tunlar soni yoki uchish shahrini tanlab ko\'ring.',
    live_off: 'Hozir operatorlardan narx olib bo\'lmadi. Birozdan keyin urinib ko\'ring.',
    top5: '📰 Top-5 — bitta postda', again: '🔄 Boshqa sana', req_note: '⏳ — mehmonxonada joy so\'rov bo\'yicha (operator tasdiqlaydi).',
    preview: '👆 Post tayyor. Kanalga joylash yoki nusxa olib o\'zingiz yuborishingiz mumkin.',
    publish: '📤 Kanalga joylash', photo: '🖼 O\'z rasmim', back: '⬅️ Ro\'yxat', plang: 'Post tili: {x}',
    send_photo: 'Post uchun rasm yuboring (oddiy rasm sifatida).', photo_ok: '🖼 Rasm qabul qilindi.',
    no_channel: '📢 Kanal ulanmagan. ⚙️ Sozlamalar → «Kanal» orqali ulang.',
    published: '✅ Kanalga joylandi: {ch}', publish_fail: '❌ Kanalga joylab bo\'lmadi: bot kanalda admin ekanini va «Post yozish» huquqi borligini tekshiring.',
    expired: 'Bu ro\'yxat eskirgan. «📝 Post yaratish» ni qayta bosing.',
    settings: '⚙️ <b>Sozlamalar</b>\n\nAkkaunt: {a}\nUstama: {m}%\nKanal: {ch}\nTelefon: {ph}\nUchish shahri: {from}\nPost tili: {pl}',
    s_lang: '🌐 Bot tili: O\'zbekcha', s_plang: '📝 Post tili: {x}', s_from: '✈️ Uchish: {x}', s_ch: '📢 Kanal', s_ph: '📞 Telefon', s_mk: '💯 Ustama: {m}%',
    not_set: 'ulanmagan', none_v: '—',
    ask_channel: '📢 Kanalni ulash:\n1) Botni kanalingizga <b>admin</b> qiling («Post yozish» huquqi bilan).\n2) Kanal manzilini yuboring (<code>@kanalim</code>) yoki kanaldan istalgan postni shu yerga forward qiling.',
    ch_ok: '✅ Kanal ulandi: <b>{ch}</b>', ch_not_found: '❌ Kanal topilmadi. Manzilni tekshiring (@ bilan) yoki kanaldan postni forward qiling.',
    ch_bot_admin: '❌ Bot bu kanalda admin emas yoki post yozish huquqi yo\'q.', ch_user_admin: '❌ Siz bu kanalning admini emassiz.',
    ch_type: '❌ Bu kanal emas.',
    ask_phone: '📞 Postlarda ko\'rinadigan telefon raqamini yuboring, masalan: <code>+998 90 123 45 67</code>', phone_ok: '✅ Telefon saqlandi.', phone_bad: 'Telefon raqami noto\'g\'ri.',
    ask_markup: '💯 Necha foiz ustama olasiz? 0 dan 50 gacha son yuboring (masalan: <code>12</code>). Saytdagi narxlar ham shu foiz bilan ko\'rsatiladi.',
    markup_ok: '✅ Ustama saqlandi: {m}%', markup_bad: 'Foiz 0 dan 50 gacha bo\'lsin.', markup_link: 'Ustamani o\'zgartirish uchun akkauntni ulang (/link).',
    choose_from: '✈️ Qaysi shahardan uchiladi?', from_ok: '✅ Uchish shahri: {x}',
    slow: '⏳ Juda tez. Bir daqiqadan keyin davom eting.', limit_search: '⏳ Qidiruvlar soni chegarasi: 10 daqiqadan keyin urinib ko\'ring.',
    limit_posts: 'Bugungi postlar chegarasiga yetdingiz ({n}).',
    help: '❓ <b>Qanday ishlaydi</b>\n\n1) «📝 Post yaratish» → davlat → tunlar → sana.\n2) Bot operatorlardan eng arzon turlarni topadi — birini tanlang yoki «Top-5».\n3) Post tayyor: «📤 Kanalga joylash» yoki nusxa oling.\n\nNarx — operatorning netto narxi + sizning ustamangiz. Uchish vaqti operator reysi ma\'lum bo\'lsa ko\'rsatiladi. Rasm — yo\'nalish rasmi; o\'z rasmingizni «🖼 O\'z rasmim» orqali qo\'ying.\n\nBuyruqlar: /post /settings /link KOD /unlink /help',
    unknown: 'Quyidagi menyudan tanlang 👇', error: 'Xatolik yuz berdi. Qayta urinib ko\'ring.'
  },
  ru: {
    menu_post: '📝 Создать пост', menu_settings: '⚙️ Настройки', menu_help: '❓ Помощь',
    hello: 'Здравствуйте! Я бот <b>TezBooking</b>.\n\nНахожу лучшие туры по реальным ценам туроператоров и пишу готовый пост для вашего канала: отель, откуда и когда вылет, сколько ночей, цена (с вашей наценкой) и фото. На русском и узбекском.',
    need_link: '🔗 Сначала подключите аккаунт: на сайте <b>Войти</b> → окно тарифов → <b>«Код для подключения бота»</b>, затем отправьте сюда:\n<code>/link 123456</code>',
    linked: '✅ Подключено: <b>{a}</b>. Ваша наценка: {m}%.\nТеперь нажмите «📝 Создать пост».', link_bad: '❌ Код неверный или истёк. Получите новый код на сайте.',
    unlinked: 'Аккаунт отключён от бота.',
    choose_lang: 'Выберите язык бота:',
    choose_country: '🌍 В какую страну?', choose_nights: '🌙 Сколько ночей?', choose_when: '📅 Когда вылет?',
    when_soon: 'Ближайшие 2 недели', when_month: 'Следующий месяц', when_date: '📆 Ввести дату',
    ask_date: 'Напишите дату вылета, например: <code>15.12</code> или <code>2026-12-15</code>', bad_date: 'Не удалось понять дату или она прошла. Например: <code>15.12</code>',
    searching: '🔎 Запрашиваю цены у операторов… (10–40 секунд)',
    found: '<b>{c}</b> · {from} · {n} ноч. · 2 чел.\nНайдено туров: {k}. Самые выгодные (цена — с вашей наценкой {m}%):\nВыберите тур для поста 👇',
    none: '😕 На эти даты по направлению {c} реальных цен не найдено. Попробуйте другую дату, количество ночей или город вылета.',
    live_off: 'Сейчас не удалось получить цены операторов. Попробуйте чуть позже.',
    top5: '📰 Топ-5 — одним постом', again: '🔄 Другая дата', req_note: '⏳ — места в отеле под запрос (подтверждает оператор).',
    preview: '👆 Пост готов. Можно опубликовать в канал или скопировать и отправить самостоятельно.',
    publish: '📤 Опубликовать в канал', photo: '🖼 Своё фото', back: '⬅️ К списку', plang: 'Язык поста: {x}',
    send_photo: 'Отправьте фото для поста (как обычное фото).', photo_ok: '🖼 Фото принято.',
    no_channel: '📢 Канал не подключён. ⚙️ Настройки → «Канал».',
    published: '✅ Опубликовано в канал: {ch}', publish_fail: '❌ Не удалось опубликовать: проверьте, что бот — администратор канала с правом «Публикация сообщений».',
    expired: 'Этот список устарел. Нажмите «📝 Создать пост» ещё раз.',
    settings: '⚙️ <b>Настройки</b>\n\nАккаунт: {a}\nНаценка: {m}%\nКанал: {ch}\nТелефон: {ph}\nГород вылета: {from}\nЯзык поста: {pl}',
    s_lang: '🌐 Язык бота: Русский', s_plang: '📝 Язык поста: {x}', s_from: '✈️ Вылет: {x}', s_ch: '📢 Канал', s_ph: '📞 Телефон', s_mk: '💯 Наценка: {m}%',
    not_set: 'не подключён', none_v: '—',
    ask_channel: '📢 Подключение канала:\n1) Сделайте бота <b>администратором</b> канала (с правом «Публикация сообщений»).\n2) Отправьте адрес канала (<code>@mychannel</code>) или перешлите сюда любой пост из канала.',
    ch_ok: '✅ Канал подключён: <b>{ch}</b>', ch_not_found: '❌ Канал не найден. Проверьте адрес (с @) или перешлите пост из канала.',
    ch_bot_admin: '❌ Бот не администратор канала или нет права публикации.', ch_user_admin: '❌ Вы не администратор этого канала.',
    ch_type: '❌ Это не канал.',
    ask_phone: '📞 Отправьте телефон для постов, например: <code>+998 90 123 45 67</code>', phone_ok: '✅ Телефон сохранён.', phone_bad: 'Неверный номер телефона.',
    ask_markup: '💯 Какую наценку вы берёте? Отправьте число от 0 до 50 (например: <code>12</code>). На сайте цены тоже будут с этой наценкой.',
    markup_ok: '✅ Наценка сохранена: {m}%', markup_bad: 'Процент — от 0 до 50.', markup_link: 'Чтобы изменить наценку, подключите аккаунт (/link).',
    choose_from: '✈️ Из какого города вылет?', from_ok: '✅ Город вылета: {x}',
    slow: '⏳ Слишком быстро. Продолжите через минуту.', limit_search: '⏳ Лимит поисков: попробуйте через 10 минут.',
    limit_posts: 'Достигнут дневной лимит постов ({n}).',
    help: '❓ <b>Как это работает</b>\n\n1) «📝 Создать пост» → страна → ночи → дата.\n2) Бот находит самые выгодные туры у операторов — выберите один или «Топ-5».\n3) Пост готов: «📤 Опубликовать в канал» или скопируйте.\n\nЦена — нетто оператора + ваша наценка. Время вылета показывается, если известен рейс оператора. Фото — фото направления; своё можно поставить через «🖼 Своё фото».\n\nКоманды: /post /settings /link КОД /unlink /help',
    unknown: 'Выберите в меню ниже 👇', error: 'Произошла ошибка. Попробуйте ещё раз.'
  }
};
const PLANG = { uz: 'UZ', ru: 'RU', both: 'UZ + RU' };

function createTelegramBot({ token, db, accounts, live, root, demo = false, open = false, log = console, apiImpl, now = Date.now }) {
  const api = apiImpl || createTelegramApi(token);
  const raw = db.raw;
  const site = P.loadSite(root);
  const TB = site.TB, I18N = site.I18N;
  const OP_NAME = {};
  TB.OPS.forEach(o => { OP_NAME[o.id] = o.name; });
  const allowAll = open || demo;
  // Operator yozgan shahar nomi ("Шарм-Эль-Шейх", "Antalya") -> saytdagi shahar (postda tanlangan tilda chiqadi)
  const slugCity = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, '');
  const CITY_BY_NAME = {};
  Object.keys(I18N.NAMES.cities).forEach(id => Object.values(I18N.NAMES.cities[id]).forEach(v => { CITY_BY_NAME[slugCity(v)] = id; }));
  const cityIdOf = (raw) => CITY_BY_NAME[slugCity(raw)] || CITY_BY_NAME[slugCity(String(raw || '').split(/[(,]/)[0])] || null;
  let running = false, offset = 0, me = null;
  const chains = new Map();               // chat -> navbatdagi ish (bitta suhbat xabarlari ketma-ket)
  const actions = new Map(), searches = new Map();
  const photoIds = new Map();             // rasm fayli -> Telegram file_id (qayta yuklamaslik uchun)

  const q = {
    get: raw.prepare('SELECT * FROM tg_chats WHERE chat_id = ?'),
    insert: raw.prepare(`INSERT INTO tg_chats (chat_id, lang, post_lang, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`),
    save: raw.prepare(`UPDATE tg_chats SET agency_id = ?, lang = ?, post_lang = ?, from_city = ?, channel = ?, channel_title = ?, phone = ?, state = ?, updated_at = ?
                       WHERE chat_id = ?`),
    post: raw.prepare('INSERT INTO tg_posts (chat_id, target, summary, at) VALUES (?, ?, ?, ?)'),
    postsToday: raw.prepare('SELECT COUNT(*) AS n FROM tg_posts WHERE chat_id = ? AND target = ? AND at >= ?')
  };

  // ---------- Suhbat yozuvi ----------
  function chatOf(msgChat, user) {
    const id = String(msgChat.id);
    let c = q.get.get(id);
    if (!c) {
      const lang = user && /^ru|^uk|^be|^kk/.test(user.language_code || '') ? 'ru' : 'uz';
      q.insert.run(id, lang, lang, now(), now());
      c = q.get.get(id);
    }
    let st = {};
    try { st = c.state ? JSON.parse(c.state) : {}; } catch (e) { st = {}; }
    return Object.assign({}, c, { st });
  }
  function save(c) {
    q.save.run(c.agency_id || null, c.lang, c.post_lang, c.from_city, c.channel || null, c.channel_title || null, c.phone || '',
      JSON.stringify(c.st || {}).slice(0, 60000), now(), c.chat_id);
  }
  const tx = (c, k, p) => { const s = (TXT[c.lang] || TXT.uz)[k] || TXT.uz[k] || k; return p ? s.replace(/\{(\w+)\}/g, (m, x) => (p[x] != null ? p[x] : m)) : s; };
  const agencyOf = (c) => {
    if (!c.agency_id) return null;
    const a = accounts.agency(c.agency_id);
    return a && a.status === 'active' ? a : null;
  };
  const markupOf = (c) => { const a = agencyOf(c); return a ? accounts.markupOf(a) : 10; };
  const allowed = (c) => allowAll || !!agencyOf(c);
  const nm = (c) => P.names(I18N, c.lang);

  // ---------- Telegram yordamchilari ----------
  const menu = (c) => ({ keyboard: [[{ text: tx(c, 'menu_post') }], [{ text: tx(c, 'menu_settings') }, { text: tx(c, 'menu_help') }]], resize_keyboard: true, is_persistent: true });
  const send = (c, text, markup) => api.call('sendMessage', { chat_id: c.chat_id, text, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: markup });
  const answer = (cb, text) => api.call('answerCallbackQuery', { callback_query_id: cb.id, text: text ? String(text).slice(0, 190) : undefined }).catch(() => {});
  const rows = (buttons, per) => { const out = []; for (let i = 0; i < buttons.length; i += per) out.push(buttons.slice(i, i + per)); return out; };
  const btn = (text, data) => ({ text, callback_data: data });

  async function sendPhoto(chatId, photo, caption, markup) {
    // photo: Telegram file_id yoki diskdagi fayl yo'li
    if (photo && photo.startsWith('file:')) {
      const file = photo.slice(5);
      const cached = photoIds.get(file);
      if (cached) return api.call('sendPhoto', { chat_id: chatId, photo: cached, caption, parse_mode: 'HTML', reply_markup: markup });
      const res = await api.upload('sendPhoto', { chat_id: chatId, caption, parse_mode: 'HTML', reply_markup: markup }, 'photo', file);
      const ph = res && res.photo && res.photo[res.photo.length - 1];
      if (ph) photoIds.set(file, ph.file_id);
      return res;
    }
    return api.call('sendPhoto', { chat_id: chatId, photo, caption, parse_mode: 'HTML', reply_markup: markup });
  }
  const photoFor = (c, country) => {
    if (c.st.photo) return c.st.photo;
    const file = path.join(root, 'images', 'country-' + country + '.jpg');
    return fs.existsSync(file) ? 'file:' + file : null;
  };

  function limited(map, key, max, windowMs) {
    const t = now();
    const list = (map.get(key) || []).filter(x => t - x < windowMs);
    list.push(t);
    map.set(key, list);
    return list.length > max;
  }

  // ---------- Turlarni topish ----------
  const today = () => new Date(now()).toISOString().slice(0, 10);
  // Qidiruv markaziy sanalari (har biri ±3 kun oynasi bilan so'raladi)
  function centers(st) {
    const t0 = today();
    if (st.when === 'date' && st.date) return [st.date];
    if (st.when === 'month') return [P.addDays(t0, 24), P.addDays(t0, 31), P.addDays(t0, 38)];
    return [P.addDays(t0, 6), P.addDays(t0, 13)];
  }
  // Yagona ko'rinish (postga kerakli maydonlar)
  const compact = (x) => ({
    co: x.co, cid: x.cid || null, c: x.c || '', h: String(x.h).slice(0, 120), s: x.s || 0, d: x.d,
    dd: /^\d{4}-\d{2}-\d{2}$/.test(x.dd || '') ? x.dd : null, n: x.n, m: x.m || null, mr: x.mr || '',
    rc: x.rc || null, r: x.r ? String(x.r).slice(0, 80) : '', p: x.p, adults: 2, fr: x.fr, dep: x.dep == null ? null : x.dep,
    fn: x.fn || '', al: x.al || '', g: !!x.g, op: x.op || '', ok: x.ok !== false
  });

  async function findTours(c) {
    const st = c.st;
    const out = [];
    if (demo) {
      const qd = { from: c.from_city, nights: st.nights, adults: 2, childAges: [], rooms: 1 };
      const hotels = TB.HOTELS.filter(h => h.country === st.country);
      centers(st).forEach(center => {
        for (let k = -3; k <= 3; k++) {
          const d = P.addDays(center, k);
          if (d <= today()) continue;
          hotels.forEach(h => TB.offersFor(h, qd, d).forEach(o => {
            if (o.avail === 'stop') return;
            out.push(compact({ co: h.country, cid: h.city, h: h.name, s: h.stars, d, n: st.nights, m: o.meal, rc: o.room, p: o.price,
              fr: c.from_city, dep: o.ticket ? o.ticket.dep : null, fn: o.ticket ? o.ticket.no : '', al: o.ticket ? o.ticket.airline : '', g: o.gds, op: o.op.name,
              ok: o.avail === 'ok' || o.avail === 'few' }));
          }));
        }
      });
    } else {
      if (!live || typeof live.search !== 'function') throw new Error('live_off');
      let anyOk = false;
      for (const center of centers(st)) {
        const date = center <= today() ? P.addDays(today(), 4) : center;
        const data = await live.search('tours', { country: st.country, date, nights: String(st.nights), adults: '2', from: c.from_city, window: '3' });
        if ((data.operators || []).some(o => o.status === 'ok' || o.status === 'empty')) anyOk = true;
        (data.offers || []).forEach(o => {
          // Sotuvi to'xtagan va reysda joy qolmaganlar chiqmaydi; "so'rov bo'yicha" (req) — sotiladi (operatorlarda ko'pi shunday)
          if (o.avail === 'stop' || o.seats === 'none' || !(o.price > 0) || o.nights !== st.nights) return;
          // Uchish vaqti: operator chiptasi bo'lsa — undan, aks holda tur qatorining o'zidan (06.12.2026 10:25)
          const dep = o.ticket && o.ticket.dep != null ? o.ticket.dep : (typeof o.dep === 'number' ? o.dep : null);
          out.push(compact({ co: st.country, cid: cityIdOf(o.city), c: o.city, h: o.hotel, s: o.stars, d: o.checkIn, dd: o.depDate, n: o.nights, m: o.meal !== 'RO' ? o.meal : null, mr: o.mealRaw,
            r: o.room, p: o.price, fr: c.from_city, dep, fn: o.ticket ? o.ticket.no : '', al: o.ticket ? o.ticket.airline : '',
            g: o.gds, op: OP_NAME[o.opId] || o.opId, ok: o.avail === 'ok' || o.avail === 'few' }));
        });
      }
      if (!out.length && !anyOk) throw new Error('live_off');
    }
    // Har bir mehmonxonadan eng yaxshisi: joyi bor (tasdiqlanadigan) birinchi, keyin arzoni, keyin uchish vaqti ma'lumi.
    // Ro'yxat: avval joyi borlar narx bo'yicha, so'ng "so'rov bo'yicha"lar — agar joyi borlar yetmasa
    const better = (a, b) => (a.ok !== b.ok ? a.ok : a.p !== b.p ? a.p < b.p : a.dep != null && b.dep == null);
    const best = {};
    out.forEach(o => {
      const k = (o.h + '|' + (o.cid || o.c)).toLowerCase();
      if (!best[k] || better(o, best[k])) best[k] = o;
    });
    const all = Object.values(best);
    const sure = all.filter(o => o.ok).sort((a, b) => a.p - b.p);
    const req = all.filter(o => !o.ok).sort((a, b) => a.p - b.p);
    return { total: out.length, list: sure.concat(req).slice(0, MAX_RESULTS) };
  }

  // ---------- Ekranlar ----------
  async function showStart(c) {
    await send(c, tx(c, 'hello'), menu(c));
    if (!allowed(c)) await send(c, tx(c, 'need_link'));
    await send(c, tx(c, 'choose_lang'), { inline_keyboard: [[btn('🇺🇿 O\'zbekcha', 'lang:uz'), btn('🇷🇺 Русский', 'lang:ru')]] });
  }
  async function askCountry(c) {
    c.st = { step: 'country' }; save(c);
    const n = nm(c);
    await send(c, tx(c, 'choose_country'), { inline_keyboard: rows(COUNTRIES.map(id => btn(n.country(id), 'c:' + id)), 3) });
  }
  async function askNights(c) {
    await send(c, tx(c, 'choose_nights'), { inline_keyboard: [NIGHTS.map(n => btn(String(n), 'n:' + n))] });
  }
  async function askWhen(c) {
    await send(c, tx(c, 'choose_when'), { inline_keyboard: [[btn(tx(c, 'when_soon'), 'w:soon'), btn(tx(c, 'when_month'), 'w:month')], [btn(tx(c, 'when_date'), 'w:date')]] });
  }
  async function runSearch(c) {
    if (limited(searches, c.chat_id, SEARCHES_PER_10MIN, 600000)) return send(c, tx(c, 'limit_search'));
    await send(c, tx(c, 'searching'));
    api.call('sendChatAction', { chat_id: c.chat_id, action: 'typing' }).catch(() => {});
    let r;
    try { r = await findTours(c); }
    catch (e) {
      if (e.message !== 'live_off') log.error('[telegram] qidiruv xatosi:', e.message);
      return send(c, tx(c, 'live_off'));
    }
    const n = nm(c);
    if (!r.list.length) return send(c, tx(c, 'none', { c: n.country(c.st.country) }));
    c.st.results = r.list; c.st.step = 'results'; c.st.sel = null; c.st.photo = c.st.photo || null; c.st.ver = (c.st.ver || 0) + 1;
    save(c);
    await sendList(c, r.total);
  }
  // Natijalar ro'yxati: har bir tur — tugma (⏳ — "so'rov bo'yicha", operator tasdiqlaydi)
  async function sendList(c, total) {
    const m = markupOf(c), n = nm(c), v = c.st.ver;
    const buttons = c.st.results.map((o, i) => [btn(
      (i + 1) + '. ' + o.h.slice(0, 26) + (o.s ? ' ' + o.s + '★' : '') + ' · ' + o.d.slice(8, 10) + '.' + o.d.slice(5, 7) + ' · $' + P.clientPrice(o.p, m) + (o.ok ? '' : ' ⏳'),
      'o:' + v + ':' + i)]);
    buttons.push([btn(tx(c, 'top5'), 'top:' + v)], [btn(tx(c, 'again'), 'again')]);
    const text = tx(c, 'found', { c: n.country(c.st.country), from: n.fromForm(c.from_city), n: c.st.nights, k: total, m })
      + (c.st.results.some(o => !o.ok) ? '\n' + tx(c, 'req_note') : '');
    await send(c, text, { inline_keyboard: buttons });
  }

  function captions(c, kind) {
    const a = agencyOf(c);
    const opts = {
      markup: markupOf(c), phone: c.phone || (a && a.phone) || '', agency: a ? a.name : '', rate: TB.UZS_RATE, demo, I18N
    };
    const langs = c.post_lang === 'both' ? ['uz', 'ru'] : [c.post_lang === 'ru' ? 'ru' : 'uz'];
    return langs.map(lang => kind === 'top'
      ? P.buildDigest(c.st.results.slice(0, 5), Object.assign({ lang }, opts))
      : P.buildPost(c.st.results[c.st.sel], Object.assign({ lang }, opts)));
  }
  const previewKb = (c) => ({
    inline_keyboard: [
      [btn(tx(c, 'publish'), 'pub')],
      [btn(tx(c, 'photo'), 'photo'), btn(tx(c, 'plang', { x: PLANG[c.post_lang] || 'UZ' }), 'pl')],
      [btn(tx(c, 'back'), 'list')]
    ]
  });
  async function showPreview(c) {
    const kind = c.st.sel === 'top' ? 'top' : 'one';
    const caps = captions(c, kind);
    const photo = photoFor(c, c.st.country);
    for (let i = 0; i < caps.length; i++) {
      const kb = i === caps.length - 1 ? previewKb(c) : undefined;
      if (photo) await sendPhoto(c.chat_id, photo, caps[i], kb);
      else await send(c, caps[i], kb);
    }
  }

  async function publish(c) {
    if (!c.channel) return send(c, tx(c, 'no_channel'));
    if (!c.st.results || c.st.sel == null) return send(c, tx(c, 'expired'));
    const dayStart = new Date(today() + 'T00:00:00Z').getTime();
    if (q.postsToday.get(c.chat_id, 'channel', dayStart).n >= POSTS_PER_DAY) return send(c, tx(c, 'limit_posts', { n: POSTS_PER_DAY }));
    // Har safar tekshiriladi: bot hali ham kanalda adminmi
    const check = await verifyChannel(c.channel, null).catch(() => null);
    if (!check || check.error) return send(c, tx(c, 'publish_fail'));
    const caps = captions(c, c.st.sel === 'top' ? 'top' : 'one');
    const photo = photoFor(c, c.st.country);
    try {
      for (const cap of caps) {
        if (photo) await sendPhoto(c.channel, photo, cap);
        else await api.call('sendMessage', { chat_id: c.channel, text: cap, parse_mode: 'HTML', disable_web_page_preview: true });
      }
    } catch (e) {
      log.warn('[telegram] kanalga joylab bo\'lmadi:', e.description || e.message);
      return send(c, tx(c, 'publish_fail'));
    }
    const o = c.st.sel === 'top' ? c.st.results[0] : c.st.results[c.st.sel];
    q.post.run(c.chat_id, 'channel', (c.st.sel === 'top' ? 'top: ' : '') + (o ? o.h + ' ' + o.d + ' $' + o.p : ''), now());
    return send(c, tx(c, 'published', { ch: c.channel_title || c.channel }));
  }

  // Kanal: bot admin va post yoza oladimi; userId berilsa — foydalanuvchi ham shu kanal adminimi
  async function verifyChannel(ref, userId) {
    let ch;
    try { ch = await api.call('getChat', { chat_id: ref }); } catch (e) { return { error: 'ch_not_found' }; }
    if (ch.type !== 'channel' && ch.type !== 'supergroup') return { error: 'ch_type' };
    if (!me) me = await api.call('getMe', {});
    let bm;
    try { bm = await api.call('getChatMember', { chat_id: ch.id, user_id: me.id }); } catch (e) { return { error: 'ch_bot_admin' }; }
    if (bm.status !== 'administrator' || (ch.type === 'channel' && bm.can_post_messages === false)) return { error: 'ch_bot_admin' };
    if (userId) {
      let um;
      try { um = await api.call('getChatMember', { chat_id: ch.id, user_id: userId }); } catch (e) { return { error: 'ch_user_admin' }; }
      if (um.status !== 'creator' && um.status !== 'administrator') return { error: 'ch_user_admin' };
    }
    return { id: String(ch.id), title: ch.username ? '@' + ch.username : (ch.title || String(ch.id)) };
  }

  async function showSettings(c) {
    const a = agencyOf(c), n = nm(c);
    const m = markupOf(c);
    const text = tx(c, 'settings', {
      a: a ? escH(a.name) : tx(c, 'not_set'), m, ch: c.channel_title ? escH(c.channel_title) : tx(c, 'not_set'),
      ph: escH(c.phone || (a && a.phone) || tx(c, 'none_v')), from: n.fromName(c.from_city), pl: PLANG[c.post_lang] || 'UZ'
    });
    await send(c, text, {
      inline_keyboard: [
        [btn(tx(c, 's_lang'), 'set:lang'), btn(tx(c, 's_plang', { x: PLANG[c.post_lang] || 'UZ' }), 'set:pl')],
        [btn(tx(c, 's_from', { x: n.fromName(c.from_city) }), 'set:from')],
        [btn(tx(c, 's_ch'), 'set:ch'), btn(tx(c, 's_ph'), 'set:ph')],
        [btn(tx(c, 's_mk', { m }), 'set:mk')]
      ]
    });
  }
  const escH = (s) => String(s == null ? '' : s).replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));

  // ---------- Kiruvchi xabarlar ----------
  function parseDate(s) {
    const t0 = today();
    let m = String(s).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    let iso = m ? m[0] : null;
    if (!iso && (m = String(s).trim().match(/^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?$/))) {
      const dd = +m[1], mm = +m[2];
      let yy = m[3] ? +m[3] : +t0.slice(0, 4);
      if (yy < 100) yy += 2000;
      if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
      iso = yy + '-' + String(mm).padStart(2, '0') + '-' + String(dd).padStart(2, '0');
      if (!m[3] && iso <= t0) iso = (yy + 1) + iso.slice(4);          // yil yozilmagan va sana o'tgan — keyingi yil
    }
    if (!iso) return null;
    const d = new Date(iso + 'T00:00:00Z');
    if (isNaN(d) || d.toISOString().slice(0, 10) !== iso || iso <= t0 || iso > P.addDays(t0, 360)) return null;
    return iso;
  }

  async function onMessage(msg) {
    if (!msg.chat || msg.chat.type !== 'private') return;
    const c = chatOf(msg.chat, msg.from);
    if (limited(actions, c.chat_id, ACTIONS_PER_MIN, 60000)) { if ((actions.get(c.chat_id) || []).length === ACTIONS_PER_MIN + 1) await send(c, tx(c, 'slow')); return; }
    const text = String(msg.text || '').trim().slice(0, 300);
    const cmd = text.split(/\s+/)[0].replace(/@\w+$/, '').toLowerCase();

    if (cmd === '/start') { c.st = {}; save(c); return showStart(c); }
    if (cmd === '/help' || text === TXT.uz.menu_help || text === TXT.ru.menu_help) return send(c, tx(c, 'help'), menu(c));
    if (cmd === '/link') {
      const code = text.split(/\s+/)[1] || '';
      const a = /^\d{6}$/.test(code) ? accounts.useTelegramCode(code) : null;
      if (!a) return send(c, tx(c, 'link_bad'));
      c.agency_id = a.id;
      if (!c.phone && a.phone) c.phone = a.phone;
      save(c);
      return send(c, tx(c, 'linked', { a: escH(a.name), m: accounts.markupOf(a) }), menu(c));
    }
    if (cmd === '/unlink') { c.agency_id = null; save(c); return send(c, tx(c, 'unlinked'), menu(c)); }
    if (!allowed(c)) return send(c, tx(c, 'need_link'));

    // Kutilayotgan javoblar
    const step = c.st.step;
    if (step === 'await_photo' && msg.photo && msg.photo.length) {
      c.st.photo = msg.photo[msg.photo.length - 1].file_id;
      c.st.step = 'preview'; save(c);
      await send(c, tx(c, 'photo_ok'));
      return showPreview(c);
    }
    if (step === 'await_channel' && (text || msg.forward_from_chat || msg.forward_origin)) {
      const fwd = msg.forward_from_chat || (msg.forward_origin && msg.forward_origin.chat);
      let ref = fwd ? fwd.id : null;
      if (!ref) {
        const mm = text.match(/(?:t\.me\/|@)([A-Za-z][A-Za-z0-9_]{3,31})/) || text.match(/^([A-Za-z][A-Za-z0-9_]{3,31})$/);
        const idm = text.match(/^-100\d{5,}$/);
        ref = mm ? '@' + mm[1] : idm ? idm[0] : null;
      }
      if (!ref) return send(c, tx(c, 'ch_not_found'));
      const r = await verifyChannel(ref, msg.from && msg.from.id);
      if (r.error) return send(c, tx(c, r.error));
      c.channel = r.id; c.channel_title = r.title; c.st.step = null; save(c);
      return send(c, tx(c, 'ch_ok', { ch: escH(r.title) }), menu(c));
    }
    if (step === 'await_phone' && text) {
      const digits = text.replace(/\D/g, '');
      if (digits.length < 9 || digits.length > 15 || /[^\d+()\s-]/.test(text)) return send(c, tx(c, 'phone_bad'));
      c.phone = text.slice(0, 40); c.st.step = null; save(c);
      return send(c, tx(c, 'phone_ok'), menu(c));
    }
    if (step === 'await_markup' && text) {
      const a = agencyOf(c);
      if (!a) return send(c, tx(c, 'markup_link'));
      const mk = accounts.setMarkup(a.id, text.replace('%', '').trim());
      if (mk == null || mk === false) return send(c, tx(c, 'markup_bad'));
      c.st.step = null; save(c);
      return send(c, tx(c, 'markup_ok', { m: mk }), menu(c));
    }
    if (step === 'await_date' && text && !text.startsWith('/') && text !== tx(c, 'menu_post') && text !== tx(c, 'menu_settings')) {
      const iso = parseDate(text);
      if (!iso) return send(c, tx(c, 'bad_date'));
      c.st.when = 'date'; c.st.date = iso; c.st.step = 'searching'; save(c);
      return runSearch(c);
    }

    if (cmd === '/post' || text === TXT.uz.menu_post || text === TXT.ru.menu_post) return askCountry(c);
    if (cmd === '/settings' || text === TXT.uz.menu_settings || text === TXT.ru.menu_settings) return showSettings(c);
    return send(c, tx(c, 'unknown'), menu(c));
  }

  async function onCallback(cb) {
    const msg = cb.message;
    if (!msg || !msg.chat || msg.chat.type !== 'private') return answer(cb);
    const c = chatOf(msg.chat, cb.from);
    if (limited(actions, c.chat_id, ACTIONS_PER_MIN, 60000)) return answer(cb, tx(c, 'slow'));
    const data = String(cb.data || '');
    const [k, v, w] = data.split(':');
    await answer(cb);

    if (k === 'lang' && (v === 'uz' || v === 'ru')) {
      // Birinchi tanlov post tilini ham belgilaydi (keyin Sozlamalarda alohida o'zgartiriladi: UZ / RU / ikkalasi)
      c.lang = v; c.post_lang = v; save(c);
      await send(c, tx(c, 'hello'), menu(c));
      return allowed(c) ? null : send(c, tx(c, 'need_link'));
    }
    if (!allowed(c)) return send(c, tx(c, 'need_link'));

    if (k === 'c' && COUNTRIES.includes(v)) { c.st = { step: 'nights', country: v }; save(c); return askNights(c); }
    if (k === 'n' && NIGHTS.includes(+v) && c.st.country) { c.st.nights = +v; c.st.step = 'when'; save(c); return askWhen(c); }
    if (k === 'w' && c.st.country && c.st.nights) {
      if (v === 'date') { c.st.step = 'await_date'; save(c); return send(c, tx(c, 'ask_date')); }
      if (v === 'soon' || v === 'month') { c.st.when = v; c.st.step = 'searching'; save(c); return runSearch(c); }
    }
    if (k === 'again') { if (!c.st.country) return askCountry(c); c.st.step = 'when'; save(c); return askWhen(c); }
    if ((k === 'o' || k === 'top') && c.st.results) {
      if (+v !== c.st.ver) return send(c, tx(c, 'expired'));
      if (k === 'o') { const i = +w; if (!(i >= 0 && i < c.st.results.length)) return send(c, tx(c, 'expired')); c.st.sel = i; }
      else c.st.sel = 'top';
      c.st.step = 'preview'; save(c);
      await showPreview(c);
      return send(c, tx(c, 'preview'));
    }
    if (k === 'list' && c.st.results) return resend(c);
    if (k === 'pl') {
      c.post_lang = c.post_lang === 'uz' ? 'ru' : c.post_lang === 'ru' ? 'both' : 'uz'; save(c);
      return c.st.results && c.st.sel != null ? showPreview(c) : showSettings(c);
    }
    if (k === 'photo') { c.st.step = 'await_photo'; save(c); return send(c, tx(c, 'send_photo')); }
    if (k === 'pub') return publish(c);

    if (k === 'set') {
      if (v === 'lang') { c.lang = c.lang === 'uz' ? 'ru' : 'uz'; save(c); await send(c, '✅', menu(c)); return showSettings(c); }
      if (v === 'pl') { c.post_lang = c.post_lang === 'uz' ? 'ru' : c.post_lang === 'ru' ? 'both' : 'uz'; save(c); return showSettings(c); }
      if (v === 'from') { const n = nm(c); return send(c, tx(c, 'choose_from'), { inline_keyboard: rows(FROM_IDS.map(id => btn(n.fromName(id), 'from:' + id)), 3) }); }
      if (v === 'ch') { c.st.step = 'await_channel'; save(c); return send(c, tx(c, 'ask_channel')); }
      if (v === 'ph') { c.st.step = 'await_phone'; save(c); return send(c, tx(c, 'ask_phone')); }
      if (v === 'mk') { if (!agencyOf(c)) return send(c, tx(c, 'markup_link')); c.st.step = 'await_markup'; save(c); return send(c, tx(c, 'ask_markup')); }
    }
    if (k === 'from' && FROM_IDS.includes(v)) { c.from_city = v; save(c); return send(c, tx(c, 'from_ok', { x: nm(c).fromName(v) })); }
    return null;
  }
  // Natijalar ro'yxatini qayta ko'rsatish (yangi qidiruvsiz)
  const resend = (c) => sendList(c, c.st.results.length);

  // ---------- Yangilanishlar ----------
  function enqueue(chatId, fn) {
    const prev = chains.get(chatId) || Promise.resolve();
    const next = prev.then(fn).catch(async e => {
      log.error('[telegram] xato:', e.description || e.message);
      try { await api.call('sendMessage', { chat_id: chatId, text: (TXT[(q.get.get(String(chatId)) || {}).lang] || TXT.uz).error }); } catch (x) { /* */ }
    }).finally(() => { if (chains.get(chatId) === next) chains.delete(chatId); });
    chains.set(chatId, next);
    return next;
  }
  function handle(u) {
    if (u.message && u.message.chat) return enqueue(String(u.message.chat.id), () => onMessage(u.message));
    if (u.callback_query && u.callback_query.message) return enqueue(String(u.callback_query.message.chat.id), () => onCallback(u.callback_query));
    return Promise.resolve();
  }

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  async function loop() {
    let backoff = 1000;
    while (running) {
      try {
        const updates = await api.call('getUpdates', { offset, timeout: 25, allowed_updates: ['message', 'callback_query'] }, 35000);
        for (const u of updates) { offset = Math.max(offset, u.update_id + 1); handle(u); }
        backoff = 1000;
      } catch (e) {
        if (!running) break;
        if (e.name === 'AbortError') continue;
        if (e.code === 401 || e.code === 404) { log.error('[telegram] token noto\'g\'ri — bot to\'xtatildi.'); running = false; break; }
        if (e.code === 409) log.warn('[telegram] boshqa nusxa yoki webhook ishlayapti (409). Kutilmoqda…');
        else log.warn('[telegram] ulanish xatosi:', e.message);
        await sleep(e.retryAfter ? e.retryAfter * 1000 : backoff);
        backoff = Math.min(backoff * 2, 60000);
      }
    }
  }

  async function start() {
    if (running) return;
    running = true;
    try {
      me = await api.call('getMe', {});
      await api.call('deleteWebhook', { drop_pending_updates: false }).catch(() => {});
      const cmds = (lang) => [
        { command: 'post', description: lang === 'ru' ? 'Создать пост для канала' : 'Kanal uchun post yaratish' },
        { command: 'settings', description: lang === 'ru' ? 'Настройки' : 'Sozlamalar' },
        { command: 'link', description: lang === 'ru' ? 'Подключить аккаунт TezBooking' : 'TezBooking akkauntini ulash' },
        { command: 'help', description: lang === 'ru' ? 'Помощь' : 'Yordam' }
      ];
      await api.call('setMyCommands', { commands: cmds('uz') }).catch(() => {});
      await api.call('setMyCommands', { commands: cmds('ru'), language_code: 'ru' }).catch(() => {});
      // Bot profilidagi tavsif (foydalanuvchi /start bosishdan oldin ko'radi)
      const about = {
        uz: ['TezBooking — tur agentliklar uchun bot. Tur operatorlarning haqiqiy narxlaridan eng yaxshi turlarni topib, kanalingiz uchun tayyor post yozadi: mehmonxona, qayerdan va qachon uchish, necha kecha, narx (sizning foizingiz bilan) va rasm. O\'zbek va rus tillarida.',
          'Tur agentliklar uchun kanal postlari — haqiqiy narxlar bilan'],
        ru: ['TezBooking — бот для турагентств. Находит лучшие туры по реальным ценам туроператоров и пишет готовый пост для вашего канала: отель, откуда и когда вылет, сколько ночей, цена (с вашей наценкой) и фото. На русском и узбекском.',
          'Посты для каналов турагентств — по реальным ценам']
      };
      await api.call('setMyDescription', { description: about.uz[0] }).catch(() => {});
      await api.call('setMyShortDescription', { short_description: about.uz[1] }).catch(() => {});
      await api.call('setMyDescription', { description: about.ru[0], language_code: 'ru' }).catch(() => {});
      await api.call('setMyShortDescription', { short_description: about.ru[1], language_code: 'ru' }).catch(() => {});
      // Profil rasmi: botda rasm bo'lmasa — TezBooking logosi (images/telegram-bot-avatar.jpg). Bor rasm almashtirilmaydi.
      try {
        const avatar = path.join(root, 'images', 'telegram-bot-avatar.jpg');
        const photos = await api.call('getUserProfilePhotos', { user_id: me.id, limit: 1 });
        if (photos && photos.total_count === 0 && fs.existsSync(avatar)) {
          await api.upload('setMyProfilePhoto', { photo: { type: 'static', photo: 'attach://avatar' } }, 'avatar', avatar);
          log.log('  Telegram bot:             profil rasmi o\'rnatildi (TezBooking logosi)');
        }
      } catch (e) { log.warn('[telegram] profil rasmini o\'rnatib bo\'lmadi:', e.description || e.message); }
      log.log('  Telegram bot:             @' + me.username + (demo ? '  (DEMO narxlar)' : '') + (allowAll ? '  (ochiq rejim)' : ''));
    } catch (e) {
      log.error('[telegram] botni ishga tushirib bo\'lmadi:', e.description || e.message);
      if (e.code === 401 || e.code === 404) { running = false; return; }
    }
    loop();
  }
  function stop() { running = false; api.abortPoll && api.abortPoll(); }

  return { start, stop, handle, findTours, parseDate, _verifyChannel: verifyChannel };
}

module.exports = { createTelegramBot, TXT };
