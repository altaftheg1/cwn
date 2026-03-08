/**
 * Updates all secondary pages to use the same header structure as the main page.
 * Replaces each page's existing utility bar + header with the shared one.
 */
import { readFileSync, writeFileSync } from 'fs';

// ── Shared header CSS ────────────────────────────────────────────────────────
const SHARED_HEADER_CSS = `
    /* ===== SHARED HEADER (matches main page) ===== */
    :root{
      --red:#C8102E; --red-dark:#9B0B22; --red-light:#f5e5e8;
      --cream:#F7F4EF; --ink:#1A1208; --ink-mid:#3D3328;
      --ink-light:#7A6E62; --border:#DDD8CF; --gold:#B8860B;
      --radius-lg:8px; --radius-md:6px;
      --shadow-soft:0 2px 8px rgba(0,0,0,0.08);
      --max-width:1320px;
    }
    html.dark{ background:#0A0A0A; color:#F0F0F0; }
    *, *::before, *::after{ box-sizing:border-box; }
    html{ overflow-x:hidden; }
    body{ font-family:'DM Sans',sans-serif; -webkit-font-smoothing:antialiased; overflow-x:hidden; }

    /* Utility bar */
    .shared-utility-bar{
      background:var(--red-dark);
      color:#fff;
      padding:6px 24px;
      font-size:12px;
      display:flex;
      justify-content:space-between;
      align-items:center;
      border-bottom:1px solid rgba(0,0,0,0.15);
    }
    .shared-util-left{ display:flex; gap:20px; align-items:center; }
    .shared-util-left span{ display:flex; align-items:center; gap:6px; }
    .shared-util-clock{ font-family:'Source Serif 4',serif; font-weight:600; }
    .shared-util-right{ display:flex; gap:20px; align-items:center; }
    .shared-util-right a{ color:#fff; text-decoration:none; transition:color .2s; font-size:12px; }
    .shared-util-right a:hover{ color:var(--gold); }
    .shared-live-visitors{ display:flex; align-items:center; gap:6px; font-size:12px; color:rgba(255,255,255,0.85); }
    .shared-live-dot{ width:7px; height:7px; border-radius:50%; background:#4ade80; flex-shrink:0; animation:sharedLvPulse 2s ease-in-out infinite; }
    @keyframes sharedLvPulse{ 0%,100%{box-shadow:0 0 0 0 rgba(74,222,128,0.7);}50%{box-shadow:0 0 0 4px rgba(74,222,128,0);} }

    /* Main header */
    .shared-header{
      position:sticky; top:0; z-index:100;
      background:var(--red);
      border-bottom:1px solid rgba(0,0,0,0.15);
      color:#fff;
    }
    .shared-header-inner{
      max-width:var(--max-width); margin:0 auto;
      padding:0 24px; height:64px;
      display:flex; align-items:center; justify-content:space-between;
    }
    .shared-brand{ display:flex; align-items:center; gap:12px; text-decoration:none; }
    .shared-logo-boxes{ display:flex; gap:8px; }
    .shared-logo-box{
      width:42px; height:42px; border-radius:6px;
      background:var(--red); border:2px solid #fff;
      display:flex; align-items:center; justify-content:center;
      font-family:'Playfair Display',serif; font-size:18px; font-weight:900;
      color:#fff; text-shadow:0 0 2px #000;
    }
    .shared-logo-text{ display:flex; flex-direction:column; gap:2px; }
    .shared-logo-main{ font-family:'Source Serif 4',serif; font-size:13px; font-weight:600; color:#fff; line-height:1; }
    .shared-logo-sub{ font-family:'DM Sans',sans-serif; font-size:10px; opacity:.9; color:#fff; line-height:1; }
    .shared-header-right{ display:flex; align-items:center; gap:8px; }
    .shared-dark-toggle{
      background:none; border:1px solid rgba(255,255,255,0.4); color:#fff;
      padding:5px 9px; border-radius:4px; font-size:16px; cursor:pointer;
      line-height:1; min-width:34px; min-height:34px;
      display:flex; align-items:center; justify-content:center; transition:border-color .2s;
    }
    .shared-dark-toggle:hover{ border-color:rgba(255,255,255,0.9); }

    /* Dark mode */
    html.dark .shared-utility-bar{ background:var(--red-dark); }
    html.dark .shared-header{ background:var(--red); border-bottom-color:rgba(0,0,0,0.3); }

    /* Responsive */
    @media(max-width:768px){
      .shared-utility-bar{ display:none; }
      .shared-header-inner{ padding:0 16px; height:56px; }
      .shared-logo-box{ width:36px; height:36px; font-size:15px; }
      .shared-logo-main{ font-size:12px; }
    }
`;

// ── Shared header HTML (parameterised by active page) ────────────────────────
function makeHeaderHTML(activeLink) {
  return `
  <!-- Early theme: prevents flash -->
  <script>
    (function(){
      if(localStorage.getItem('theme')==='dark'){
        document.documentElement.classList.add('dark');
        document.addEventListener('DOMContentLoaded',function(){
          document.body&&document.body.classList.add('dark');
        });
      }
    })();
  </script>
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=Source+Serif+4:wght@400;600&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">

  <!-- Utility Bar -->
  <div class="shared-utility-bar">
    <div class="shared-util-left">
      <span><span class="shared-util-clock" id="sharedClock">00:00 GST</span></span>
      <span id="sharedDate">Loading...</span>
      <span>Dubai, UAE</span>
      <span class="shared-live-visitors" id="sharedLiveVisitors" title="People viewing TheDubaiBrief right now">
        <span class="shared-live-dot"></span>
        <span id="sharedVisitorCount">–</span> online
      </span>
    </div>
    <div class="shared-util-right">
      <a href="/about.html"${activeLink==='about'?' style="color:var(--gold)"':''}>About</a>
      <a href="/sources.html"${activeLink==='sources'?' style="color:var(--gold)"':''}>Sources</a>
      <a href="/contact.html"${activeLink==='contact'?' style="color:var(--gold)"':''}>Contact</a>
    </div>
  </div>

  <!-- Main Header -->
  <header class="shared-header">
    <div class="shared-header-inner">
      <a class="shared-brand" href="/uae-calm-uae-news.html">
        <div class="shared-logo-boxes">
          <div class="shared-logo-box">D</div>
          <div class="shared-logo-box">B</div>
          <div class="shared-logo-box">B</div>
        </div>
        <div class="shared-logo-text">
          <div class="shared-logo-main">TheDubaiBrief</div>
          <div class="shared-logo-sub">UAE Official Sources</div>
        </div>
      </a>
      <div class="shared-header-right">
        <button class="shared-dark-toggle" id="darkToggle" title="Toggle dark mode"></button>
      </div>
    </div>
  </header>

  <!-- Shared header JS: clock, date, live count, dark toggle -->
  <script>
    (function(){
      'use strict';
      // Clock
      function updateClock(){
        var now=new Date();
        var h=String(now.getHours()).padStart(2,'0');
        var m=String(now.getMinutes()).padStart(2,'0');
        var el=document.getElementById('sharedClock');
        if(el) el.textContent=h+':'+m+' GST';
      }
      updateClock();
      setInterval(updateClock,1000);

      // Date
      function updateDate(){
        var now=new Date();
        var el=document.getElementById('sharedDate');
        if(el) el.textContent=now.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
      }
      updateDate();

      // Live visitor count
      var sid=sessionStorage.getItem('cwn-sid');
      if(!sid){
        sid='v'+Date.now().toString(36)+Math.random().toString(36).slice(2,8);
        sessionStorage.setItem('cwn-sid',sid);
      }
      function pingVisitors(){
        fetch('/api/ping',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sid:sid})})
          .then(function(r){return r.ok?r.json():null;})
          .then(function(d){
            var el=document.getElementById('sharedVisitorCount');
            if(el&&d&&typeof d.visitors==='number') el.textContent=d.visitors.toLocaleString();
          }).catch(function(){});
      }
      pingVisitors();
      setInterval(pingVisitors,20000);

      // Dark toggle
      var toggle=document.getElementById('darkToggle');
      if(toggle){
        var isDark=document.documentElement.classList.contains('dark');
        toggle.textContent=isDark?'☀':'☾';
        toggle.addEventListener('click',function(){
          var dark=!document.documentElement.classList.contains('dark');
          document.documentElement.classList.toggle('dark',dark);
          document.body&&document.body.classList.toggle('dark',dark);
          localStorage.setItem('theme',dark?'dark':'light');
          toggle.textContent=dark?'☀':'☾';
        });
      }
    })();
  </script>
`;
}

// ── Pages to update ──────────────────────────────────────────────────────────
const pages = [
  { file: 'archive.html',     active: '' },
  { file: 'about.html',       active: 'about' },
  { file: 'contact.html',     active: 'contact' },
  { file: 'privacy.html',     active: '' },
  { file: 'terms.html',       active: '' },
  { file: 'sources.html',     active: 'sources' },
  { file: 'unsubscribe.html', active: '' },
  { file: 'status.html',      active: '' },
  { file: 'article.html',     active: '' },
];

for (const { file, active } of pages) {
  try {
    let html = readFileSync(file, 'utf8');
    const original = html;

    // 1. Inject shared CSS into the first <style> block (before </style>)
    // Remove any existing shared-header CSS block first to prevent duplicates
    html = html.replace(/\/\* ={5} SHARED HEADER[\s\S]*?(?=<\/style>)/, '');
    html = html.replace(/<style>/, `<style>\n${SHARED_HEADER_CSS}\n`);

    // 2. Remove old utility bar variants
    // cwn-utility-bar
    html = html.replace(/<div class="cwn-utility-bar"[\s\S]*?<\/div>\s*\n?/, '');
    // shared-utility-bar (old version – will be re-inserted below)
    html = html.replace(/\s*<!-- Utility Bar -->\s*<div class="shared-utility-bar"[\s\S]*?<\/div>\s*\n?/, '');

    // 3. Remove old header variants and replace with shared one
    // Pattern: cwn-header
    const cwnHeaderRe = /<header class="cwn-header"[\s\S]*?<\/header>/;
    // Pattern: simple <header> (used by archive)
    const simpleHeaderRe = /<header>\s*[\s\S]*?<\/header>/;
    // Pattern: shared-header (already updated)
    const sharedHeaderRe = /<header class="shared-header"[\s\S]*?<\/header>/;
    // Pattern: old cwn-ticker (only on about/contact)
    const cwnTickerRe = /<div class="cwn-ticker"[\s\S]*?<\/div>\s*\n?/;

    // Remove early theme + font scripts if they already exist (we'll re-inject)
    html = html.replace(/\s*<!-- Early theme[^>]*-->\s*<script>[\s\S]*?<\/script>\s*\n?/g, '');
    html = html.replace(/\s*<script>\s*\(function\(\)\{[\s\S]*?localStorage\.getItem\('theme'\)[\s\S]*?\}\)\(\);?\s*<\/script>\s*\n?/g, '');
    // Remove shared header JS
    html = html.replace(/\s*<!-- Shared header JS[\s\S]*?<\/script>\s*\n?/, '');
    // Remove old font link if present (we'll add fresh one)
    html = html.replace(/<link[^>]*fonts\.googleapis\.com[^>]*>\s*\n?/g, '');

    // Remove old cwn-ticker
    html = html.replace(cwnTickerRe, '');

    const newHeader = makeHeaderHTML(active);

    if (cwnHeaderRe.test(html)) {
      html = html.replace(cwnHeaderRe, newHeader);
    } else if (sharedHeaderRe.test(html)) {
      html = html.replace(sharedHeaderRe, newHeader);
    } else if (simpleHeaderRe.test(html)) {
      html = html.replace(simpleHeaderRe, newHeader);
    } else {
      // Fallback: insert after <body>
      html = html.replace(/<body[^>]*>/, (m) => m + '\n' + newHeader);
    }

    if (html !== original) {
      writeFileSync(file, html, 'utf8');
      console.log(`${file}: updated`);
    } else {
      console.log(`${file}: no changes`);
    }
  } catch (e) {
    console.log(`${file}: ERROR — ${e.message}`);
  }
}
