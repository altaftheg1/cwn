import { readFileSync, writeFileSync } from 'fs';

const files = [
  'uae-calm-uae-news.html',
  'archive.html',
  'about.html',
  'article-view.html',
  'privacy.html',
  'terms.html',
  'contact.html',
  'sources.html',
  'unsubscribe.html',
  'status.html',
  'article.html',
];

// Match all emoji unicode blocks including variation selectors and flags
const emojiRegex = /(\p{Emoji_Presentation}|\p{Extended_Pictographic}|\uFE0F|\u20E3|\u200D)/gu;

for (const f of files) {
  try {
    const content = readFileSync(f, 'utf8');
    const cleaned = content
      .replace(emojiRegex, '')   // strip emojis
      .replace(/ {2,}/g, ' ')   // collapse multiple spaces left behind
      .replace(/> /g, '>');     // remove leading space inside >text (e.g. "> Safety" → ">Safety") -- skip, preserve spacing

    // Restore single space that was between emoji and text
    const final = content.replace(emojiRegex, '').replace(/\s{2,}(?=\S)/g, ' ');

    if (final !== content) {
      writeFileSync(f, final, 'utf8');
      const removed = (content.match(emojiRegex) || []).length;
      console.log(`${f}: removed ${removed} emoji chars`);
    } else {
      console.log(`${f}: no emojis found`);
    }
  } catch (e) {
    console.log(`${f}: ERROR — ${e.message}`);
  }
}
