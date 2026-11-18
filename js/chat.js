/*
 * TezBooking — AI yordamchi (chat oynasi).
 *
 * Savollar server/server.js ga yuboriladi; server ularni Claude API orqali javoblaydi.
 * Faqat tur va sayohat mavzusidagi savollarga javob beriladi — bu cheklov serverda turadi.
 * Server topilmasa yoki API kaliti bo'lmasa, oynada tushuntirish chiqadi.
 *
 * Server manzili: sahifa serverning o'zidan ochilgan bo'lsa — o'sha manzil,
 * aks holda http://localhost:3000. Boshqa manzil uchun index.html da window.TEZBOOKING_API = '...' yozing.
 */
(function () {
  'use strict';

  const MAX_LEN = 2000;           // bitta xabar uzunligi
  const MAX_HISTORY = 12;         // serverga yuboriladigan oxirgi xabarlar
  const STORE_KEY = 'tezbooking.chat';
  const ERR_MARK = '\u0000ERR';

  const root = document.getElementById('chat-root');
  if (!root || !window.TezApp) return;
  const TA = window.TezApp;
  const t = (k, p) => TA.t(k, p);

  const esc = (v) => String(v).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  function load() {
    try {
      const list = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
      return Array.isArray(list) ? list.filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string').slice(-30) : [];
    } catch (e) { return []; }
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(chat.messages.filter(m => !m.pending).slice(-30))); } catch (e) { /* e'tiborsiz */ }
  }

  const chat = {
    open: false,
    messages: load(),     // { role, content, error?, stopped?, refused? }
    busy: false,
    ctrl: null,
    status: 'unknown',    // unknown | checking | online | nokey | offline
    base: null,
    useContext: true,
    lang: TA.lang()
  };

  // ---------- Ikonkalar ----------
  const svg = (size, body) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  const IC = {
    bot: svg(22, '<path d="M12 3v3"></path><rect x="4" y="7" width="16" height="12" rx="4"></rect><path d="M9 12h.01M15 12h.01"></path><path d="M9.5 15.5c1.5 1 3.5 1 5 0"></path>'),
    send: svg(20, '<path d="M4 12 20 4l-4 16-4-7z"></path><path d="m12 13 8-9"></path>'),
    stop: svg(18, '<rect x="6" y="6" width="12" height="12" rx="2"></rect>'),
    trash: svg(18, '<path d="M4 7h16"></path><path d="M10 11v6M14 11v6"></path><path d="M6 7l1 13h10l1-13"></path><path d="M9 7V4h6v3"></path>'),
    close: svg(20, '<path d="M6 6l12 12M18 6 6 18"></path>')
  };

  // ---------- Oddiy markdown (qalin matn, ro'yxatlar, sarlavhalar) ----------
  function md(text) {
    const inline = (s) => s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    let html = '', list = null;
    esc(text).split('\n').forEach(raw => {
      const line = raw.replace(/\s+$/, '');
      let m;
      if ((m = line.match(/^\s*[-*•]\s+(.*)$/)) || (m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
        const kind = /^\s*\d/.test(line) ? 'ol' : 'ul';
        if (list !== kind) { if (list) html += '</' + list + '>'; html += '<' + kind + '>'; list = kind; }
        html += '<li>' + inline(m[1]) + '</li>';
        return;
      }
      if (list) { html += '</' + list + '>'; list = null; }
      if (!line.trim()) return;
      if ((m = line.match(/^#{1,6}\s+(.*)$/))) { html += '<p><strong>' + inline(m[1]) + '</strong></p>'; return; }
      html += '<p>' + inline(line) + '</p>';
    });
    if (list) html += '</' + list + '>';
    return html;
  }

  // ---------- Tuzilma ----------
  root.innerHTML = `
    <button type="button" class="chat-launcher" aria-expanded="false" aria-controls="chat-panel">
      ${IC.bot}<span class="chat-launcher-text"></span>
    </button>
    <section id="chat-panel" class="chat" role="dialog" aria-labelledby="chat-title" aria-describedby="chat-sub" hidden>
      <div class="chat-head">
        <span class="chat-avatar" aria-hidden="true">${IC.bot}</span>
        <div class="chat-head-text">
          <h2 id="chat-title"></h2>
          <p id="chat-sub"></p>
        </div>
        <button type="button" class="chat-icon" data-chat="clear">${IC.trash}</button>
        <button type="button" class="chat-icon" data-chat="close">${IC.close}</button>
      </div>
      <div class="chat-status" hidden></div>
      <div class="chat-log" role="log" aria-live="off" tabindex="0"></div>
      <div class="chat-suggest"></div>
      <form class="chat-form">
        <label class="sr-only" for="chat-input"></label>
        <textarea id="chat-input" rows="1" maxlength="${MAX_LEN}" autocomplete="off"></textarea>
        <button type="submit" class="chat-send"></button>
      </form>
      <div class="chat-foot">
        <label class="chat-ctx"><input type="checkbox" checked><span></span></label>
        <span class="chat-note"></span>
      </div>
      <div class="sr-only" role="status" aria-live="polite" data-chat="announce"></div>
    </section>`;

  const $ = (sel) => root.querySelector(sel);
  const el = {
    launcher: $('.chat-launcher'), launcherText: $('.chat-launcher-text'), panel: $('#chat-panel'),
    title: $('#chat-title'), sub: $('#chat-sub'), clear: $('[data-chat="clear"]'), close: $('[data-chat="close"]'),
    status: $('.chat-status'), log: $('.chat-log'), suggest: $('.chat-suggest'), form: $('.chat-form'),
    label: $('label[for="chat-input"]'), input: $('#chat-input'), send: $('.chat-send'),
    ctx: $('.chat-ctx input'), ctxText: $('.chat-ctx span'), note: $('.chat-note'), announce: $('[data-chat="announce"]')
  };

  // ---------- Chizish ----------
  function renderLabels() {
    el.launcherText.textContent = t('chat_open');
    el.launcher.setAttribute('aria-label', t('chat_open'));
    el.title.textContent = t('chat_title');
    el.sub.textContent = t('chat_sub');
    el.clear.setAttribute('aria-label', t('chat_clear')); el.clear.title = t('chat_clear');
    el.close.setAttribute('aria-label', t('chat_close')); el.close.title = t('chat_close');
    el.label.textContent = t('chat_ph');
    el.input.placeholder = t('chat_ph');
    el.ctxText.textContent = t('chat_ctx');
    el.note.textContent = t('chat_disclaimer');
    renderSend();
  }

  function renderSend() {
    el.send.innerHTML = chat.busy ? IC.stop : IC.send;
    el.send.setAttribute('aria-label', chat.busy ? t('chat_stop') : t('chat_send'));
    el.send.title = chat.busy ? t('chat_stop') : t('chat_send');
    el.send.classList.toggle('is-stop', chat.busy);
    el.clear.disabled = chat.busy || !chat.messages.length;
  }

  function bubble(m) {
    let body;
    if (m.role === 'user') body = '<p>' + esc(m.content).replace(/\n/g, '<br>') + '</p>';
    else if (m.pending && !m.content) body = '<p class="chat-typing">' + esc(t('chat_thinking')) + '</p>';
    else body = md(m.content);
    if (m.stopped) body += '<p class="chat-meta">' + esc(t('chat_stopped')) + '</p>';
    if (m.error) body += '<p class="chat-err">' + esc(m.error) + '</p>';
    return `<div class="msg msg-${m.role === 'user' ? 'user' : 'ai'}${m.refused ? ' msg-refused' : ''}">
      <span class="sr-only">${esc(m.role === 'user' ? t('chat_you') : t('chat_ai'))}: </span>${body}</div>`;
  }

  function renderLog() {
    const hello = { role: 'assistant', content: t('chat_hello') };
    el.log.innerHTML = [hello].concat(chat.messages).map(bubble).join('');
    el.log.scrollTop = el.log.scrollHeight;
    el.suggest.innerHTML = chat.messages.length ? '' :
      ['chat_s1', 'chat_s2', 'chat_s3'].map(k => `<button type="button" class="chat-chip" data-q="${esc(t(k))}">${esc(t(k))}</button>`).join('');
    renderSend();
  }

  function updateLast() {
    const last = el.log.lastElementChild;
    const m = chat.messages[chat.messages.length - 1];
    if (!last || !m) return;
    const nearBottom = el.log.scrollHeight - el.log.scrollTop - el.log.clientHeight < 80;
    last.outerHTML = bubble(m);
    if (nearBottom) el.log.scrollTop = el.log.scrollHeight;
  }

  function renderStatus() {
    const text = chat.status === 'offline' ? t('chat_offline') : chat.status === 'nokey' ? t('chat_nokey') : '';
    el.status.hidden = !text;
    el.status.innerHTML = text ? `<span>${esc(text)}</span><button type="button" class="chat-retry" data-chat="retry">${esc(t('chat_retry'))}</button>` : '';
  }

  // ---------- Server bilan ishlash ----------
  async function findServer() {
    chat.status = 'checking';
    const candidates = [];
    if (window.TEZBOOKING_API) candidates.push(String(window.TEZBOOKING_API).replace(/\/$/, ''));
    if (/^https?:$/.test(location.protocol)) candidates.push('');
    candidates.push('http://localhost:3000');
    for (const base of candidates) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 2500);
        const resp = await fetch(base + '/api/health', { signal: ctrl.signal, cache: 'no-store' });
        clearTimeout(timer);
        if (!resp.ok) continue;
        const info = await resp.json();
        if (info && info.service === 'tezbooking-ai') {
          chat.base = base;
          chat.status = info.hasKey ? 'online' : 'nokey';
          return;
        }
      } catch (e) { /* keyingi manzil */ }
    }
    chat.status = 'offline';
  }

  async function ask(text) {
    text = text.trim();
    if (!text || chat.busy) return;
    if (text.length > MAX_LEN) { announce(t('chat_too_long', { n: MAX_LEN })); return; }
    if (chat.status !== 'online') {
      await findServer();
      renderStatus();
      if (chat.status !== 'online') return;
    }
    // Tarix: faqat javob olgan savol-javob juftliklari (rad etilgan yoki xato bo'lgan savollar yuborilmaydi)
    const history = [];
    for (let i = 0; i < chat.messages.length; i++) {
      const q = chat.messages[i], r = chat.messages[i + 1];
      if (q.role !== 'user') continue;
      if (r && r.role === 'assistant' && r.content && !r.refused && !r.error) {
        history.push({ role: 'user', content: q.content }, { role: 'assistant', content: r.content });
        i++;
      }
    }
    history.push({ role: 'user', content: text });
    history.splice(0, Math.max(0, history.length - MAX_HISTORY));
    chat.messages.push({ role: 'user', content: text });
    const reply = { role: 'assistant', content: '', pending: true };
    chat.messages.push(reply);
    chat.busy = true;
    el.input.value = '';
    autosize();
    renderLog();

    const ctrl = new AbortController();
    chat.ctrl = ctrl;
    try {
      const resp = await fetch(chat.base + '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lang: TA.lang(), messages: history, context: chat.useContext ? TA.context() : null }),
        signal: ctrl.signal
      });
      if (!resp.ok) {
        reply.error = resp.status === 429 ? t('chat_limit') : resp.status === 503 ? t('chat_nokey') : resp.status === 413 ? t('chat_too_long', { n: MAX_LEN }) : t('chat_error');
        if (resp.status === 503) chat.status = 'nokey';
      } else {
        reply.refused = resp.headers.get('X-Refused') === '1';
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          reply.content += decoder.decode(value, { stream: true });
          if (reply.content.includes(ERR_MARK)) { reply.content = reply.content.split(ERR_MARK).join(''); reply.error = t('chat_error'); }
          updateLast();
        }
        reply.content += decoder.decode();
      }
    } catch (e) {
      if (e.name === 'AbortError') reply.stopped = true;
      else { reply.error = t('chat_error'); chat.status = 'unknown'; }
    }
    if (!reply.content && !reply.error && !reply.stopped) reply.error = t('chat_error');
    reply.pending = false;
    chat.busy = false;
    chat.ctrl = null;
    save();
    renderLog();
    renderStatus();
    announce(reply.error || t('chat_new_answer', { x: reply.content.slice(0, 200) }));
    if (chat.open) el.input.focus();
  }

  function announce(text) {
    el.announce.textContent = '';
    setTimeout(() => { el.announce.textContent = text; }, 50);
  }

  function autosize() {
    el.input.style.height = 'auto';
    el.input.style.height = Math.min(el.input.scrollHeight, 140) + 'px';
  }

  // ---------- Ochish / yopish ----------
  async function openChat() {
    chat.open = true;
    el.panel.hidden = false;
    el.launcher.setAttribute('aria-expanded', 'true');
    document.body.classList.add('chat-open');
    renderLog();
    el.input.focus();
    if (chat.status === 'unknown' || chat.status === 'offline') {
      await findServer();
      renderStatus();
    }
  }
  function closeChat() {
    if (chat.busy && chat.ctrl) chat.ctrl.abort();
    chat.open = false;
    el.panel.hidden = true;
    el.launcher.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('chat-open');
    el.launcher.focus();
  }

  // ---------- Hodisalar ----------
  el.launcher.addEventListener('click', () => (chat.open ? closeChat() : openChat()));
  el.close.addEventListener('click', closeChat);
  el.clear.addEventListener('click', () => {
    if (chat.busy) return;
    chat.messages = [];
    save();
    renderLog();
    el.input.focus();
  });
  el.form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (chat.busy) { if (chat.ctrl) chat.ctrl.abort(); return; }
    ask(el.input.value);
  });
  el.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); el.form.requestSubmit(); }
  });
  el.input.addEventListener('input', autosize);
  el.suggest.addEventListener('click', (e) => {
    const chip = e.target.closest('.chat-chip');
    if (chip) ask(chip.dataset.q);
  });
  el.status.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-chat="retry"]')) return;
    await findServer();
    renderStatus();
  });
  el.ctx.addEventListener('change', () => { chat.useContext = el.ctx.checked; });
  el.panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); closeChat(); }
  });
  // Til almashganda yozuvlar yangilanadi
  document.addEventListener('tez:render', (e) => {
    if (e.detail && e.detail.lang !== chat.lang) {
      chat.lang = e.detail.lang;
      renderLabels();
      renderLog();
      renderStatus();
    }
  });

  renderLabels();
  renderLog();
})();
