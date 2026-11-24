'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const P = require('../server/telegram/post');
const { createTelegramBot } = require('../server/telegram/bot');

const quiet = { warn() {}, error() {}, log() {} };

function tempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tez-tg-'));
  return require('../server/db').open(path.join(dir, 'test.db'));
}

// server/accounts.js ni haqiqiy marshrutlar orqali chaqirish (sendJson / readBody taqlidi)
function accountsHarness(db) {
  const accounts = require('../server/accounts').createAccounts({
    db, paymentMode: 'manual',
    sendJson: (res, status, obj) => res.done(status, obj),
    readBody: (req) => Promise.resolve(req.body)
  });
  const call = (pathname, body, cookie, ip) => new Promise((resolve) => {
    const req = { method: 'POST', headers: { 'content-type': 'application/json', cookie: cookie || '' }, socket: { remoteAddress: ip || '10.0.0.1' }, body: JSON.stringify(body || {}) };
    const res = { cookie: null, setHeader(k, v) { if (k === 'Set-Cookie') this.cookie = String(v).split(';')[0]; }, done(status, obj) { resolve({ status, obj, cookie: this.cookie }); } };
    accounts.handle(req, res, pathname);
  });
  return { accounts, call };
}

// Telegram API taqlidi: yuborilgan xabarlarni yozib boradi
function fakeApi({ botAdmin = true, userAdmin = true } = {}) {
  const sent = [];
  return {
    sent,
    last: () => sent.filter(s => s.method === 'sendMessage' || s.method === 'sendPhoto').slice(-1)[0],
    async call(method, params) {
      sent.push({ method, params });
      if (method === 'getMe') return { id: 999, username: 'tez_test_bot' };
      if (method === 'getChat') return { id: -100123, type: 'channel', username: 'mychannel', title: 'My channel' };
      if (method === 'getChatMember') {
        if (params.user_id === 999) return { status: botAdmin ? 'administrator' : 'member', can_post_messages: true };
        return { status: userAdmin ? 'creator' : 'member' };
      }
      if (method === 'sendPhoto' || method === 'sendMessage') return { message_id: sent.length, photo: [{ file_id: 'F1' }] };
      return true;
    },
    async upload(method, params) { sent.push({ method, params, upload: true }); return { message_id: sent.length, photo: [{ file_id: 'UP1' }] }; },
    abortPoll() {}
  };
}

const msg = (text, extra) => ({ message: Object.assign({ chat: { id: 42, type: 'private' }, from: { id: 7, language_code: 'uz' }, text }, extra || {}) });
const cbq = (data) => ({ callback_query: { id: 'cb', data, from: { id: 7 }, message: { chat: { id: 42, type: 'private' } } } });

test('post text: Uzbek and Russian with departure city, date, time, nights, markup price and phone', () => {
  const { I18N } = P.loadSite(ROOT);
  const offer = { co: 'tr', cid: 'antalya', h: 'Lara <Sunset> Resort', s: 5, d: '2026-12-11', n: 7, m: 'AI', rc: 'std', p: 1000, adults: 2, fr: 'skd', dep: 400, fn: 'SX 214', al: 'Silk Air' };
  const uz = P.buildPost(offer, { lang: 'uz', markup: 12, phone: '+998 90 123 45 67', agency: 'Sayyoh', rate: 12000, I18N });
  assert.match(uz, /Samarqanddan uchish: <b>11 dekabr, juma<\/b> · soat <b>06:40<\/b>/);
  assert.match(uz, /7 kecha \/ 8 kun \(11\.12 – 18\.12\)/);
  assert.match(uz, /\$1\u00A0120/);                              // 1000 + 12 %
  assert.match(uz, /Lara &lt;Sunset&gt; Resort/);               // HTML xavfsiz
  assert.match(uz, /\+998 90 123 45 67/);
  assert.ok(uz.length <= 1024);
  const ru = P.buildPost(offer, { lang: 'ru', markup: 12, I18N });
  assert.match(ru, /Вылет из Самарканда: <b>11 декабря, пятница<\/b> · в <b>06:40<\/b>/);
  assert.match(ru, /7 ноч\. \/ 8 дн\./);
  assert.match(P.buildPost(offer, { lang: 'uz', markup: 0, demo: true, I18N }), /DEMO/);
});

test('agency self-registration asks markup; markup can be changed; telegram code links the bot once', async () => {
  const db = tempDb();
  const { accounts, call } = accountsHarness(db);
  // Zaif parol va noto'g'ri foiz rad etiladi
  assert.strictEqual((await call('/api/agency/register', { name: 'Sayyoh Travel', login: 'sayyoh', password: 'short', phone: '+998901234567', markup: 12 })).obj.error, 'weak_password');
  assert.strictEqual((await call('/api/agency/register', { name: 'Sayyoh Travel', login: 'sayyoh', password: 'Parol12345', phone: '+998901234567', markup: 80 })).obj.error, 'bad_markup');
  // Bot tuzog'i (yashirin maydon) — rad
  assert.strictEqual((await call('/api/agency/register', { name: 'Bot', login: 'botx', password: 'Parol12345', phone: '+998901234567', markup: 10, website: 'x' })).status, 400);
  const reg = await call('/api/agency/register', { name: 'Sayyoh Travel', login: 'sayyoh', password: 'Parol12345', phone: '+998901234567', markup: 12.5 }, '', '10.0.0.2');
  assert.strictEqual(reg.status, 201);
  assert.strictEqual(reg.obj.agency.markup, 12.5);
  assert.ok(reg.cookie, 'ro\'yxatdan o\'tgach darhol kirgan');
  const mk = await call('/api/agency/markup', { markup: 15 }, reg.cookie);
  assert.strictEqual(mk.obj.agency.markup, 15);
  const codeRes = await call('/api/agency/telegram-code', {}, reg.cookie);
  assert.match(codeRes.obj.code, /^\d{6}$/);

  const api = fakeApi();
  const bot = createTelegramBot({ token: 'x', db, accounts, live: null, root: ROOT, apiImpl: api, log: quiet });
  await bot.handle(msg('/post'));
  assert.match(api.last().params.text, /\/link/, 'ulanmagan — /link so\'raladi');
  await bot.handle(msg('/link ' + codeRes.obj.code));
  assert.match(api.last().params.text, /Sayyoh Travel/);
  assert.match(api.last().params.text, /15%/);
  await bot.handle(msg('/link ' + codeRes.obj.code));
  assert.match(api.last().params.text, /noto'g'ri/, 'kod bir marta ishlaydi');
  db.close();
});

test('bot flow (demo prices): country → nights → when → list → preview with photo → publish to verified channel', async () => {
  const db = tempDb();
  const { accounts } = accountsHarness(db);
  const api = fakeApi();
  const bot = createTelegramBot({ token: 'x', db, accounts, live: null, root: ROOT, apiImpl: api, log: quiet, demo: true });
  await bot.handle(msg('/start'));
  await bot.handle(cbq('lang:ru'));
  await bot.handle(msg('/post'));
  assert.match(api.last().params.text, /В какую страну/);
  await bot.handle(cbq('c:tr'));
  await bot.handle(cbq('n:7'));
  await bot.handle(cbq('w:soon'));
  const list = api.last();
  assert.match(list.params.text, /Найдено туров/);
  const first = list.params.reply_markup.inline_keyboard[0][0];
  assert.match(first.callback_data, /^o:\d+:0$/);
  await bot.handle(cbq(first.callback_data));
  const photo = api.sent.find(s => s.method === 'sendPhoto');
  assert.ok(photo, 'post rasm bilan');
  assert.match(photo.params.caption, /ДЕМО/);
  assert.match(photo.params.caption, /Вылет из Ташкента/);
  assert.match(photo.params.caption, /\d{2}:\d{2}/, 'uchish vaqti');
  // Kanal ulanmagan — joylash so'ralganda ogohlantiradi
  await bot.handle(cbq('pub'));
  assert.match(api.last().params.text, /Канал не подключён/);
  // Kanalni ulash (bot va foydalanuvchi admin) va joylash
  await bot.handle(cbq('set:ch'));
  await bot.handle(msg('@mychannel'));
  assert.match(api.last().params.text, /Канал подключён/);
  await bot.handle(cbq('pub'));
  const toChannel = api.sent.filter(s => s.method === 'sendPhoto' && s.params.chat_id === '-100123');
  assert.strictEqual(toChannel.length, 1);
  assert.match(api.last().params.text, /Опубликовано/);
  db.close();
});

test('bot refuses a channel where the user is not an admin', async () => {
  const db = tempDb();
  const { accounts } = accountsHarness(db);
  const api = fakeApi({ userAdmin: false });
  const bot = createTelegramBot({ token: 'x', db, accounts, live: null, root: ROOT, apiImpl: api, log: quiet, open: true });
  await bot.handle(cbq('set:ch'));
  await bot.handle(msg('@someone_elses_channel'));
  assert.match(api.last().params.text, /admini emassiz/);
  db.close();
});

test('bot uses live operator prices with flight time; no fake fallback when live fails', async () => {
  const db = tempDb();
  const { accounts } = accountsHarness(db);
  const date = new Date(Date.now() + 9 * 86400000).toISOString().slice(0, 10);
  const live = {
    async search(kind, p) {
      assert.strictEqual(kind, 'tours');
      assert.strictEqual(p.from, 'skd');
      return { operators: [{ id: 'kompas', status: 'ok' }], offers: [
        { opId: 'kompas', hotel: 'Real Hotel', stars: 4, city: 'Alanya', checkIn: date, nights: 7, meal: 'AI', mealRaw: 'AI', room: 'Standard', price: 900, avail: 'ok', seats: 'ok', ticket: { price: 400, dep: 330, no: 'HY 271', airline: 'Uzbekistan Airways' } },
        { opId: 'kompas', hotel: 'Stop Hotel', stars: 5, city: 'Alanya', checkIn: date, nights: 7, meal: 'AI', room: 'Std', price: 500, avail: 'stop', seats: 'ok' }
      ] };
    }
  };
  const api = fakeApi();
  const bot = createTelegramBot({ token: 'x', db, accounts, live, root: ROOT, apiImpl: api, log: quiet, open: true });
  await bot.handle(cbq('set:from'));
  await bot.handle(cbq('from:skd'));
  await bot.handle(cbq('c:tr'));
  await bot.handle(cbq('n:7'));
  await bot.handle(cbq('w:soon'));
  const kb = api.last().params.reply_markup.inline_keyboard;
  assert.match(kb[0][0].text, /Real Hotel/);
  assert.ok(!kb.some(r => /Stop Hotel/.test(r[0].text)), 'sotuvi to\'xtagan tur chiqmaydi');
  await bot.handle(cbq(kb[0][0].callback_data));
  const cap = api.sent.filter(s => s.method === 'sendPhoto').slice(-1)[0].params.caption;
  assert.match(cap, /Samarqanddan uchish/);
  assert.match(cap, /05:30/);
  assert.doesNotMatch(cap, /DEMO/);

  const failing = { async search() { return { operators: [{ id: 'kompas', status: 'error' }], offers: [] }; } };
  const api2 = fakeApi();
  const bot2 = createTelegramBot({ token: 'x', db, accounts, live: failing, root: ROOT, apiImpl: api2, log: quiet, open: true });
  await bot2.handle(cbq('c:tr'));
  await bot2.handle(cbq('n:7'));
  await bot2.handle(cbq('w:soon'));
  assert.match(api2.last().params.text, /narx olib bo'lmadi/);
  db.close();
});

test('date parsing accepts 15.12 and ISO, rejects past dates', () => {
  const db = tempDb();
  const { accounts } = accountsHarness(db);
  const bot = createTelegramBot({ token: 'x', db, accounts, live: null, root: ROOT, apiImpl: fakeApi(), log: quiet, now: () => Date.parse('2026-11-24T10:00:00Z') });
  assert.strictEqual(bot.parseDate('15.12'), '2026-12-15');
  assert.strictEqual(bot.parseDate('2027-01-05'), '2027-01-05');
  assert.strictEqual(bot.parseDate('01.11'), '2027-11-01', 'o\'tgan oy-kun — keyingi yil');
  assert.strictEqual(bot.parseDate('25.11'), '2026-11-25');
  assert.strictEqual(bot.parseDate('2026-11-01'), null);
  assert.strictEqual(bot.parseDate('31.02'), null);
  db.close();
});
