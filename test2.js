import { load } from 'cheerio';
// node 18+ provides global fetch


(async()=>{
  const url = 'https://www.emirates247.com/uae/uae-extends-distance-learning-until-friday-march-6-2026-2026-03-03-1.744502';
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const html = await r.text();
  const $ = load(html);
  let img = $("meta[property='og:image']").attr('content') || $("meta[name='twitter:image']").attr('content') || '';
  console.log('meta og:image', img);
  if (!img) {
    const cand = $("article img, .article img, .main img, .content img").first().attr('src') || '';
    console.log('candidate', cand);
    img = cand;
  }
  try { img = new URL(img, url).toString(); } catch {}
  console.log('final', img);
})();
