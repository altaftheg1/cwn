import { buildNewsCache } from './src/news-cache.js';
import { load } from 'cheerio';

// replicate fetchOgImage helper for debugging
async function fetchOgImage(url) {
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, timeout: 10000 });
    if (!r.ok) return null;
    const html = await r.text();
    const $ = load(html);
    let img = $("meta[property='og:image']").attr("content") || $("meta[name='twitter:image']").attr("content") || "";
    if (!img) {
      const candidate = $("article img, .article img, .main img, .content img").first().attr("src") || "";
      img = candidate;
    }
    if (img) {
      try { img = new URL(img, url).toString(); } catch {}
      if (img) {
        try {
          const h = await fetch(img, { method: "HEAD", timeout: 10000 });
          if (h.ok) return img;
          const h2 = await fetch(img, { method: "GET", headers: { "Range": "bytes=0-0" }, timeout: 10000 });
          if (h2.ok) return img;
        } catch {}
      }
    }
  } catch {}
  return null;
}

(async () => {
  const url = 'https://www.emirates247.com/uae/uae-extends-distance-learning-until-friday-march-6-2026-2026-03-03-1.744502';
  console.log('fetchOgImage for article:', url);
  const og = await fetchOgImage(url);
  console.log('fetchOgImage returned', og);

  const n = await buildNewsCache({ force: true });
  const it = n.items.find(i => i.url && i.url.includes('distance-learning-until-friday'));
  console.log('cached item', it);
})();
