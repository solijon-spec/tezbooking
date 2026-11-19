# TezBooking — serverga joylash

Natija: sayt `https://sizning-domen.uz`, admin panel `https://admin.sizning-domen.uz`, haqiqiy narxlar,
HTTPS avtomatik, server o'chib qolsa o'zi qayta ishga tushadi, baza har kuni zaxiralanadi.

## Nima kerak
1. **VPS** — Ubuntu 22.04 yoki 24.04, 1 GB RAM yetadi (oyiga ~$5–6: Hetzner, DigitalOcean, Vultr, Contabo).
   Serverning **IP manzili** va **root paroli** (yoki SSH kaliti) beriladi.
   Server O'zbekiston/Rossiya/Yevropa yaqinida bo'lsa yaxshi: operator saytlari ba'zan chet el IP'larini sekin javob beradi yoki to'sadi.
2. **Domen** (ixtiyoriy, lekin tavsiya etiladi — usiz login va parollar shifrlanmaydi).
   Domen sozlamalarida (DNS) ikkita `A` yozuvi qo'shing, ikkalasi ham server IP'siga:
   | Nomi | Turi | Qiymati |
   |---|---|---|
   | `@` (yoki `sizning-domen.uz`) | A | SERVER-IP |
   | `admin` | A | SERVER-IP |

## O'rnatish (5–10 daqiqa)
Kompyuteringizdan serverga kiring: `ssh root@SERVER-IP`, so'ng:

```bash
git clone https://github.com/solijon-spec/tezbooking.git
cd tezbooking
sudo bash deploy/setup.sh sizning-domen.uz     # domensiz: sudo bash deploy/setup.sh
```

Skript o'zi: Node.js 22, Caddy (HTTPS), systemd xizmati, devor (faqat 22/80/443), kunlik zaxira nusxani o'rnatadi
va oxirida **admin parolini bir marta** ko'rsatadi (nusxa oling). Qayta ishga tushirsangiz, mavjud baza va parollarga tegmaydi.

## Keyin
- **Admin panel:** `https://admin.sizning-domen.uz` → Tur firmalar bo'limida firma qo'shing → login/parolni bering.
- **To'lov rejimi** serverda doim `manual` (demo rejim production'da ishlamaydi): firma to'lov so'raydi → pul tushganini ko'rib,
  Admin → To'lovlar → Tasdiqlash.
- **AI yordamchi:** `sudo nano /etc/tezbooking.env` → `ANTHROPIC_API_KEY=...` → `sudo systemctl restart tezbooking`.
- **Yangilash** (GitHub'ga yangi kod yuklagach): `cd ~/tezbooking && sudo bash deploy/update.sh`.

## Foydali buyruqlar
```bash
sudo systemctl status tezbooking          # holati
sudo journalctl -u tezbooking -f          # jonli loglar
sudo systemctl restart tezbooking         # qayta ishga tushirish
ls /var/lib/tezbooking/backups            # zaxira nusxalar (oxirgi 14 kun)
```
Bazani tiklash: `sudo systemctl stop tezbooking`, zaxira faylni `/var/lib/tezbooking/tezbooking.db` o'rniga nusxalang
(`chown tezbooking:tezbooking`), `sudo systemctl start tezbooking`.

## Xavfsizlik (qisqacha)
- Server faqat `127.0.0.1` da tinglaydi; internetga faqat Caddy (80/443) chiqadi. Admin alohida manzilda, o'z paroli va urinishlar chegarasi bilan.
- Parollar va kalitlar `/etc/tezbooking.env` da (faqat root va xizmat o'qiydi), GitHub'da emas.
- Kod serverda faqat o'qiladi; xizmat faqat o'z ma'lumotlar papkasiga yoza oladi.
- Admin parolini istalgan payt almashtirish: `/etc/tezbooking.env` → `ADMIN_PASSWORD` → `systemctl restart tezbooking`.
- Serverga **parolsiz SSH kaliti** bilan kirishni sozlash va `PasswordAuthentication no` qilish tavsiya etiladi.

## Haqiqiy narxlar serverda
Operatorlarning ochiq qidiruvi serverning IP manzilidan so'raladi. Ba'zi operatorlar chet el yoki hosting IP'larini to'sishi mumkin:
o'rnatgach saytda qidirib ko'ring. Natija kelmasa: `journalctl -u tezbooking` va `curl "http://127.0.0.1:3000/api/live/status"`.
Yechim — O'zbekistondagi serverni tanlash yoki operatorlardan rasmiy API kaliti olish.
