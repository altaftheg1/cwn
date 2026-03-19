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
        '<div class="lang-switcher" id="langSwitcher">' +
          '<button class="lang-btn" id="langBtn">English \u25be</button>' +
          '<div class="lang-dropdown" id="langDropdown">' +
            '<div class="lang-option" data-lang="en">English</div>' +
            '<div class="lang-option" data-lang="ml">\u0d2e\u0d32\u0d2f\u0d3e\u0d33\u0d02</div>' +
            '<div class="lang-option" data-lang="ar">\u0627\u0644\u0639\u0631\u0628\u064a\u0629</div>' +
            '<div class="lang-option" data-lang="hi">\u0939\u093f\u0928\u094d\u0926\u0940</div>' +
            '<div class="lang-option" data-lang="tl">Filipino</div>' +
          '</div>' +
        '</div>' +
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
          '<button class="nav-lang-btn" id="navLangBtn" title="Change language">\ud83c\udf10</button>' +
        '</div>' +
      '</div>' +
    '</div>' +

    '<div class="ticker-bar">' +
      '<div class="ticker-label">' +
        '<div class="ticker-dot"></div>' +
        '<span>LIVE FEED</span>' +
      '</div>' +
      '<div class="ticker-content">' +
        '<div class="ticker-scroll" id="tickerScroll">Loading headlines\u2026</div>' +
      '</div>' +
    '</div>';

  /* ── Page title bar (non-home, non-article) ──────────── */
  var PAGE_META = {
    government: { icon: '\ud83c\udfd1', label: 'Government Announcements' },
    rta:        { icon: '\ud83d\ude97', label: 'Roads & Transport' },
    tech:       { icon: '\ud83d\udcbb', label: 'Technology' },
    sports:     { icon: '\u26bd',       label: 'Sports' },
    econ:       { icon: '\ud83d\udcc8', label: 'Economy & Business' },
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
    { href: '/',           label: 'Breaking', page: 'home',       svg: '<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>' },
    { href: '/government', label: 'Gov',      page: 'government', svg: '<path d="M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11M20 10v11M8 10v11M12 10v11M16 10v11"/>' },
    { href: '/rta',        label: 'RTA',      page: 'rta',        svg: '<rect x="1" y="3" width="15" height="13" rx="2"/><path d="M16 8h5l2 3v4h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>' },
    { href: '/tech',       label: 'Tech',     page: 'tech',       svg: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>' },
    { href: '/sports',     label: 'Sports',   page: 'sports',     svg: '<circle cx="12" cy="12" r="10"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/><path d="M2 12h20"/>' },
    { href: '/econ',       label: 'Econ',     page: 'econ',       svg: '<path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>' },
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

  /* ── Live ticker ─────────────────────────────────────── */
  fetch('/api/news')
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      var items = (d && d.items) ? d.items.slice(0, 20) : [];
      if (!items.length) return;
      var scroll = document.getElementById('tickerScroll');
      if (!scroll) return;
      var parts = items.map(function (it) {
        var cat = (it.category || it.sourceName || '').toUpperCase().substr(0, 6);
        var title = it.calmTitle || it.title || '';
        var url = it.url || '#';
        return '<span class="ticker-item">' +
               '<span class="ticker-badge">' + cat + '</span>' +
               '<a class="ticker-a" href="' + url + '" target="_blank" rel="noopener">' + title + '</a>' +
               '<span class="ticker-sep">\u25c6</span>' +
               '</span>';
      }).join('');
      scroll.innerHTML = parts + parts; // doubled for seamless loop
    })
    .catch(function () {});

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

  /* ── Language switcher ───────────────────────────────── */
  (function () {
    var btn      = document.getElementById('langBtn');
    var navBtn   = document.getElementById('navLangBtn');
    var dropdown = document.getElementById('langDropdown');
    if (!dropdown) return;

    function toggle(e) { e.stopPropagation(); dropdown.classList.toggle('open'); }
    if (btn)    btn.addEventListener('click', toggle);
    if (navBtn) navBtn.addEventListener('click', toggle);
    document.addEventListener('click', function () { dropdown.classList.remove('open'); });

    dropdown.querySelectorAll('.lang-option').forEach(function (opt) {
      opt.addEventListener('click', function () {
        var lang = opt.dataset.lang;
        /* Try Google Translate combo */
        var sel = document.querySelector('select.goog-te-combo');
        if (sel) { sel.value = lang === 'en' ? '' : lang; sel.dispatchEvent(new Event('change')); }
        dropdown.classList.remove('open');
        if (btn) btn.textContent = opt.textContent.trim() + ' \u25be';
      });
    });
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
