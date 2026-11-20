/*
 * TezBooking — yorug' / qorong'i rejim.
 * <head> ichida, CSS'dan keyin darhol yuklanadi (sahifa oq bo'lib miltillamasin).
 * Tanlov brauzerda saqlanadi; tanlanmagan bo'lsa — qurilma (tizim) sozlamasiga ergashadi.
 *   TezTheme.get() -> 'light' | 'dark'
 *   TezTheme.toggle()
 */
(function () {
  'use strict';
  var KEY = 'tezbooking.theme';
  var root = document.documentElement;
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function saved() {
    try { var v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' ? v : null; } catch (e) { return null; }
  }
  function current() { return saved() || (mq && mq.matches ? 'dark' : 'light'); }
  function apply() {
    var t = current();
    root.setAttribute('data-theme', t);
    root.style.colorScheme = t;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'dark' ? '#0E1729' : '#FFFFFF');
  }
  function toggle() {
    var next = current() === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(KEY, next); } catch (e) { /* saqlab bo'lmadi — shu sahifada ishlaydi */ }
    if (!saved()) root.setAttribute('data-theme', next); else apply();
    document.dispatchEvent(new CustomEvent('tez:theme', { detail: { theme: current() } }));
  }

  apply();
  if (mq) {
    var onChange = function () { if (!saved()) { apply(); document.dispatchEvent(new CustomEvent('tez:theme', { detail: { theme: current() } })); } };
    if (mq.addEventListener) mq.addEventListener('change', onChange); else if (mq.addListener) mq.addListener(onChange);
  }
  window.TezTheme = { get: function () { return root.getAttribute('data-theme') || current(); }, toggle: toggle };
})();
