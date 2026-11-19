# TezBooking — tur qidiruv sayti (prototip)

Turagentliklar uchun bitta qidiruvda bir nechta turoperatorning turlarini solishtiradigan sayt.
Hozircha **demo ma'lumotlar** bilan ishlaydi: operatorlar, mehmonxonalar va narxlar o'ylab topilgan.
Sayt uch tilda ishlaydi: **o'zbekcha, ruscha, inglizcha** (yuqoridagi UZ / RU / EN tugmalari).

Uchta bo'lim (yuqori menyu):
- **Turlar** — aviareys + mehmonxona, operatorlar narxlari yonma-yon.
- **Mehmonxonalar** — faqat mehmonxona (aviareyssiz): xuddi shu qidiruv va filtrlar, narxda reys yo'q.
- **Aviachiptalar** — borish-qaytish yoki bir tomonga, ekonom/biznes; aviakompaniya, to'g'ri reys va bagaj filtrlari,
  ±3 kunlik narx tasmasi. Demo reyslar `js/data.js` ichidagi `flightsFor()` da hisoblanadi.

**Mavjudlik (real vaqt):** sotuvi to'xtagan, reysda joy qolmagan va bron qilingan variantlar umuman ko'rsatilmaydi.
«Bron qilish» bosilgan variant natijalardan va mijozga taklifdan darhol olib tashlanadi (xabardagi «Bekor qilish» bilan qaytarsa bo'ladi).
Sahifa har 30 soniyada mavjudlikni qayta tekshiradi: sotilib ketganlar ro'yxatdan yo'qoladi, taklifdagilari olib tashlanib, agentga xabar chiqadi.
Demo'da «sotilib ketish» kun davomida tasodifiy simulyatsiya qilinadi (`js/data.js` → `soldOut()`); haqiqiy versiyada bu operator API'sidan olinadi.

Uchala bo'limdan ham variantni **mijozga taklif**ga qo'shish mumkin — bitta taklifda tur, mehmonxona va aviachipta aralash bo'lishi mumkin.

## Demo versiya

**Internetda (o'rnatishsiz):** https://solijon-spec.github.io/tezbooking/
- Server kerak emas: sayt va admin panel API'si brauzer ichida taqlid qilinadi (`js/demo-api.js`).
- Har bir tashrif buyuruvchining o'z demo nusxasi bor (brauzerda saqlanadi), "Qayta boshlash" tugmasi boshlang'ich holatga qaytaradi.
- Demo faqat `*.github.io` da yoki manzilga `?demo` qo'shilganda yoqiladi (`?demo=0` — o'chiradi). Oddiy ishda (`npm start`) hech narsa qilmaydi.

**Lokal (shu kompyuterda):** `npm run demo` → sayt http://localhost:3100, admin http://localhost:3101
- Alohida baza `data/demo.db` — haqiqiy baza va `.env` parollariga tegilmaydi. Qayta to'ldirish: `npm run demo -- --reset`.

| Demo kirish | Login | Parol |
|---|---|---|
| Tur firma (tarif faol) | `demo` | `demo12345` |
| Tur firma (tarifsiz — sotib olishni sinash) | `yangi` | `demo12345` |
| Admin panel | — | `admin12345` |

Namunaviy ma'lumotlar (`js/demo-seed.js`): 7 tur firma (faol, muddati tugayotgan, tugagan, to'lov kutayotgan, bloklangan),
8 to'lov va 12 bron — sanalar bugungi kunga nisbatan, bronlar saytdagi haqiqiy takliflardan olinadi.
To'lov demo rejimida: "Sotib olish" pulsiz darhol faollashtiradi.

## Qanday ochiladi

Hech narsa o'rnatish shart emas.

- **Eng oddiy yo'l:** `index.html` faylini ikki marta bosing, sayt brauzerda ochiladi.
- **VS Code ichida:** chap paneldagi Extensions bo'limidan "Live Server" kengaytmasini o'rnating,
  so'ng `index.html` ustida o'ng tugma → **Open with Live Server**. Faylni saqlaganingizda sahifa o'zi yangilanadi.

## Fayllar

| Fayl | Nima qiladi |
|---|---|
| `index.html` | Sahifa skeleti, shriftlar va skriptlarni ulaydi |
| `css/styles.css` | Barcha ranglar va uslublar (asosiy rang: `--accent`), telefon uchun moslashuv |
| `js/i18n.js` | **Tillar:** barcha matnlar, davlat/shahar nomlari, oy va hafta kunlari (uz / ru / en) |
| `js/data.js` | Demo ma'lumotlar: davlatlar, mehmonxonalar, operatorlar va narx hisoblash |
| `js/app.js` | Interfeys: holat (state), chizish (render), tugmalar va filtrlar |
| `js/chat.js` | AI yordamchi oynasi (o'ng pastdagi tugma) |
| `js/wheel.js` | Aylanma sana tanlagich (bron qilingan kunlar qizil) |
| `js/sync.js` | Bronlarni server bazasi bilan sinxronlash |
| `server/server.js` | Server: saytni ochadi, AI chat savollarini Claude API'ga yuboradi |
| `server/db.js` | Ma'lumotlar bazasi (SQLite): bronlar va ularning tarixi |
| `server/bookings.js` | Bronlar API'si va jonli yangilanishlar |
| `server/admin.js` | Admin panel API'si: parol bilan kirish, bronlar, firmalar, to'lovlar, tariflar |
| `server/accounts.js` | Tur firmalar (login/parol), tariflar, to'lovlar |
| `js/account.js` | Saytda: tur firma kirishi, tariflar oynasi, to'lov |
| `js/demo-api.js`, `js/demo-seed.js` | Demo rejim: brauzerdagi soxta server va namunaviy ma'lumotlar |
| `server/demo.js` | Lokal demo: `npm run demo` (alohida baza, 3100/3101 portlar) |
| `admin.html`, `js/admin.js`, `css/admin.css` | Admin panel sahifasi (`/admin`) |
| `images/` | Sayt rasmlari (JPG, 960px): `country-<id>.jpg` — davlatlar, `hotel-resort-1..4` / `hotel-city-1..2` — mehmonxonalar (umumiy, AI bilan yaratilgan), `flight-plane.jpg` — aviachiptalar banneri. Logo: `logo.jpg` (asl, to'liq), `logo-mark.png` (belgi, 512px), `logo-mark-128.png` (sayt sarlavhasi), `favicon-32.png`, `apple-touch-icon.png` |
| `package.json` | `npm start` buyrug'i (qo'shimcha paket yo'q) |
| `.env.example` | Sozlamalar namunasi — undan `.env` faylini yasaysiz |

**Yangi matn qo'shish:** `js/i18n.js` ichida uchala tilga ham bir xil kalit bilan qo'shing,
so'ng `app.js` da `t('kalit')` orqali chaqiring.

## Qidiruv filtrlari

Filtrlar panelida mehmonxona nomi, shahar yoki davlat bo'yicha qidirish mumkin. Matnli qidiruv
operator, narx, yulduz, ovqatlanish, shahar va mavjudlik filtrlari bilan birga ishlaydi; **Tozalash** barcha filtrlarni tiklaydi.

## AI chat (AI yordamchi)

O'ng pastdagi **AI yordamchi** tugmasi chat oynasini ochadi. U **faqat tur va sayohat** savollariga javob beradi:
yo'nalish va mavsum, viza, mehmonxona, aviareys, narxlar, mijozga taklif matni, TezBooking'dan foydalanish.
Boshqa mavzudagi savollarga (dasturlash, retsept, siyosat va h.k.) muloyim rad javobi qaytadi.

Cheklov ikki qavatli va serverda turadi (brauzerdan o'zgartirib bo'lmaydi):
1. Har bir savolni avval tez model (**Claude Haiku 5.5**) tekshiradi: tur/sayohat mavzusimi yoki yo'q.
2. Javobni **Claude Sonnet 5.5** yozadi; uning ko'rsatmasida ham "faqat sayohat" qoidasi bor.

"Joriy qidiruvni hisobga olish" belgilangan bo'lsa, ekrandagi qidiruv natijalari (birinchi 10 ta mehmonxona) ham AI'ga yuboriladi —
"Bolali oila uchun qaysi biri mos?" kabi savollarga shu natijalar asosida javob beradi.

### Ishga tushirish

1. **Node.js** o'rnating (LTS versiya): https://nodejs.org. Tekshirish — VS Code terminalida (Ctrl + `):  `node -v`
2. **Claude API kaliti** oling: https://platform.claude.com → API Keys. (Hisobingizda to'lov usuli bo'lishi kerak.)
3. Loyiha papkasida `.env.example` faylidan nusxa olib, nomini **`.env`** qiling va kalitni yozing:
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   ```
4. VS Code terminalida:
   ```
   npm start
   ```
5. Brauzerda oching: **http://localhost:3000**
   (Server ishlab tursa, `index.html` ni to'g'ridan-to'g'ri ochganda ham chat ishlaydi.)

Server ishlamasa yoki kalit yo'q bo'lsa, chat oynasida shu haqda tushuntirish chiqadi.

### Xavfsizlik

- API kaliti faqat `.env` faylida va serverda turadi — brauzerga hech qachon yuborilmaydi.
- `.env` fayli `.gitignore` da: GitHub'ga yuklanmaydi. Uni hech kimga yubormang.
- Server faqat shu kompyuterdan ochiladi (127.0.0.1). Har bir kompyuterdan daqiqasiga 20 tagacha so'rov.
- Internetga chiqarishdan oldin: HTTPS, agentlik login'i va server sozlamalarini (CORS) qo'shish kerak.

### Sozlash

- Model nomlari va port — `.env` faylida (`CHAT_MODEL`, `GUARD_MODEL`, `PORT`).
- Qoidalar matni — `server/server.js` ichida: `GUARD_PROMPT` (mavzu tekshiruvi) va `systemPrompt()` (javob qoidalari).
- Rad javobi matnlari — `server/server.js` ichidagi `REFUSAL` (uz / ru / en).

## Bronlar bazasi (server)

`npm start` bilan server ishlab tursa, bronlar **`data/tezbooking.db`** (SQLite) bazasida saqlanadi:
- bir nechta kompyuter yoki agent bitta serverga ulansa, hammasi bir xil bronlarni ko'radi;
- bron qilinsa yoki bekor qilinsa, barcha ochiq sahifalar **o'zi yangilanadi** (sahifani qayta ochish shart emas);
- bitta taklifni ikki agent bron qila olmaydi — ikkinchisiga "allaqachon bron qilingan" xabari chiqadi;
- bron o'chirilmaydi, "bekor qilingan" deb belgilanadi; har bir o'zgarish tarixi `booking_events` jadvalida turadi;
- server birinchi marta ulanganda, shu brauzerda avval qilingan bronlar bazaga avtomatik ko'chiriladi.

Server ishlamasa (`index.html` fayldan ochilgan), sayt avvalgidek bronlarni faqat brauzerda saqlaydi.

| API | Nima qiladi |
|---|---|
| `GET /api/bookings` | Faol bronlar |
| `POST /api/bookings` | Yangi bron (`409` — allaqachon bron qilingan) |
| `POST /api/bookings/cancel` | Bekor qilish |
| `GET /api/bookings/history?key=…` | Bitta bron tarixi |
| `GET /api/events` | Jonli yangilanishlar (Server-Sent Events) |

Talab: **Node.js 22.13 yoki yangi** (baza uchun Node ichidagi `node:sqlite` ishlatiladi, paket o'rnatish shart emas).
Bazani zaxiralash: server to'xtatilganda `data/` papkasidan nusxa oling.

## Admin panel

Manzil: **http://localhost:3001** — saytdan alohida port (faqat server orqali ishlaydi). Sayt portidan (`3000/admin`) admin ochilmaydi. Portni `.env` dagi `ADMIN_PORT` bilan o'zgartirish mumkin.

1. `.env` fayliga parol yozing: `ADMIN_PASSWORD=...` (kamida 12 belgi). Parol bo'lmasa, admin panel o'chiq.
2. Serverni qayta ishga tushiring: `npm start`.

Imkoniyatlar:
- ko'rsatkichlar: faol bronlar, hozir safarda, kelgusi, shu oy yangi, faol bronlar summasi (netto), turlar bo'yicha;
- barcha bronlar jadvali: qidiruv, holat (faol / bekor qilingan) va tur bo'yicha filtr;
- bronni **bekor qilish** yoki **qayta tiklash** — saytdagi barcha sahifalar darhol yangilanadi;
- har bir bron **tarixi** (qachon yaratilgan, kim bekor qilgan);
- **CSV** yuklab olish (Excel'da ochiladi);
- saytda bron qilinsa, jadval o'zi yangilanadi ("Jonli" belgisi).

### Tur firmalar, tariflar va to'lov

1. **Admin → Tur firmalar:** firma nomi va login yoziladi, parol avtomatik yaratiladi (bir marta ko'rsatiladi — nusxa olib, firmaga yuboring).
2. Firma saytga **Kirish** tugmasi orqali kiradi. Qidirish hamma uchun bepul, lekin **bron qilish faqat faol tarif bilan**.
   Tarif bo'lmasa, natijalar tepasida "Bron qilish uchun tarifni sotib oling" chiqadi.
3. Firma **3 oylik / 6 oylik / 1 yillik** tarifni tanlaydi (narxlar: Admin → Tariflar, so'mda).
4. To'lov (`.env` → `PAYMENT_MODE`):
   - `manual` (asosiy): firma to'lov so'rovini yuboradi → pulni bank yoki naqd orqali to'laydi →
     **Admin → To'lovlar → Tasdiqlash** → tarif darhol faollashadi (firma sahifasi o'zi yangilanadi);
   - `demo`: sinov uchun, "Sotib olish" pulsiz darhol faollashtiradi. **Haqiqiy saytda yoqmang.**
   - Payme / Click: merchant shartnomasi olingach `server/accounts.js` ga qo'shiladi.
5. Admin firmaga tarifni qo'lda ham bera oladi (**Tarif berish**), parolni yangilashi va firmani bloklashi mumkin.
6. To'lagan firmalar: **Admin → Tur firmalar → "To'lagan"** filtri; tarifi 14 kun ichida tugaydiganlar "Umumiy" bo'limida ko'rinadi.

Har bir firma faqat **o'z bronlarini** ko'radi (nomi, sanalari qizil). Boshqa firmalar bron qilgan takliflar qidiruvdan yashiriladi.
Firma parollari bazada scrypt xesh ko'rinishida saqlanadi.

Xavfsizlik: parol faqat serverda, sessiya HttpOnly cookie'da (12 soat). Noto'g'ri parol daqiqasiga 5 martadan ko'p kiritilsa, kirish vaqtincha to'xtaydi.
Server qayta ishga tushsa, qayta kirish kerak.

## Brauzerda saqlanadigan narsalar

Til, valyuta, narx turi (netto / mijoz), "Mening davlatlarim", mijozga taklif uchun tanlangan variantlar
va AI chat tarixi sahifa yangilansa ham saqlanib qoladi (`localStorage`, `tezbooking.*` kalitlari).

## Tuzatilgan xatolar (2026-11-17)

1. Sanani klaviaturadan yozish endi ishlaydi (chala yozilgan sana bugunga sakramaydi).
2. Sotuvi to'xtagan takliflarni bron qilib / taklifga qo'shib bo'lmaydi; ular "Eng arzon" bo'lib chiqmaydi.
3. Telefonda filtrlar "Filtrlar" tugmasi orqali ochiladi — natijalar ancha tepada.
4. Telefonda taklif paneli ekranning ko'pi bilan yarmini egallaydi.
5. Davlat tugmalari va sana tasmasidagi narx filtrlarni hisobga oladi.
6. Bosganda aylantirish joyi (sana tasmasi, operatorlar jadvali, taklif paneli) saqlanadi.
7. Mijozga taklif sahifa yangilansa ham saqlanadi.
8. "So'rov bo'yicha" takliflarda "So'rov yuborish" deb yoziladi.
9. Bolalar yoshi va xonalar soni qo'shildi; bola bo'lsa "kishi boshiga" o'rniga "butun guruh uchun" ko'rsatiladi.
10. "Mehmonxonalar" / "Aviachiptalar" — "tez orada" belgisi; "Mijozga takliflar" panelni ochadi.
11. Telefonda yuqori menyu yig'iladi (≡ tugmasi).
12. Esc tugmasi oynalar va panelni yopadi.
13. Oxirgi davlat yoki yo'nalishni olib tashlashga urinilganda tushuntiruvchi xabar chiqadi.
14. Oyna yopilgandan keyin klaviatura fokusi to'g'ri joyga qaytadi.
15. Operator filtri ikki qatorli toza ko'rinishda.
16. Barcha tugmalar telefon uchun kamida 44 px.
17. Sana maydoni tozalansa yoki o'tgan sana yozilsa, oldingi sana qaytariladi.
18. Reyting so'zlari: A'lo / Juda yaxshi / Yaxshi / Qoniqarli.
19. Qaynoq takliflar ham "2 kishi uchun" jami narxni ko'rsatadi; davlat tugmalarida "... dan".
20. Sana maydoni ostida sana so'z bilan yoziladi (brauzer formati chalkashtirmasligi uchun).

## Keyingi qadamlar

1. **Haqiqiy operatorlarni ulash.** `js/data.js` ichidagi `offersFor()` o'rniga operatorlar API'si
   (masalan, SAMO XML-shlyuzi) chaqiriladi. Buning uchun server qismi (backend) kerak:
   API kalitlari brauzerda emas, serverda saqlanishi shart.
2. **Agentlik akkauntlari:** kirish, "Mening davlatlarim", ustama foizi (hozir 10 %) akkauntda saqlanadi.
3. **Bron:** operator tizimida bron qilish va bron holatini kuzatish.
4. **Taklif sahifasi:** mijozga yuboriladigan havola va agentlik logosi bilan PDF.
5. **So'm kursi:** hozir 12 100 ga qotirilgan — Markaziy bank kursidan olinadi.
