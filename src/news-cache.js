import { fetchSourceArticles } from "./sources.js";
import { calmifyArticle } from "./tone.js";
import { normalizeArticle, stableId } from "./util.js";
import { load } from "cheerio";            // for parsing remote article pages
import fs from "fs";
import path from "path";

// path for caching Claude API responses
const CLAUDE_CACHE_FILE = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "claude-cache.json");
let claudeCache = {};
function loadClaudeCache() {
  try {
    claudeCache = JSON.parse(fs.readFileSync(CLAUDE_CACHE_FILE, "utf8"));
  } catch {
    claudeCache = {};
  }
}
function saveClaudeCache() {
  try {
    fs.writeFileSync(CLAUDE_CACHE_FILE, JSON.stringify(claudeCache, null, 2));
  } catch {}
}
loadClaudeCache();

// ─── All UAE News Sources ─────────────────────────────────────────────────────
// rssUrl   = RSS/Atom feed (tried first)
// scrapeUrl = HTML page to scrape (fallback)
// scrapeType = special scraper key (e.g. "uae" for UAE portal)
// category = display category for frontend filter pills
// tier     = priority (lower = higher priority for deduplication)

const ALL_SOURCES = [
  // TIER 1 — OFFICIAL GOVERNMENT (highest priority)
  {
    key: "wam", name: "Emirates News Agency (WAM)", tier: 1, category: "Government",
    rssUrl: "https://www.wam.ae/en/rss",
    scrapeUrl: "https://www.wam.ae/en/home/main",
  },
  {
    key: "uaegov", name: "UAE Government Portal", tier: 1, category: "Government",
    scrapeUrl: "https://u.ae/en/information-and-services/news",
    scrapeType: "uae",
  },
  {
    key: "dmo", name: "Dubai Media Office", tier: 1, category: "Government",
    rssUrl: "https://mediaoffice.ae/rss",
    scrapeUrl: "https://mediaoffice.ae/en/news/",
  },
  {
    key: "adgov", name: "Abu Dhabi Government", tier: 1, category: "Government",
    scrapeUrl: "https://www.abudhabi.ae/en/news",
  },
  {
    key: "shgov", name: "Sharjah Government", tier: 1, category: "Government",
    scrapeUrl: "https://www.sharjah.ae/en/news",
  },

  // TIER 2 — MAJOR NEWS OUTLETS
  {
    key: "gn", name: "Gulf News", tier: 2, category: "General News",
    rssUrl: "https://gulfnews.com/rss",
    scrapeUrl: "https://gulfnews.com/",
  },
  {
    key: "kt", name: "Khaleej Times", tier: 2, category: "General News",
    rssUrl: "https://khaleejtimes.com/rss",
    scrapeUrl: "https://www.khaleejtimes.com/",
  },
  {
    key: "nat", name: "The National", tier: 2, category: "General News",
    rssUrl: "https://www.thenationalnews.com/rss",
    scrapeUrl: "https://www.thenationalnews.com/",
  },
  {
    key: "e247", name: "Emirates 24/7", tier: 2, category: "General News",
    rssUrl: "https://www.emirates247.com/rss",
    scrapeUrl: "https://www.emirates247.com/",
  },
  {
    key: "arabnews", name: "Arab News UAE", tier: 2, category: "General News",
    rssUrl: "https://www.arabnews.com/rss/uae",
    scrapeUrl: "https://www.arabnews.com/node/uae",
  },
  {
    key: "gulfbiz", name: "Gulf Business", tier: 2, category: "Business",
    rssUrl: "https://gulfbusiness.com/feed/",
    scrapeUrl: "https://gulfbusiness.com/",
  },
  {
    key: "arabbiz", name: "Arabian Business", tier: 2, category: "Business",
    rssUrl: "https://www.arabianbusiness.com/rss",
    scrapeUrl: "https://www.arabianbusiness.com/",
  },

  // TIER 3 — BROADCAST & RADIO
  {
    key: "alarabiya", name: "Al Arabiya English", tier: 3, category: "Media",
    rssUrl: "https://english.alarabiya.net/tools/rss",
    scrapeUrl: "https://english.alarabiya.net/",
  },
  {
    key: "dubaieye", name: "Dubai Eye 103.8", tier: 3, category: "Media",
    rssUrl: "https://www.dubaieye1038.com/rss",
    scrapeUrl: "https://www.dubaieye1038.com/",
  },

  // TIER 4 — CITY & LIFESTYLE
  {
    key: "timeout", name: "Time Out Dubai", tier: 4, category: "Lifestyle",
    rssUrl: "https://www.timeoutdubai.com/rss",
    scrapeUrl: "https://www.timeoutdubai.com/",
  },
  {
    key: "whatson", name: "What's On Dubai", tier: 4, category: "Lifestyle",
    rssUrl: "https://whatson.ae/rss",
    scrapeUrl: "https://whatson.ae/",
  },
  {
    key: "visitdubai", name: "Visit Dubai", tier: 4, category: "Lifestyle",
    scrapeUrl: "https://www.visitdubai.com/en/whats-on",
  },

  // TIER 5 — SAFETY & EMERGENCY
  {
    key: "dubaipolice", name: "Dubai Police", tier: 5, category: "Safety",
    scrapeUrl: "https://www.dubaipolice.gov.ae/wps/portal/home/news",
  },
  {
    key: "adpolice", name: "Abu Dhabi Police", tier: 5, category: "Safety",
    scrapeUrl: "https://www.adpolice.gov.ae/en/news",
  },
  {
    key: "rta", name: "RTA Dubai", tier: 5, category: "Safety",
    scrapeUrl: "https://www.rta.ae/wps/portal/rta/ae/news-events",
  },
  {
    key: "dcda", name: "Dubai Civil Defence", tier: 5, category: "Safety",
    scrapeUrl: "https://www.dcda.gov.ae/en/news",
  },

  // TIER 6 — BUSINESS & FINANCE
  {
    key: "dubaichamber", name: "Dubai Chamber", tier: 6, category: "Business",
    scrapeUrl: "https://www.dubaichamber.com/en/news/",
  },
  {
    key: "adgm", name: "ADGM", tier: 6, category: "Business",
    scrapeUrl: "https://www.adgm.com/news",
  },
  {
    key: "dfm", name: "Dubai Financial Market", tier: 6, category: "Business",
    scrapeUrl: "https://www.dfm.ae/news",
  },
  {
    key: "difc", name: "DIFC", tier: 6, category: "Business",
    scrapeUrl: "https://www.difc.ae/newsroom/",
  },

  // TIER 7 — HEALTH & EDUCATION
  {
    key: "mohap", name: "UAE Ministry of Health", tier: 7, category: "Health & Education",
    scrapeUrl: "https://www.mohap.gov.ae/en/media-centre/news",
  },
  {
    key: "dha", name: "Dubai Health Authority", tier: 7, category: "Health & Education",
    scrapeUrl: "https://www.dha.gov.ae/en/news",
  },
  {
    key: "khda", name: "KHDA", tier: 7, category: "Health & Education",
    scrapeUrl: "https://www.khda.gov.ae/en/news",
  },
  {
    key: "uaemoe", name: "UAE Ministry of Education", tier: 7, category: "Health & Education",
    scrapeUrl: "https://www.moe.gov.ae/en/mediaCenter/News",
  },
];

// Source status tracking (updated on each build)
const sourceStatus = new Map(); // key -> { ok: bool, lastCheck: Date, error?: string, articleCount: number }

export function getSourceStatus() {
  const result = {};
  for (const s of ALL_SOURCES) {
    const st = sourceStatus.get(s.key) || { ok: false, lastCheck: null, error: "Not yet checked", articleCount: 0 };
    result[s.key] = { name: s.name, tier: s.tier, category: s.category, ...st };
  }
  return result;
}

// ─── Claude rewrite ───────────────────────────────────────────────────────────

async function rewriteArticle(article) {
  const key = article.url;
  if (claudeCache[key]) return claudeCache[key];
  if (!process.env.CLAUDE_API_KEY) return null;
  console.log('Processing article with Claude API:', article.title);
  const systemPrompt = `You are the friendly editor of Central Watch News, a UAE news service for everyday residents, families, and expats. Your job is to rewrite news so that anyone — a child, a grandparent, someone who just moved to the UAE — can read it and immediately understand what happened and whether it affects them.

Rules you must always follow:
- Use simple everyday words only. If a word has a simpler version, always use the simpler one.
- Maximum reading age: 12 years old
- Never use these words: crisis, blast, fatal, surge, threatens, explodes, warns, fears, alarming, shock, urgent, deadly, militant, liquidity, volatility, geopolitical, escalation, evacuation, outbreak
- Replace scary words with calm ones:
  explosion → incident
  fatal → serious
  warning → reminder
  crisis → situation
  urgent → important
  outbreak → increase in cases
  threatens → may affect
- Write the headline like you are texting a friend good information, not breaking scary news
- Write the summary like you are explaining to a family member what happened over dinner
- Always end the resident_impact with something actionable and reassuring if possible

Return ONLY this JSON, nothing else:
{
  "calm_headline": "max 12 words, simple, calm, friendly",
  "summary": "2 sentences. Simple words. What happened and why it matters to people living in UAE. No jargon. Anyone can understand this.",
  "resident_impact": "1 sentence starting with For residents: telling them what to do or not worry about. Return null if no direct impact."
}`;
  const userMessage = `Headline: ${article.title}\nSource: ${article.sourceName}\nText: ${String(article.description || "").slice(0, 300)}`;
  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.CLAUDE_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 500,
        messages: [
          { role: "user", content: systemPrompt + "\n\n" + userMessage }
        ],
      }),
    });
    if (!resp.ok) {
      let errText = '';
      try { errText = await resp.text(); } catch {}
      throw new Error(`Claude HTTP ${resp.status} ${errText}`);
    }
    const data = await resp.json();
    let text = data.content?.[0]?.text || "";
    let obj = null;
    try { obj = JSON.parse(text); } catch {}
    if (obj && obj.calm_headline) {
      claudeCache[key] = obj;
      saveClaudeCache();
      console.log('✓ Rewrite cached for:', article.title);
      return obj;
    }
  } catch (err) {
    console.error("Rewrite error for", key, err.message);
  }
  claudeCache[key] = null;
  saveClaudeCache();
  console.log('✗ Rewrite failed for:', article.title);
  return null;
}

// ─── Image fetching ───────────────────────────────────────────────────────────

async function fetchOgImage(url) {
  try {
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 3000);
    try {
      const r = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: abortController.signal,
      });
      clearTimeout(timeoutId);
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
        if (img) return img;
      }
      return null;
    } catch (e) {
      clearTimeout(timeoutId);
      return null;
    }
  } catch {}
  return null;
}

async function fetchAllImages(items) {
  await Promise.all(items.map(async (item) => {
    if (item.imageUrl && item.imageUrl !== item.url) return;
    if (!item.imageUrl) {
      try {
        const img = await fetchOgImage(item.url);
        if (img) item.imageUrl = img;
      } catch {}
    }
  }));
  return items;
}

// ─── Title-based deduplication ────────────────────────────────────────────────

const STOP_WORDS = new Set([
  "a","an","the","and","or","but","in","on","at","to","for","of","with",
  "is","are","was","were","be","been","has","have","had","will","would",
  "can","could","may","might","shall","should","that","this","it","its",
  "as","by","from","up","about","into","than","so","do","not","no","new",
  "uae","dubai","abu","dhabi","sharjah","emirates","says","said","after",
]);

function titleKeywords(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

function jaccardSimilarity(setA, setB) {
  if (!setA.size || !setB.size) return 0;
  let intersection = 0;
  for (const w of setA) {
    if (setB.has(w)) intersection++;
  }
  return intersection / (setA.size + setB.size - intersection);
}

// Deduplicates articles across sources.
// Returns array where each item optionally has `alsoReportedBy: string[]`.
// Priority: lower tier number = preferred primary source.
function deduplicateArticles(articles) {
  // Sort by tier so government sources come first (they become the primary when deduped)
  const sorted = [...articles].sort((a, b) => {
    const ta = a.tier || 99;
    const tb = b.tier || 99;
    if (ta !== tb) return ta - tb;
    return (b.publishedAtMs || 0) - (a.publishedAtMs || 0);
  });

  const kept = [];
  const usedIndices = new Set();

  for (let i = 0; i < sorted.length; i++) {
    if (usedIndices.has(i)) continue;

    const primary = sorted[i];
    const primaryWords = new Set(titleKeywords(primary.title || ""));
    const alsoReportedBy = [];

    for (let j = i + 1; j < sorted.length; j++) {
      if (usedIndices.has(j)) continue;
      const candidate = sorted[j];

      // Same URL = exact duplicate — just mark used
      if (candidate.url === primary.url) {
        usedIndices.add(j);
        continue;
      }

      // Title similarity check
      const candidateWords = new Set(titleKeywords(candidate.title || ""));
      const sim = jaccardSimilarity(primaryWords, candidateWords);
      if (sim >= 0.5) {
        usedIndices.add(j);
        // Only show "also reported by" for major/gov sources (not lifestyle/health)
        if (candidate.sourceName && candidate.tier <= 3) {
          alsoReportedBy.push(candidate.sourceName);
        }
      }
    }

    kept.push({
      ...primary,
      alsoReportedBy: alsoReportedBy.length > 0 ? alsoReportedBy : undefined,
    });
    usedIndices.add(i);
  }

  return kept;
}

// ─── Cache plumbing ───────────────────────────────────────────────────────────

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes (matches user request)
const SOURCE_CACHE_TTL_MS = 5 * 60 * 1000;

let cache = null;
let sourceCache = null;
let sourceCacheGeneratedAt = 0;
let lastBuildStartedAt = 0;
let buildInFlight = null;

export function getCachedNews() {
  return cache;
}

export function getCachedArticleById(id) {
  if (!cache) return null;
  return cache.items.find((x) => x.id === id) || null;
}

function isStale() {
  if (!cache) return true;
  return Date.now() - cache.generatedAtMs > CACHE_TTL_MS;
}

function isSourceCacheStale() {
  return Date.now() - sourceCacheGeneratedAt > SOURCE_CACHE_TTL_MS;
}

async function processConcurrently(items, maxConcurrent, processor) {
  const results = new Array(items.length);
  let currentIndex = 0;
  const worker = async () => {
    while (currentIndex < items.length) {
      const index = currentIndex++;
      results[index] = await processor(items[index]);
    }
  };
  const workers = Array(Math.min(maxConcurrent, items.length)).fill(null).map(() => worker());
  await Promise.all(workers);
  return results;
}

// ─── Build ────────────────────────────────────────────────────────────────────

async function performBuild() {
  // Use cached raw results if fresh
  let rawSourceResults = null;
  if (sourceCache && !isSourceCacheStale()) {
    rawSourceResults = sourceCache;
  } else {
    console.log(`[news-cache] Fetching from ${ALL_SOURCES.length} sources...`);

    // Fetch all sources in parallel, each with its own error boundary
    const results = await Promise.allSettled(
      ALL_SOURCES.map(async (s) => {
        const before = Date.now();
        try {
          const raw = await fetchSourceArticles(s);
          const elapsed = Date.now() - before;
          sourceStatus.set(s.key, {
            ok: true,
            lastCheck: new Date(),
            articleCount: raw.length,
            elapsed,
          });
          return { source: s, raw };
        } catch (err) {
          sourceStatus.set(s.key, {
            ok: false,
            lastCheck: new Date(),
            articleCount: 0,
            error: err.message,
          });
          throw err;
        }
      })
    );

    rawSourceResults = results;
    sourceCache = results;
    sourceCacheGeneratedAt = Date.now();

    // Log summary
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const fail = results.filter((r) => r.status !== "fulfilled").length;
    console.log(`[news-cache] Sources: ${ok} OK, ${fail} failed`);
  }

  const collected = [];
  const prevMap = cache && cache.items ? new Map(cache.items.map((i) => [i.url, i])) : new Map();

  for (const r of rawSourceResults) {
    if (r.status !== "fulfilled") {
      // Update status for failed sources that weren't caught inside fetchSourceArticles
      if (r.reason) {
        const errMsg = String(r.reason.message || r.reason);
        // Find source by matching error to known sources — best-effort
        console.warn("[news-cache] source failed:", errMsg);
      }
      continue;
    }

    const { source, raw } = r.value;
    if (!raw || raw.length === 0) continue;

    for (const a of raw) {
      let normalized = normalizeArticle({
        ...a,
        sourceKey: source.key,
        sourceName: source.name,
        sourceType: source.tier <= 1 ? "official" : "newsroom",
        category: source.category,
        tier: source.tier,
      });
      if (!normalized.url) continue;
      normalized.id = stableId(normalized);

      // Carry forward cached metadata to avoid re-fetching
      if (prevMap.has(normalized.url)) {
        const old = prevMap.get(normalized.url);
        if (old.imageUrl && !normalized.imageUrl) normalized.imageUrl = old.imageUrl;
        if (old.calmTitle) normalized.calmTitle = old.calmTitle;
        if (old.calmSummary) normalized.calmSummary = old.calmSummary;
        if (old.residentImpact) normalized.residentImpact = old.residentImpact;
        if (old.rewriteFailed) normalized.rewriteFailed = old.rewriteFailed;
      }
      collected.push(normalized);
    }
  }

  // Step 1: URL-level deduplication (identical URLs from multiple fetches)
  const byUrl = new Map();
  for (const a of collected) {
    if (!byUrl.has(a.url)) byUrl.set(a.url, a);
  }
  const urlUnique = Array.from(byUrl.values()).map((a) => calmifyArticle(a));

  // Step 2: Title-similarity deduplication across sources
  const deduped = deduplicateArticles(urlUnique);

  // Fetch images in parallel
  await fetchAllImages(deduped);

  // Rewrite with Claude (max 3 concurrent)
  await processConcurrently(deduped, 3, async (item) => {
    const rew = await rewriteArticle(item);
    if (rew) {
      item.calmTitle = rew.calm_headline || item.calmTitle;
      item.calmSummary = rew.summary || item.calmSummary;
      item.residentImpact = rew.resident_impact;
    } else {
      item.rewriteFailed = true;
    }
  });

  // Sort: newest first, gov sources boosted slightly
  deduped.sort((a, b) => {
    const ta = a.publishedAtMs || 0;
    const tb = b.publishedAtMs || 0;
    // Gov tier articles get a 30-minute boost for freshness ranking
    const boostA = (a.tier || 99) <= 1 ? 30 * 60 * 1000 : 0;
    const boostB = (b.tier || 99) <= 1 ? 30 * 60 * 1000 : 0;
    return (tb + boostB) - (ta + boostA);
  });

  const payload = {
    generatedAtMs: Date.now(),
    items: deduped.slice(0, 80),
    sourceStatus: Object.fromEntries(sourceStatus),
  };

  cache = payload;
  buildInFlight = null;
  return cache;
}

export function startBackgroundBuild() {
  const now = Date.now();
  if (buildInFlight) return;
  if (now - lastBuildStartedAt < 5000) return;
  lastBuildStartedAt = now;
  buildInFlight = performBuild();
  buildInFlight.catch(() => {});
}

export async function buildNewsCache({ force }) {
  const now = Date.now();

  if (!force && cache && !isStale()) {
    startBackgroundBuild();
    return cache;
  }

  const now2 = Date.now();
  if (buildInFlight) {
    try {
      return await buildInFlight;
    } finally {
      buildInFlight = null;
    }
  }

  lastBuildStartedAt = now2;
  buildInFlight = performBuild();

  try {
    return await buildInFlight;
  } finally {
    buildInFlight = null;
  }
}
