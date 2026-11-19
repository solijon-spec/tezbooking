#!/usr/bin/env bash
# Yangi versiyani serverga qo'yish (GitHub'dan olib, qayta ishga tushiradi). Baza va .env ga tegmaydi.
#   cd ~/tezbooking && sudo bash deploy/update.sh
set -euo pipefail
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[ "$(id -u)" -eq 0 ] || { echo "sudo bash deploy/update.sh"; exit 1; }
git -C "$SRC" pull --ff-only
rsync -a --delete --exclude .git --exclude data --exclude .env "$SRC"/ /opt/tezbooking/
chown -R root:root /opt/tezbooking
systemctl restart tezbooking
sleep 2
systemctl is-active tezbooking
curl -fsS http://127.0.0.1:3000/api/health && echo
