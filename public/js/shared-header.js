/* ================================================================
   TheDubaiBrief — Shared Header Behaviour
   Included on every page except the main homepage (which has its
   own inline version). Handles: clock, dark mode, visitors,
   ticker, hamburger, language switcher, notify button.
   ================================================================ */
(function () {
  'use strict';

  /* ── Clock & date ─────────────────────────────────────────── */
  function updateClock() {
    var parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Dubai',
      hour: '2-digit', minute: '2-digit', hour12: false,
      month: 'short', day: 'numeric', year: 'numeric'
    }).formatToParts(new Date());
    function get(t) { var p = parts.find(function(x){return x.type===t;}); return p ? p.value : ''; }
    var clk = document.getElementById('clockDisplay');
    var dt  = document.getElementById('dateDisplay');
    if (clk) clk.textContent = get('hour').padStart(2,'0') + ':' + get('minute').padStart(2,'0') + ' GST';
    if (dt)  dt.textContent  = get('month') + ' ' + get('day') + ', ' + get('year');
  }
  updateClock();
  setInterval(updateClock, 1000);

  /* ── Dark mode ────────────────────────────────────────────── */
  function applyDark(dark) {
    document.documentElement.classList.toggle('dark', dark);
    document.body.classList.toggle('dark', dark);
    var t = document.getElementById('darkToggle');
    if (t) t.textContent = dark ? '☀' : '☾';
  }
  applyDark(localStorage.getItem('theme') === 'dark');
  var darkBtn = document.getElementById('darkToggle');
  if (darkBtn) {
    darkBtn.addEventListener('click', function () {
      var dark = !document.documentElement.classList.contains('dark');
      localStorage.setItem('theme', dark ? 'dark' : 'light');
      applyDark(dark);
    });
  }

  /* ── Live visitors ────────────────────────────────────────── */
  var sid = sessionStorage.getItem('cwn-sid');
  if (!sid) {
    sid = 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    sessionStorage.setItem('cwn-sid', sid);
  }
  function pingVisitors() {
    fetch('/api/ping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sid: sid })
    }).then(function(r){ return r.ok ? r.json() : null; })
      .then(function(d) {
        if (d && typeof d.visitors === 'number') {
          document.querySelectorAll('.live-visitor-count').forEach(function(el){
            el.textContent = d.visitors.toLocaleString();
          });
        }
      }).catch(function(){});
  }
  pingVisitors();
  setInterval(pingVisitors, 20000);

  /* ── Ticker ───────────────────────────────────────────────── */
  var tickerEl = document.getElementById('tickerScroll');
  if (tickerEl) {
    fetch('/api/news').then(function(r){ return r.ok ? r.json() : null; })
      .then(function(d) {
        if (!d) return;
        var items = (Array.isArray(d.items) ? d.items : []).slice(0, 12);
        if (!items.length) return;
        var html = items.map(function(item) {
          var src = String(item.sourceName || '').substr(0, 3).toUpperCase();
          var title = String(item.calmTitle || item.title || '');
          return '<div class="ticker-item">' +
            '<span class="ticker-badge">' + src + '</span>' +
            '<span class="ticker-text">' + title + '</span>' +
            '<span class="ticker-sep">◆</span>' +
            '</div>';
        }).join('');
        tickerEl.innerHTML = html + html; // duplicate for seamless loop
      }).catch(function(){});
  }

  /* ── Hamburger / mobile nav ───────────────────────────────── */
  var hBtn = document.getElementById('hamburgerBtn');
  var mNav = document.getElementById('mobileNav');
  if (hBtn && mNav) {
    hBtn.addEventListener('click', function () {
      var open = mNav.classList.toggle('open');
      hBtn.setAttribute('aria-expanded', open);
      mNav.setAttribute('aria-hidden', !open);
      hBtn.innerHTML = open ? '&#10005;' : '&#9776;';
    });
    document.addEventListener('click', function (e) {
      if (!hBtn.contains(e.target) && !mNav.contains(e.target)) {
        mNav.classList.remove('open');
        mNav.setAttribute('aria-hidden', 'true');
        hBtn.setAttribute('aria-expanded', 'false');
        hBtn.innerHTML = '&#9776;';
      }
    });
  }

  /* ── Language switcher ────────────────────────────────────── */
  var langBtn = document.getElementById('langBtn');
  var langDrop = document.getElementById('langDropdown');
  if (langBtn && langDrop) {
    langBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      langDrop.classList.toggle('open');
    });
    document.addEventListener('click', function () { langDrop.classList.remove('open'); });
    langDrop.querySelectorAll('.lang-option').forEach(function (opt) {
      opt.addEventListener('click', function () {
        langBtn.textContent = opt.textContent.trim() + ' ▾';
        langDrop.classList.remove('open');
      });
    });
  }

  /* ── Mobile language buttons ──────────────────────────────── */
  document.querySelectorAll('.mobile-lang-opt').forEach(function (btn) {
    btn.addEventListener('click', function () {
      // trigger Google Translate if available
      var frame = document.querySelector('.goog-te-combo');
      if (frame) { frame.value = btn.dataset.lang; frame.dispatchEvent(new Event('change')); }
    });
  });

  /* ── Notify / subscribe button ────────────────────────────── */
  var notifyBtn = document.getElementById('notifyBtn');
  if (notifyBtn) {
    notifyBtn.addEventListener('click', function () {
      window.location.href = '/#subscribe';
    });
  }

  /* ── Globe lang button (nav-lang-btn) ─────────────────────── */
  var navLangBtn = document.getElementById('navLangBtn');
  if (navLangBtn && langDrop) {
    navLangBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      langDrop.classList.toggle('open');
      // position near button
      var r = navLangBtn.getBoundingClientRect();
      langDrop.style.position = 'fixed';
      langDrop.style.top  = (r.bottom + 6) + 'px';
      langDrop.style.right = (window.innerWidth - r.right) + 'px';
    });
  }

}());
