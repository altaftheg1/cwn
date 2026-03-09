const fs = require('fs');

const src = fs.readFileSync('uae-calm-uae-news.html', 'utf8');

const t1 = src.indexOf('<div class="utility-bar">');
const t2 = src.indexOf('<div class="main-content" id="news-feed">');
const headerHtml = src.substring(t1, t2).trim();

const css1 = src.indexOf('    :root{');
const css2 = src.indexOf('    /* ===== TOPIC FILTER PILLS ===== */');
const headerCss = src.substring(css1, css2).trim();

const js1 = src.indexOf('// ── Dark mode ─────────────────────────────────────────────────────────────');
const js2 = src.indexOf('// ── Load More button for news feed ────────────────────────────────────────');
const darkJs = src.substring(js1, js2).trim();

const utilClockLoc = src.indexOf('function updateUtilityClock() {');
// Wait, I don't know if `updateUtilityClock` is the exact name.
// Let's just output the variables to a file to inspect.
fs.writeFileSync('extracted-header.json', JSON.stringify({
  t1, t2, css1, css2, js1, js2, headerHtmlLength: headerHtml.length, headerCssLength: headerCss.length
}, null, 2));

