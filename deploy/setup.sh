#!/usr/bin/env bash
# TezBooking — Ubuntu 22.04 / 24.04 serverga o'rnatish (root sifatida bir marta ishga tushiriladi).
#
#   git clone https://github.com/solijon-spec/tezbooking.git && cd tezbooking
#   sudo bash deploy/setup.sh tezbooking.uz        # domen bilan (HTTPS avtomatik)
#   sudo bash deploy/setup.sh                      # domensiz (faqat http://SERVER-IP, admin faqat SSH orqali)
#
# Qayta ishga tushirsa ham xavfsiz: mavjud .env, baza va parollarga tegmaydi.
set -euo pipefail

DOMAIN="${1:-}"
APP=/opt/tezbooking
DATA=/var/lib/tezbooking
ENVF=/etc/tezbooking.env
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

[ "$(id -u)" -eq 0 ] || { echo "root sifatida ishga tushiring: sudo bash deploy/setup.sh"; exit 1; }
echo "==> TezBooking o'rnatilmoqda ${DOMAIN:+(domen: $DOMAIN)}"

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl git rsync ufw gpg ca-certificates debian-keyring debian-archive-keyring apt-transport-https

# ---------- Node.js 22 (baza uchun node:sqlite kerak: 22.13+) ----------
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -e 'const[a,b]=process.versions.node.split(".").map(Number);if(a<22||(a===22&&b<13)){console.error("Node 22.13+ kerak: "+process.version);process.exit(1)}'

# ---------- Caddy (HTTPS sertifikatni o'zi oladi va yangilaydi) ----------
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

# ---------- Foydalanuvchi, kod, ma'lumotlar ----------
id tezbooking >/dev/null 2>&1 || useradd --system --home-dir "$DATA" --shell /usr/sbin/nologin tezbooking
mkdir -p "$DATA/backups"
chown -R tezbooking:tezbooking "$DATA"
chmod 750 "$DATA"
# Kod root'ga tegishli, faqat o'qiladi: server buzilsa ham kodni o'zgartira olmaydi
if [ "$SRC" != "$APP" ]; then
  mkdir -p "$APP"
  rsync -a --delete --exclude .git --exclude data --exclude .env "$SRC"/ "$APP"/
fi
chown -R root:root "$APP"

# ---------- Sozlamalar (/etc/tezbooking.env) — mavjud bo'lsa tegilmaydi ----------
NEWPASS=""
if [ ! -f "$ENVF" ]; then
  NEWPASS="$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 18)"
  cat > "$ENVF" <<EOF
NODE_ENV=production
PORT=3000
ADMIN_PORT=3001
DB_FILE=$DATA/tezbooking.db
PAYMENT_MODE=manual
TRUST_PROXY=1
COOKIE_SECURE=$([ -n "$DOMAIN" ] && echo 1 || echo 0)
ADMIN_PASSWORD=$NEWPASS
# AI yordamchi kerak bo'lsa, kalitni shu yerga yozing va: systemctl restart tezbooking
ANTHROPIC_API_KEY=
# Telegram bot (kanal postlari): @BotFather -> /newbot, tokenni yozing va: systemctl restart tezbooking
TELEGRAM_BOT_TOKEN=
# Xavfsizlik qalqoni hech qachon bloklamaydigan IP'lar (masalan, ofisingiz), vergul bilan
SHIELD_ALLOW_IPS=
EOF
fi
chown root:tezbooking "$ENVF"; chmod 640 "$ENVF"

# ---------- systemd ----------
cp "$APP/deploy/tezbooking.service" /etc/systemd/system/tezbooking.service
systemctl daemon-reload
systemctl enable --now tezbooking
systemctl restart tezbooking

# ---------- Caddy sozlamasi ----------
if [ -n "$DOMAIN" ]; then
  sed "s/__DOMAIN__/$DOMAIN/g" "$APP/deploy/Caddyfile.domain" > /etc/caddy/Caddyfile
else
  cp "$APP/deploy/Caddyfile.ip" /etc/caddy/Caddyfile
fi
systemctl enable caddy
systemctl reload caddy 2>/dev/null || systemctl restart caddy

# ---------- Kunlik zaxira nusxa (14 kun saqlanadi) ----------
cat > /etc/cron.d/tezbooking-backup <<EOF
17 3 * * * tezbooking /usr/bin/node $APP/server/backup.js >> $DATA/backups/backup.log 2>&1
EOF
chmod 644 /etc/cron.d/tezbooking-backup

# ---------- Xavfsizlik devori: faqat SSH, HTTP, HTTPS ----------
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

sleep 2
echo
echo "==> Tekshiruv"
systemctl is-active tezbooking | sed 's/^/  tezbooking : /'
systemctl is-active caddy | sed 's/^/  caddy      : /'
curl -fsS http://127.0.0.1:3000/api/health && echo || echo "  !! server javob bermadi: journalctl -u tezbooking -n 50"
echo
if [ -n "$DOMAIN" ]; then
  echo "  Sayt:   https://$DOMAIN"
  echo "  Admin:  https://admin.$DOMAIN"
  echo "  (DNS'da $DOMAIN va admin.$DOMAIN shu serverning IP'siga yo'naltirilgan bo'lishi kerak; sertifikat 1-2 daqiqada olinadi)"
else
  IP="$(curl -fsS https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"
  echo "  Sayt:   http://$IP"
  echo "  Admin:  internetga ochilmagan. Kompyuteringizdan:  ssh -L 3001:127.0.0.1:3001 root@$IP   so'ng  http://localhost:3001"
  echo "  (Parollar shifrlanmasligi uchun domen + HTTPS tavsiya etiladi: sudo bash deploy/setup.sh sizning-domen.uz)"
fi
if [ -n "$NEWPASS" ]; then
  echo
  echo "  ADMIN PAROLI (bir marta ko'rsatiladi, nusxa oling):  $NEWPASS"
  echo "  U $ENVF faylida ham turadi."
fi
