/*
 * TezBooking — aylanma sana tanlagich (iOS taymeridagi baraban uslubida).
 *
 *   WheelPicker.open({
 *     value: '2026-11-25', min: '2026-11-18', max: '2028-11-18',
 *     booked: { '2026-11-27': ['Rixos Premium'], ... },   // bron qilingan kunlar — qizil, tanlab bo'lmaydi
 *     months: [...12], wd: [...7],                         // qisqa oy va hafta kuni nomlari
 *     labels: { title, day, month, year, done, cancel, today, booked, bookedN(n), skipped(dateText) },
 *     fmt: (iso) => 'Ср, 25 ноя 2026',
 *     returnFocus: element,
 *     onPick: (iso) => {}
 *   });
 *
 * Uchta ustun: kun / oy / yil. Ustun to'xtaganda sana tekshiriladi:
 * o'tgan sana -> eng yaqin ruxsat etilgan kun, bron qilingan kun -> keyingi bo'sh kun.
 */
(function (global) {
  'use strict';

  const H = 40;                    // bitta qator balandligi (CSS dagi --wp-h bilan bir xil)
  const pad = (n) => (n < 10 ? '0' : '') + n;
  const isoOf = (y, m, d) => y + '-' + pad(m + 1) + '-' + pad(d);
  const parse = (iso) => { const p = iso.split('-'); return { y: +p[0], m: +p[1] - 1, d: +p[2] }; };
  const dim = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const dow = (y, m, d) => new Date(Date.UTC(y, m, d)).getUTCDay();
  function addDays(iso, n) {
    const p = parse(iso), x = new Date(Date.UTC(p.y, p.m, p.d + n));
    return isoOf(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate());
  }
  const esc = (v) => String(v).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const reduceMotion = () => global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let current = null;              // ochiq tanlagich (bir vaqtda bittasi)

  function open(o) {
    if (current) current.close(false);
    const booked = o.booked || {};
    const min = o.min, max = o.max;
    const minP = parse(min), maxP = parse(max);
    const years = [];
    for (let y = minP.y; y <= maxP.y; y++) years.push(y);
    let sel = parse(clampFree(o.value, 1).iso);
    let note = '';

    // Ruxsat etilgan eng yaqin kun: chegaradan chiqmaydi, bron qilinganini o'tkazib yuboradi
    function clampFree(iso, dir) {
      if (iso < min) iso = min;
      if (iso > max) iso = max;
      if (!booked[iso]) return { iso, moved: false };
      for (let i = 1; i <= 800; i++) {
        const a = addDays(iso, dir * i), b = addDays(iso, -dir * i);
        if (a >= min && a <= max && !booked[a]) return { iso: a, moved: true };
        if (b >= min && b <= max && !booked[b]) return { iso: b, moved: true };
      }
      return { iso, moved: false };
    }

    // ---------- DOM ----------
    const root = document.createElement('div');
    root.className = 'wp-backdrop';
    root.innerHTML = `
<div class="wp-sheet" role="dialog" aria-modal="true" aria-labelledby="wp-title">
  <div class="wp-grip" aria-hidden="true"></div>
  <div class="wp-head">
    <button type="button" class="wp-btn wp-cancel">${esc(o.labels.cancel)}</button>
    <h2 id="wp-title" class="wp-title">${esc(o.labels.title)}</h2>
    <button type="button" class="wp-btn wp-done">${esc(o.labels.done)}</button>
  </div>
  <div class="wp-big" aria-live="polite"></div>
  <div class="wp-wheels">
    <div class="wp-band" aria-hidden="true"></div>
    <div class="wp-col wp-col-d" data-col="d" tabindex="0" role="spinbutton" aria-label="${esc(o.labels.day)}"><div class="wp-list"></div></div>
    <div class="wp-col wp-col-m" data-col="m" tabindex="0" role="spinbutton" aria-label="${esc(o.labels.month)}"><div class="wp-list"></div></div>
    <div class="wp-col wp-col-y" data-col="y" tabindex="0" role="spinbutton" aria-label="${esc(o.labels.year)}"><div class="wp-list"></div></div>
  </div>
  <div class="wp-foot">
    <span class="wp-legend"></span>
    <button type="button" class="wp-btn wp-today">${esc(o.labels.today)}</button>
  </div>
  <div class="wp-note" role="status"></div>
</div>`;
    document.body.appendChild(root);
    document.documentElement.classList.add('wp-lock');
    const sheet = root.querySelector('.wp-sheet');
    const cols = { d: root.querySelector('.wp-col-d'), m: root.querySelector('.wp-col-m'), y: root.querySelector('.wp-col-y') };
    const big = root.querySelector('.wp-big');
    const noteEl = root.querySelector('.wp-note');

    // Kelajakdagi bron qilingan kunlar soni
    const bookedDays = Object.keys(booked).filter(k => k >= min && k <= max);
    root.querySelector('.wp-legend').innerHTML = bookedDays.length
      ? `<i class="wp-dot" aria-hidden="true"></i>${esc(o.labels.booked)} · ${esc(o.labels.bookedN(bookedDays.length))}` : '';

    // ---------- Ustunlar ----------
    function fillMonths() {
      cols.m.firstChild.innerHTML = o.months.map((name, m) => {
        const off = (sel.y === minP.y && m < minP.m) || (sel.y === maxP.y && m > maxP.m);
        // Shu oyda bron qilingan kun bormi — kichik qizil nuqta
        const pre = sel.y + '-' + pad(m + 1) + '-';
        const has = bookedDays.some(k => k.indexOf(pre) === 0);
        return `<div class="wp-item${off ? ' wp-off' : ''}" data-i="${m}"><span class="wp-num">${esc(name)}</span>${has ? '<i class="wp-dot" aria-hidden="true"></i>' : ''}</div>`;
      }).join('');
    }
    function fillDays() {
      const n = dim(sel.y, sel.m);
      let html = '';
      for (let d = 1; d <= n; d++) {
        const iso = isoOf(sel.y, sel.m, d);
        const b = booked[iso];
        const cls = iso < min || iso > max ? ' wp-off' : b ? ' wp-booked' : '';
        const w = dow(sel.y, sel.m, d);
        html += `<div class="wp-item${cls}${w === 0 || w === 6 ? ' wp-we' : ''}" data-i="${d - 1}"${b ? ` title="${esc(o.labels.booked + ': ' + b.join(', '))}"` : ''}>` +
          `<span class="wp-num">${d}</span><span class="wp-wd">${esc(o.wd[w])}</span></div>`;
      }
      cols.d.firstChild.innerHTML = html;
    }
    cols.y.firstChild.innerHTML = years.map((y, i) => `<div class="wp-item" data-i="${i}"><span class="wp-num">${y}</span></div>`).join('');
    fillMonths(); fillDays();

    const indexOf = (k) => (k === 'd' ? sel.d - 1 : k === 'm' ? sel.m : years.indexOf(sel.y));

    // 3D baraban effekti: markazdan uzoqlashgan qatorlar egiladi va xiralashadi
    function paint(col) {
      const top = col.scrollTop, items = col.firstChild.children;
      for (let i = 0; i < items.length; i++) {
        const dist = (i * H - top) / H;                       // markazdan necha qator
        const a = Math.max(-1, Math.min(1, dist / 3));
        const it = items[i];
        if (Math.abs(dist) > 4) { it.style.transform = ''; it.style.opacity = '0'; continue; }
        it.style.transform = `rotateX(${-a * 62}deg) scale(${1 - Math.abs(a) * 0.12})`;
        it.style.opacity = String(1 - Math.abs(a) * 0.75);
        it.classList.toggle('wp-center', Math.abs(dist) < 0.5);
      }
    }
    function scrollCol(k, smooth) {
      const col = cols[k], top = indexOf(k) * H;
      if (Math.abs(col.scrollTop - top) < 1) { paint(col); return; }
      col.scrollTo({ top, behavior: smooth && !reduceMotion() ? 'smooth' : 'auto' });
      if (!smooth) paint(col);
    }
    function updateText() {
      const iso = isoOf(sel.y, sel.m, sel.d);
      big.textContent = o.fmt(iso);
      noteEl.textContent = note;
      noteEl.classList.toggle('show', !!note);
      const txt = { d: sel.d + ', ' + o.wd[dow(sel.y, sel.m, sel.d)], m: o.months[sel.m], y: String(sel.y) };
      Object.keys(cols).forEach(k => {
        cols[k].setAttribute('aria-valuenow', String(indexOf(k)));
        cols[k].setAttribute('aria-valuetext', txt[k]);
      });
    }

    // Ustun to'xtaganda: tanlangan qiymat o'qiladi va sana tekshiriladi
    function settle(k) {
      const col = cols[k], n = col.firstChild.children.length;
      const i = Math.max(0, Math.min(n - 1, Math.round(col.scrollTop / H)));
      const before = isoOf(sel.y, sel.m, sel.d);
      const next = { y: sel.y, m: sel.m, d: sel.d };
      if (k === 'd') next.d = i + 1;
      if (k === 'm') next.m = i;
      if (k === 'y') next.y = years[i];
      next.d = Math.min(next.d, dim(next.y, next.m));
      const wanted = isoOf(next.y, next.m, next.d);
      if (wanted === before) { scrollCol(k, true); return; }   // o'zgarmadi (yoki dastur o'zi surdi)
      const r = clampFree(wanted, wanted >= before ? 1 : -1);
      note = r.moved ? o.labels.skipped(o.fmt(wanted)) : '';
      setSel(parse(r.iso), true);
    }
    function setSel(p, smooth) {
      const ymChanged = p.y !== sel.y || p.m !== sel.m;
      const yChanged = p.y !== sel.y;
      sel = p;
      if (yChanged) fillMonths();
      if (ymChanged) { fillDays(); scrollCol('d', false); }
      ['d', 'm', 'y'].forEach(k => scrollCol(k, smooth));
      updateText();
      if (navigator.vibrate && !reduceMotion()) { try { navigator.vibrate(4); } catch (e) { /* yo'q */ } }
    }

    const timers = {};
    Object.keys(cols).forEach(k => {
      const col = cols[k];
      let raf = 0;
      col.addEventListener('scroll', () => {
        if (!raf) raf = requestAnimationFrame(() => { raf = 0; paint(col); });
        clearTimeout(timers[k]);
        timers[k] = setTimeout(() => settle(k), 130);
      }, { passive: true });
      // Qatorni bosish — o'sha qiymat markazga keladi
      col.addEventListener('click', (e) => {
        const it = e.target.closest('.wp-item');
        if (!it) return;
        col.scrollTo({ top: +it.dataset.i * H, behavior: reduceMotion() ? 'auto' : 'smooth' });
      });
      col.addEventListener('keydown', (e) => {
        const step = { ArrowUp: -1, ArrowDown: 1, PageUp: -5, PageDown: 5 }[e.key];
        if (step) { e.preventDefault(); col.scrollBy({ top: step * H, behavior: reduceMotion() ? 'auto' : 'smooth' }); }
        if (e.key === 'Home') { e.preventDefault(); col.scrollTo({ top: 0 }); }
        if (e.key === 'End') { e.preventDefault(); col.scrollTo({ top: col.scrollHeight }); }
      });
    });

    // ---------- Yopish ----------
    function close(pick) {
      if (current !== api) return;
      current = null;
      Object.keys(timers).forEach(k => clearTimeout(timers[k]));
      document.removeEventListener('keydown', onKey, true);
      document.documentElement.classList.remove('wp-lock');
      root.classList.remove('open');
      const done = () => root.remove();
      if (reduceMotion()) done(); else setTimeout(done, 220);
      if (o.returnFocus && document.contains(o.returnFocus)) o.returnFocus.focus({ preventScroll: true });
      if (pick) o.onPick(isoOf(sel.y, sel.m, sel.d));
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(false); return; }
      if (e.key === 'Enter' && e.target.classList && e.target.classList.contains('wp-col')) { e.preventDefault(); close(true); return; }
      if (e.key === 'Tab') {                                 // fokus oyna ichida qoladi
        const f = Array.from(sheet.querySelectorAll('button, [tabindex="0"]'));
        const i = f.indexOf(document.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
      }
    }
    document.addEventListener('keydown', onKey, true);
    root.addEventListener('click', (e) => { if (e.target === root) close(false); });
    root.querySelector('.wp-cancel').addEventListener('click', () => close(false));
    root.querySelector('.wp-done').addEventListener('click', () => close(true));
    root.querySelector('.wp-today').addEventListener('click', () => {
      const r = clampFree(min, 1);
      note = r.moved ? o.labels.skipped(o.fmt(min)) : '';
      setSel(parse(r.iso), true);
    });

    const api = { close };
    current = api;
    ['d', 'm', 'y'].forEach(k => scrollCol(k, false));
    updateText();
    requestAnimationFrame(() => {
      root.classList.add('open');
      ['d', 'm', 'y'].forEach(k => scrollCol(k, false));   // ko'rinadigan bo'lgach aniq joyiga
      cols.d.focus({ preventScroll: true });
    });
    return api;
  }

  global.WheelPicker = { open };
})(window);
