/**
 * Rebrand: TheDubaiBrief → DUB
 * - Name: TheDubaiBrief → DUB
 * - Logo letters: second B → U, third B → B (D U B)
 * - Tagline: "UAE Official Sources" → "Dubai's News. Clear & Calm."
 * - Splash name text: TheDubaiBrief → DUB
 * - Titles, footers, email subjects
 */
import { readFileSync, writeFileSync } from 'fs';
import { readdirSync, statSync } from 'fs';
import { join } from 'path';

// All files to process
const HTML_FILES = [
  'uae-calm-uae-news.html',
  'archive.html',
  'about.html',
  'article-view.html',
  'article.html',
  'contact.html',
  'privacy.html',
  'sources.html',
  'status.html',
  'terms.html',
  'unsubscribe.html',
  'aboutpage.html',
];
const JS_FILES = [
  'server.js',
  'src/news-cache.js',
  'src/article-router.js',
  'src/community.js',
];
const ALL_FILES = [...HTML_FILES, ...JS_FILES];

function process(file) {
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { return; }
  const orig = text;

  // 1. Name replacement (case-sensitive variants)
  text = text.replaceAll('TheDubaiBrief', 'DUB');
  text = text.replaceAll('thedubaiBrief', 'DUB');
  text = text.replaceAll('thedubaibriEF', 'DUB');

  // 2. Tagline
  text = text.replaceAll('UAE Official Sources', "Dubai's News. Clear &amp; Calm.");
  // plain & version (in JS strings)
  text = text.replaceAll("UAE Official Sources", "Dubai's News. Clear & Calm.");

  // 3. Logo letter boxes — replace the SECOND and THIRD box text only
  // Pattern: the three consecutive logo-box divs with letters
  // Handles both shared-logo-box and logo-box class names
  // Replace ">B</div>" after a ">D</div>" context carefully:
  // We look for the three-letter sequence pattern
  const logoPatterns = [
    // shared-logo-box pattern (secondary pages)
    [/<div class="shared-logo-box">D<\/div>\s*<div class="shared-logo-box">B<\/div>\s*<div class="shared-logo-box">B<\/div>/g,
     '<div class="shared-logo-box">D</div>\n          <div class="shared-logo-box">U</div>\n          <div class="shared-logo-box">B</div>'],
    // logo-box pattern (main page + article-view)
    [/<div class="logo-box">D<\/div>\s*<div class="logo-box">B<\/div>\s*<div class="logo-box">B<\/div>/g,
     '<div class="logo-box">D</div>\n              <div class="logo-box">U</div>\n              <div class="logo-box">B</div>'],
    // cwn-logo-box pattern
    [/<div class="cwn-logo-box">D<\/div>\s*<div class="cwn-logo-box">B<\/div>\s*<div class="cwn-logo-box">B<\/div>/g,
     '<div class="cwn-logo-box">D</div>\n          <div class="cwn-logo-box">U</div>\n          <div class="cwn-logo-box">B</div>'],
  ];
  for (const [re, replacement] of logoPatterns) {
    text = text.replace(re, replacement);
  }

  // 4. Splash screen boxes (main page only)
  text = text.replace(
    /<div class="splash-box">D<\/div>\s*<div class="splash-box">B<\/div>\s*<div class="splash-box">B<\/div>/g,
    '<div class="splash-box">D</div>\n      <div class="splash-box">U</div>\n      <div class="splash-box">B</div>'
  );

  // 5. Browser tab titles — update pattern "X — TheDubaiBrief" already handled by step 1
  // Also fix the main page title specifically
  text = text.replace('<title>DUB - UAE</title>', '<title>DUB — Dubai News</title>');
  text = text.replace('<title>Loading… — DUB</title>', '<title>DUB — Dubai News</title>');
  text = text.replace('<title>About DUB</title>', '<title>About — DUB</title>');

  // 6. Email subjects in server.js (emojis already stripped, so no flag emoji)
  text = text.replace('DUB Morning Digest', 'DUB Morning Digest');
  text = text.replace('DUB Evening Digest', 'DUB Evening Digest');
  text = text.replace('DUB Weekly Summary', 'DUB Weekly Summary');
  text = text.replace("Welcome to DUB", "Welcome to DUB");

  // 7. Meta descriptions
  text = text.replaceAll('TheDubaiBrief - calm', 'DUB - calm');
  text = text.replaceAll('TheDubaiBrief - UAE', 'DUB — Dubai News');

  if (text !== orig) {
    writeFileSync(file, text, 'utf8');
    const count = (orig.match(/TheDubaiBrief|UAE Official Sources/g) || []).length;
    console.log(`${file}: rebranded (${count} name occurrences + logo letters + tagline)`);
  } else {
    console.log(`${file}: no changes`);
  }
}

for (const f of ALL_FILES) {
  process(f);
}
console.log('\nDone.');
