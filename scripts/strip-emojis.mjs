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

// Match emoji unicode blocks including variation selectors and combiners
const emojiRegex = /(\p{Emoji_Presentation}|\p{Extended_Pictographic}|\uFE0F|\u20E3|\u200D)/gu;

for (const f of files) {
  try {
    const content = readFileSync(f, 'utf8');
    // ONLY remove emoji characters — do NOT touch whitespace or newlines
    const final = content.replace(emojiRegex, '');

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
