/**
 * Reverts name back to TheDubaiBrief everywhere,
 * but keeps logo boxes as D U B.
 */
import { readFileSync, writeFileSync } from 'fs';

const ALL_FILES = [
  'uae-calm-uae-news.html', 'archive.html', 'about.html', 'article-view.html',
  'article.html', 'contact.html', 'privacy.html', 'sources.html', 'status.html',
  'terms.html', 'unsubscribe.html', 'aboutpage.html',
  'server.js', 'src/news-cache.js', 'src/article-router.js', 'src/community.js',
];

for (const file of ALL_FILES) {
  try {
    let text = readFileSync(file, 'utf8');
    const orig = text;

    // Revert name (but NOT inside logo-box divs or splash-box divs)
    // Revert "DUB" back to "TheDubaiBrief" — but carefully skip logo/splash boxes
    // Strategy: protect logo-box and splash-box content first, then replace, then restore

    const LOGO_PLACEHOLDER  = '___LOGODUB___';
    const SPLASH_PLACEHOLDER = '___SPLASHDUB___';

    // Protect D U B inside logo/splash boxes
    text = text.replace(/>D<\/div>\s*\n?\s*<div class="(shared-logo-box|logo-box|cwn-logo-box)">U<\/div>\s*\n?\s*<div class="\1">B<\/div>/g,
      (m) => m); // these stay untouched — we only replace bare "DUB" text nodes

    // Protect splash boxes
    text = text.replace(/<div class="splash-box">D<\/div>[\s\S]*?<div class="splash-box">U<\/div>[\s\S]*?<div class="splash-box">B<\/div>/,
      (m) => m.replace(/DUB/g, SPLASH_PLACEHOLDER));

    // Now revert all remaining DUB → TheDubaiBrief
    // Title tags
    text = text.replace('<title>DUB — Dubai News</title>', '<title>TheDubaiBrief - UAE</title>');
    text = text.replace(/(<title>)DUB( —[^<]*<\/title>)/g, '$1TheDubaiBrief$2');
    text = text.replace(/(<title>)DUB(-[^<]*<\/title>)/g, '$1TheDubaiBrief$2');
    text = text.replace(/(<title>About — )DUB(<\/title>)/g, '$1TheDubaiBrief$2');

    // Tagline revert
    text = text.replaceAll("Dubai's News. Clear &amp; Calm.", 'UAE Official Sources');
    text = text.replaceAll("Dubai's News. Clear & Calm.", 'UAE Official Sources');

    // Splash name text
    text = text.replace(/<div class="splash-name">DUB<\/div>/, '<div class="splash-name">TheDubaiBrief</div>');

    // Logo text (the text next to the boxes)
    text = text.replace(/>DUB<\/div>\s*\n?\s*<div class="(logo-text-sub|shared-logo-sub|cwn-logo-sub|logo-text-main|shared-logo-main|cwn-logo-main)/g,
      '>TheDubaiBrief</div>\n              <div class="$1');

    // More targeted: replace DUB in logo-text-main / shared-logo-main divs
    text = text.replace(/(<div class="logo-text-main">)DUB(<\/div>)/, '$1TheDubaiBrief$2');
    text = text.replace(/(<div class="shared-logo-main">)DUB(<\/div>)/, '$1TheDubaiBrief$2');
    text = text.replace(/(<div class="cwn-logo-main">)DUB(<\/div>)/, '$1TheDubaiBrief$2');

    // meta description
    text = text.replace('DUB - calm', 'TheDubaiBrief - calm');
    text = text.replace('DUB — Dubai News', 'TheDubaiBrief - UAE');

    // Remaining bare "DUB" in text content, JS strings, email subjects
    // But NOT inside logo-box content (>D<, >U<, >B<)
    text = text.replaceAll('"DUB"', '"TheDubaiBrief"');
    text = text.replaceAll("'DUB'", "'TheDubaiBrief'");
    text = text.replaceAll('>DUB<', '>TheDubaiBrief<');
    text = text.replaceAll(' DUB ', ' TheDubaiBrief ');
    text = text.replaceAll(' DUB\n', ' TheDubaiBrief\n');
    text = text.replaceAll(' DUB.', ' TheDubaiBrief.');
    text = text.replaceAll('(DUB)', '(TheDubaiBrief)');
    text = text.replaceAll('DUB Morning', 'TheDubaiBrief Morning');
    text = text.replaceAll('DUB Evening', 'TheDubaiBrief Evening');
    text = text.replaceAll('DUB Weekly', 'TheDubaiBrief Weekly');
    text = text.replaceAll('Welcome to DUB', 'Welcome to TheDubaiBrief');
    text = text.replaceAll('unsubscribed from DUB', 'unsubscribed from TheDubaiBrief');
    text = text.replaceAll('&copy; 2026 DUB', '&copy; 2026 TheDubaiBrief');
    text = text.replaceAll('DUB &mdash;', 'TheDubaiBrief &mdash;');
    text = text.replaceAll('DUB ·', 'TheDubaiBrief ·');
    text = text.replaceAll('| DUB', '| TheDubaiBrief');
    text = text.replaceAll('// DUB', '// TheDubaiBrief');

    if (text !== orig) {
      writeFileSync(file, text, 'utf8');
      console.log(`${file}: reverted name to TheDubaiBrief (logo boxes stay D U B)`);
    } else {
      console.log(`${file}: no changes`);
    }
  } catch (e) {
    console.log(`${file}: ERROR — ${e.message}`);
  }
}
console.log('\nDone.');
