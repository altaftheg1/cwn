/* ============================================================
   TheDubaiBrief — Shared Header
   Injects: utility bar · sticky navbar · live ticker
            page title bar (non-home) · bottom nav
   ============================================================ */
(function () {
  'use strict';

  /* ── Detect current page ─────────────────────────────── */
  var path = window.location.pathname.replace(/\/$/, '') || '/';
  var PAGE_MAP = {
    '/':            'home',
    '/government':  'government',
    '/rta':         'rta',
    '/tech':        'tech',
    '/sports':      'sports',
    '/econ':        'econ',
    '/uae':         'uae',
    '/business':    'business',
    '/trending':    'trending',
    '/article':     'article',
    '/archive':     'archive',
    '/about':       'about',
    '/about.html':  'about',
    '/search':      'search',
    '/saved':       'saved',
    '/support':     'support',
    '/advertise':   'advertise',
    '/privacy':     'privacy',
    '/privacy.html':'privacy',
    '/terms':       'terms',
    '/terms.html':  'terms',
    '/contact':     'contact',
    '/contact.html':'contact',
    '/sources':     'sources',
    '/sources.html':'sources',
  };
  var page = PAGE_MAP[path] || (path.startsWith('/article') ? 'article' : 'other');

  /* ── Dark mode state (read before injecting) ─────────── */
  var isDark = localStorage.getItem('theme') === 'dark';

  /* ── Build header HTML ───────────────────────────────── */
  var headerHTML =
    '<div class="utility-bar">' +
      '<div class="utility-left">' +
        '<span><span class="utility-clock" id="clockDisplay">00:00 GST</span></span>' +
        '<span id="dateDisplay">\u2026</span>' +
        '<span>Dubai, UAE</span>' +
        '<span class="live-visitors" id="liveVisitors" title="People on TheDubaiBrief right now">' +
          '<span class="live-visitors-dot"></span>' +
          '<span id="liveVisitorCount">\u2013</span>\u00a0online' +
        '</span>' +
      '</div>' +
      '<div class="utility-right">' +
        '<a href="/about.html">About</a>' +
        '<a href="/sources.html">Sources</a>' +
        '<a href="/contact.html">Contact</a>' +
      '</div>' +
    '</div>' +

    '<div class="site-header-sticky">' +
      '<div class="header-inner">' +
        '<div class="navbar-left">' +
          '<a class="brand" href="/">' +
            '<div class="logo-boxes">' +
              '<div class="logo-box">D</div>' +
              '<div class="logo-box">U</div>' +
              '<div class="logo-box">B</div>' +
            '</div>' +
            '<div class="logo-text">' +
              '<div class="logo-text-main">TheDubaiBrief</div>' +
              '<div class="logo-text-sub">Dubai\'s News. Clear &amp; Calm.</div>' +
            '</div>' +
          '</a>' +
        '</div>' +
        '<div class="navbar-right">' +
          '<button id="notifyBtn" class="notify-btn">Notify me</button>' +
          '<button class="dark-toggle" id="darkToggle" title="Toggle dark mode">' + (isDark ? '\u2600' : '\u263e') + '</button>' +
        '</div>' +
      '</div>' +
    '</div>' +

    '';

  /* ── Page title bar (non-home, non-article) ──────────── */
  var PAGE_META = {
    government: { icon: '\ud83c\udfd1', label: 'Government Announcements' },
    rta:        { icon: '\ud83d\ude97', label: 'Roads & Transport' },
    tech:       { icon: '\ud83d\udcbb', label: 'Technology' },
    sports:     { icon: '\u26bd',       label: 'Sports' },
    econ:       { icon: '\ud83d\udcc8', label: 'Economy & Business' },
    uae:        { icon: '\ud83c\udde6\ud83c\uddea', label: 'UAE News' },
    business:   { icon: '\ud83d\udcb0', label: 'Business & Economy' },
    trending:   { icon: '\ud83d\udd25', label: 'Trending Now' },
    archive:    { icon: '\ud83d\udcc1', label: 'News Archive' },
    about:      { icon: '\u2139\ufe0f', label: 'About TheDubaiBrief' },
    privacy:    { icon: '\ud83d\udd12', label: 'Privacy Policy' },
    terms:      { icon: '\ud83d\udcc4', label: 'Terms of Service' },
    support:    { icon: '\ud83d\udcac', label: 'Support' },
    advertise:  { icon: '\ud83d\udce2', label: 'Advertise' },
    saved:      { icon: '\ud83d\udd16', label: 'Saved Articles' },
    search:     { icon: '\ud83d\udd0d', label: 'Search' },
    contact:    { icon: '\u2709\ufe0f', label: 'Contact' },
    sources:    { icon: '\ud83d\udcf0', label: 'Our Sources' },
  };

  if (page !== 'home' && page !== 'article' && PAGE_META[page]) {
    var meta = PAGE_META[page];
    headerHTML +=
      '<div class="sh-title-bar">' +
        '<a class="sh-back-link" href="/">\u2190 Back</a>' +
        '<span class="sh-title-text">' + meta.icon + ' ' + meta.label + '</span>' +
        '<span></span>' +
      '</div>';
  }

  /* ── Bottom nav items ────────────────────────────────── */
  var NAV = [
    { href: '/',          label: 'Breaking',  page: 'home',     svg: '<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>' },
    { href: '/uae',       label: 'UAE',       page: 'uae',      svg: '<path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>' },
    { href: '/business',  label: 'Business',  page: 'business', svg: '<path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>' },
    { href: '/sports',    label: 'Sports',    page: 'sports',   svg: '<circle cx="12" cy="12" r="10"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/><path d="M2 12h20"/>' },
    { href: '/tech',      label: 'Tech',      page: 'tech',     svg: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>' },
  ];

  var bnHTML = '<nav class="bottom-nav" id="bottomNav" aria-label="Site navigation">';
  NAV.forEach(function (item) {
    var active = item.page === page ? ' active' : '';
    bnHTML += '<a class="bn-item' + active + '" href="' + item.href + '">' +
              '<svg viewBox="0 0 24 24" aria-hidden="true">' + item.svg + '</svg>' +
              item.label + '</a>';
  });
  bnHTML += '</nav>';

  /* ── Inject into DOM ─────────────────────────────────── */
  document.body.insertAdjacentHTML('afterbegin', headerHTML);
  document.body.insertAdjacentHTML('beforeend', bnHTML);

  /* ── Clock ───────────────────────────────────────────── */
  function updateClock() {
    var now = new Date();
    var parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Dubai',
      hour: '2-digit', minute: '2-digit', hour12: false,
      month: 'short', day: 'numeric', year: 'numeric'
    }).formatToParts(now);
    var get = function (t) { return (parts.find(function (p) { return p.type === t; }) || {}).value || ''; };
    var cl = document.getElementById('clockDisplay');
    var dl = document.getElementById('dateDisplay');
    if (cl) cl.textContent = get('hour') + ':' + get('minute') + ' GST';
    if (dl) dl.textContent = get('month') + ' ' + get('day') + ', ' + get('year');
  }
  updateClock();
  setInterval(updateClock, 1000);

  /* ── Dark mode ───────────────────────────────────────── */
  (function () {
    var toggle = document.getElementById('darkToggle');
    if (!toggle) return;
    toggle.dataset.shDark = '1'; // signal to page-specific scripts not to re-bind
    function applyDark(dark) {
      document.documentElement.classList.toggle('dark', dark);
      document.body.classList.toggle('dark', dark);
      toggle.textContent = dark ? '\u2600' : '\u263e';
    }
    applyDark(localStorage.getItem('theme') === 'dark');
    toggle.addEventListener('click', function () {
      var dark = !document.body.classList.contains('dark');
      localStorage.setItem('theme', dark ? 'dark' : 'light');
      applyDark(dark);
    });
  }());


  /* ── Visitor count (ping every 30s) ─────────────────── */
  (function () {
    var sid = sessionStorage.getItem('cwn-sid');
    if (!sid) {
      sid = 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      sessionStorage.setItem('cwn-sid', sid);
    }
    var countEl = document.getElementById('liveVisitorCount');
    function ping() {
      fetch('/api/ping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sid: sid })
      }).then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) { if (d && countEl) countEl.textContent = d.visitors; })
        .catch(function () {});
    }
    ping();
    setInterval(ping, 30000);
  }());


  /* ── Notify button — fire custom event ───────────────── */
  (function () {
    var btn = document.getElementById('notifyBtn');
    if (!btn) return;
    btn.addEventListener('click', function () {
      /* If page has openSubscribeModal defined, call it; else open custom event */
      if (typeof window.openSubscribeModal === 'function') {
        window.openSubscribeModal();
      } else {
        document.dispatchEvent(new CustomEvent('sh:notify', { bubbles: true }));
      }
    });
  }());

}());
