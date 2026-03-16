import { fetchSourceArticles } from "./sources.js";
import { calmifyArticle } from "./tone.js";
import { normalizeArticle, stableId } from "./util.js";
import { load } from "cheerio";            // for parsing remote article pages
import { createClient } from "@supabase/supabase-js";

// ─── Supabase client (replaces claude-cache.json) ────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL || "https://placeholder.supabase.co",
  process.env.SUPABASE_KEY || "placeholder"
);

function supabaseReady() {
  return process.env.SUPABASE_URL && process.env.SUPABASE_URL !== "https://placeholder.supabase.co";
}

// ─── All UAE News Sources ─────────────────────────────────────────────────────
// rssUrl   = RSS/Atom feed (tried first)
// scrapeUrl = HTML page to scrape (fallback)
// scrapeType = special scraper key (e.g. "uae" for UAE portal)
// category = display category for frontend filter pills
// tier     = priority (lower = higher priority for deduplication)

// Google News RSS helper — returns verified working feed URL for any domain
function gnRss(site, extra) {
  return `https://news.google.com/rss/search?q=site:${site}${extra ? "+" + encodeURIComponent(extra) : ""}&hl=en-US&gl=US&ceid=US:en`;
}

const ALL_SOURCES = [
  // TIER 1 — OFFICIAL GOVERNMENT (highest priority)
  {
    key: "wam", name: "Emirates News Agency (WAM)", tier: 1, category: "Government", isGovSource: true,
    rssUrl: "https://wam.ae/page/en/rss",
    scrapeUrl: "https://www.wam.ae/en/home/main",
  },
  {
    key: "uaegov", name: "UAE Government Portal", tier: 1, category: "Government", isGovSource: true,
    rssUrl: gnRss("u.ae", "UAE government news"),
    scrapeUrl: "https://u.ae/en/information-and-services/news",
    scrapeType: "uae",
  },
  {
    key: "dmo", name: "Dubai Media Office", tier: 1, category: "Government", isGovSource: true,
    rssUrl: "https://mediaoffice.ae/rss",
    scrapeUrl: "https://mediaoffice.ae/en/news/",
  },
  {
    key: "uaecabinet", name: "UAE Cabinet", tier: 1, category: "Government", isGovSource: true,
    rssUrl: gnRss("uaecabinet.ae"),
    scrapeUrl: "https://uaecabinet.ae/en/news",
  },
  {
    key: "adgov", name: "Abu Dhabi Government", tier: 1, category: "Government", isGovSource: true,
    rssUrl: gnRss("abudhabi.ae"),
    scrapeUrl: "https://www.abudhabi.ae/en/news",
  },
  {
    key: "shgov", name: "Sharjah Government", tier: 1, category: "Government", isGovSource: true,
    rssUrl: gnRss("sharjah.ae"),
    scrapeUrl: "https://www.sharjah.ae/en/news",
  },

  // TIER 2 — MAJOR NEWS OUTLETS
  {
    key: "gn", name: "Gulf News", tier: 2, category: "General News",
    rssUrl: gnRss("gulfnews.com", "UAE"),
    scrapeUrl: "https://gulfnews.com/uae",
  },
  {
    key: "kt", name: "Khaleej Times", tier: 2, category: "General News",
    rssUrl: gnRss("khaleejtimes.com"),
    scrapeUrl: "https://www.khaleejtimes.com/uae",
  },
  {
    key: "nat", name: "The National", tier: 2, category: "General News",
    rssUrl: "https://www.thenationalnews.com/arc/outboundfeeds/rss/?outputType=xml",
    scrapeUrl: "https://www.thenationalnews.com/",
  },
  {
    key: "e247", name: "Emirates 24/7", tier: 2, category: "General News",
    rssUrl: gnRss("emirates247.com"),
    scrapeUrl: "https://www.emirates247.com/",
  },
  {
    key: "arabnews", name: "Arab News UAE", tier: 2, category: "General News",
    rssUrl: gnRss("arabnews.com", "UAE"),
    scrapeUrl: "https://www.arabnews.com/node/uae",
  },
  {
    key: "gulfbiz", name: "Gulf Business", tier: 2, category: "Business",
    rssUrl: "https://gulfbusiness.com/feed/",
    scrapeUrl: "https://gulfbusiness.com/",
  },
  {
    key: "arabbiz", name: "Arabian Business", tier: 2, category: "Business",
    rssUrl: gnRss("arabianbusiness.com"),
    scrapeUrl: "https://www.arabianbusiness.com/",
  },

  // TIER 3 — BROADCAST & RADIO
  {
    key: "alarabiya", name: "Al Arabiya English", tier: 3, category: "Media",
    rssUrl: gnRss("english.alarabiya.net", "UAE"),
    scrapeUrl: "https://english.alarabiya.net/",
  },
  {
    key: "dubaieye", name: "Dubai Eye 103.8", tier: 3, category: "Media",
    rssUrl: gnRss("dubaieye1038.com"),
    scrapeUrl: "https://www.dubaieye1038.com/",
  },

  // TIER 4 — CITY & LIFESTYLE
  {
    key: "timeout", name: "Time Out Dubai", tier: 4, category: "Lifestyle",
    rssUrl: "https://www.timeoutdubai.com/feed",
    scrapeUrl: "https://www.timeoutdubai.com/",
  },
  {
    key: "whatson", name: "What's On Dubai", tier: 4, category: "Lifestyle",
    rssUrl: "https://whatson.ae/rss",
    scrapeUrl: "https://whatson.ae/",
  },
  {
    key: "visitdubai", name: "Visit Dubai", tier: 4, category: "Lifestyle",
    rssUrl: gnRss("visitdubai.com"),
    scrapeUrl: "https://www.visitdubai.com/en/whats-on",
  },

  // TIER 5 — SAFETY & EMERGENCY
  {
    key: "dubaipolice", name: "Dubai Police", tier: 5, category: "Safety",
    rssUrl: gnRss("dubaipolice.gov.ae"),
    scrapeUrl: "https://www.dubaipolice.gov.ae/wps/portal/home/news",
  },
  {
    key: "adpolice", name: "Abu Dhabi Police", tier: 5, category: "Safety",
    rssUrl: gnRss("adpolice.gov.ae"),
    scrapeUrl: "https://www.adpolice.gov.ae/en/news",
  },
  {
    key: "rta", name: "RTA Dubai", tier: 5, category: "Safety",
    rssUrl: gnRss("rta.ae"),
    scrapeUrl: "https://www.rta.ae/wps/portal/rta/ae/news-events",
  },
  {
    key: "dcda", name: "Dubai Civil Defence", tier: 5, category: "Safety",
    rssUrl: gnRss("dcda.gov.ae"),
    scrapeUrl: "https://www.dcda.gov.ae/en/news",
  },

  // TIER 6 — BUSINESS & FINANCE
  {
    key: "dubaichamber", name: "Dubai Chamber", tier: 6, category: "Business",
    rssUrl: gnRss("dubaichamber.com"),
    scrapeUrl: "https://www.dubaichamber.com/en/news/",
  },
  {
    key: "adgm", name: "ADGM", tier: 6, category: "Business",
    rssUrl: gnRss("adgm.com"),
    scrapeUrl: "https://www.adgm.com/news",
  },
  {
    key: "dfm", name: "Dubai Financial Market", tier: 6, category: "Business",
    rssUrl: gnRss("dfm.ae"),
    scrapeUrl: "https://www.dfm.ae/news",
  },
  {
    key: "difc", name: "DIFC", tier: 6, category: "Business",
    rssUrl: gnRss("difc.ae"),
    scrapeUrl: "https://www.difc.ae/newsroom/",
  },

  // TIER 7 — HEALTH & EDUCATION
  {
    key: "mohap", name: "UAE Ministry of Health", tier: 7, category: "Health & Education",
    rssUrl: gnRss("mohap.gov.ae"),
    scrapeUrl: "https://www.mohap.gov.ae/en/media-centre/news",
  },
  {
    key: "dha", name: "Dubai Health Authority", tier: 7, category: "Health & Education",
    rssUrl: gnRss("dha.gov.ae"),
    scrapeUrl: "https://www.dha.gov.ae/en/news",
  },
  {
    key: "khda", name: "KHDA", tier: 7, category: "Health & Education",
    rssUrl: gnRss("khda.gov.ae"),
    scrapeUrl: "https://www.khda.gov.ae/en/news",
  },
  {
    key: "uaemoe", name: "UAE Ministry of Education", tier: 7, category: "Health & Education",
    rssUrl: gnRss("moe.gov.ae"),
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
  if (!process.env.CLAUDE_API_KEY) return null;

  // ── Check Supabase cache first ────────────────────────────────────────────
  if (supabaseReady()) {
    try {
      const { data } = await supabase
        .from("articles")
        .select("calm_headline, summary, resident_impact, fun_fact, data_points, has_chart_worthy_data")
        .eq("url", key)
        .maybeSingle();
      if (data?.calm_headline) {
        return { calm_headline: data.calm_headline, summary: data.summary, resident_impact: data.resident_impact, fun_fact: data.fun_fact || null, data_points: data.data_points || null, has_chart_worthy_data: data.has_chart_worthy_data || false };
      }
    } catch (err) {
      console.warn("[supabase] cache check failed:", err.message);
    }
  }

  console.log('Processing article with Claude API:', article.title);
  const systemPrompt = `You are a friendly warm news writer for TheDubaiBrief — Dubai's calm, clear news platform for everyday residents, families, and expats.

Rewrite this UAE news article. Return JSON only. No preamble. No markdown fences.

Rules:
- calm_headline: max 12 words, direct and slightly catchy, never panic-inducing. Examples: "Dubai airports back to full speed after busy weekend" / "New bridge opens cutting your commute by 15 minutes"
- summary: 2-3 sentences, write like explaining to a friend, warm conversational tone, include key facts clearly. Occasionally open with "Good news:" or "Worth knowing:" or "In short:". Never use: crisis, blast, surge, threatens, chaos, shocking, catastrophic, explosive, dramatic
- resident_impact: one friendly sentence with practical context. Start with openers like "Good news for commuters —" / "If you have kids in school —" / "Nothing to worry about —" / "Worth knowing if you drive SZR —". Return null if not relevant to daily life
- fun_fact: one surprising or interesting aside. Start with "Fun fact:" or "Interesting:" or "Worth noting:". Return null if nothing genuinely interesting
- data_points: array of key numbers/statistics found in the article. Each item: {"label":"...","value":"...","unit":"...","context":"..."}. Return null if no statistics
- has_chart_worthy_data: true if 2+ data points that would make a good chart, false otherwise

Replace scary words: explosion→incident, fatal→serious, warning→reminder, crisis→situation, outbreak→increase in cases, threatens→may affect, war→conflict, attack→incident

Return ONLY this JSON:
{
  "calm_headline": "...",
  "summary": "...",
  "resident_impact": "... or null",
  "fun_fact": "... or null",
  "data_points": [{"label":"...","value":"...","unit":"...","context":"..."}] or null,
  "has_chart_worthy_data": true or false
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
        model: "claude-sonnet-4-6",
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
      // ── Persist to Supabase (upsert so conflicts on url are handled) ────────
      if (supabaseReady()) {
        supabase.from("articles").upsert({
          url: key,
          original_title: article.title,
          calm_headline: obj.calm_headline,
          summary: obj.summary,
          resident_impact: obj.resident_impact || null,
          fun_fact: obj.fun_fact || null,
          data_points: obj.data_points || null,
          has_chart_worthy_data: obj.has_chart_worthy_data || false,
          category: article.category || null,
          source: article.sourceName || null,
          image_url: article.imageUrl || null,
          published_at: article.publishedAt ? new Date(article.publishedAt).toISOString() : null,
        }, { onConflict: "url" }).then(({ error }) => {
          if (error) console.warn("[supabase] upsert error:", error.message);
        });
      }
      console.log('✓ Rewrite cached for:', article.title);
      return { calm_headline: obj.calm_headline, summary: obj.summary, resident_impact: obj.resident_impact || null, fun_fact: obj.fun_fact || null, data_points: obj.data_points || null, has_chart_worthy_data: obj.has_chart_worthy_data || false };
    }
  } catch (err) {
    console.error("Rewrite error for", key, err.message);
  }
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
  // Only fetch images for the first 20 items (those visible in the UI).
  // Items beyond that already have gradient placeholders and the extra
  // HTTP requests were the biggest cause of slow builds.
  const candidates = items.slice(0, 20).filter(
    (item) => !item.imageUrl || item.imageUrl === item.url
  );
  await Promise.all(candidates.map(async (item) => {
    try {
      const img = await fetchOgImage(item.url);
      if (img) item.imageUrl = img;
    } catch {}
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
      if (sim >= 0.65) {
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

// ─── Smart article categorization ─────────────────────────────────────────────
function categorizeArticle(title, summary, source) {
  const text = ((title || '') + ' ' + (summary || '')).toLowerCase();

  // BREAKING NEWS — highest priority
  const breakingKws = ['breaking', 'urgent', 'just in', 'alert', 'emergency', 'developing', 'flash', 'bulletin', 'just announced', 'breaking news', 'live updates'];
  for (const kw of breakingKws) { if (text.includes(kw)) return 'Breaking News'; }

  // SPORTS — check before politics to avoid F1/football going to politics
  const sportsKws = ['f1', 'formula 1', 'formula one', 'grand prix', ' gp ', 'motogp', 'verstappen', 'hamilton', 'russell', 'leclerc', 'sainz', 'norris', 'alonso', 'perez', 'stroll', 'ferrari', 'mercedes f1', 'red bull racing', 'mclaren', 'football', 'soccer', 'premier league', 'la liga', 'serie a', 'bundesliga', 'champions league', 'europa league', 'uae pro league', 'arabian gulf league', 'al ain fc', 'al jazira', 'al wahda', 'shabab al ahli', 'dubai fc', 'al hilal', 'al nassr', 'al ittihad', 'fifa', 'uefa', 'world cup', 'cricket', 'ipl', 'test match', 'bcci', 'icc', 'tennis', 'atp', 'wta', 'wimbledon', 'us open', 'french open', 'australian open', 'dubai tennis', 'golf', 'pga tour', 'ryder cup', 'dp world tour', 'rugby', 'nba', 'basketball', 'swimming', 'athletics', 'olympics', 'horse racing', 'dubai world cup', 'meydan', 'nad al sheba', 'ufc', 'boxing', 'wrestling', 'mma', 'marathon', 'cycling', 'triathlon', 'athlete', 'transfer', 'squad', 'match result', 'final score', 'championship', 'tournament', 'hat trick', 'podium', 'race result', 'qualifying', 'pole position', 'medal', 'gold medal', 'defeated', 'won the match', 'playoffs', 'strade bianche', 'tour de france'];
  for (const kw of sportsKws) { if (text.includes(kw)) return 'Sports'; }

  // POLITICS — regional & international conflicts
  const politicsKws = ['iran', 'iranian', 'tehran', 'israel', 'israeli', 'tel aviv', 'palestine', 'palestinian', 'gaza', 'west bank', 'hamas', 'hezbollah', 'lebanon', 'beirut', 'saudi arabia', 'riyadh', 'qatar', 'doha', 'kuwait', 'bahrain', 'egypt', 'cairo', 'jordan', 'amman', 'syria', 'damascus', 'iraq', 'baghdad', 'yemen', 'sanaa', 'russia', 'ukraine', 'moscow', 'nato', 'pentagon', 'white house', 'us president', 'china', 'beijing', 'india', 'modi', 'pakistan', 'islamabad', 'united nations', 'un security', 'g20', 'g7', 'ceasefire', 'peace talks', 'sanctions', 'embargo', 'diplomatic crisis', 'foreign minister', 'political prisoner', 'election results', 'coup', 'military strike', 'airstrike', 'missile attack', 'drone attack', 'invasion', 'troops', 'nuclear deal', 'arms deal', 'geopolitical', 'regional conflict', 'gcc summit', 'arab league'];
  for (const kw of politicsKws) { if (text.includes(kw)) return 'Politics'; }

  // DUBAI NEWS
  const dubaiKws = ['dubai', 'dxb', 'rta', 'dubai metro', 'dubai tram', 'dubai airport', 'burj khalifa', 'burj al arab', 'palm jumeirah', 'downtown dubai', 'dubai marina', 'jumeirah', 'deira', 'bur dubai', 'business bay', 'jlt', 'jvc', 'dubai hills', 'dubai creek', 'creek harbour', 'expo city', 'dubai south', 'silicon oasis', 'dubai chamber', 'salik', 'nol card', 'dubai mall', 'mall of emirates', 'dubai police', 'dubai municipality', 'dubai health authority', 'dha dubai', 'dubai court', 'dubai ruler', 'dubai government', 'emirate of dubai'];
  for (const kw of dubaiKws) { if (text.includes(kw)) return 'Dubai News'; }

  // ABU DHABI NEWS
  const abuDhabiKws = ['abu dhabi', 'auh', 'adnoc', 'adgm', 'adek', 'mubadala', 'adq', 'aldar', 'abu dhabi airport', 'louvre abu dhabi', 'saadiyat island', 'yas island', 'yas mall', 'al reem island', 'masdar city', 'abu dhabi corniche', 'abu dhabi government', 'abu dhabi ruler', 'abu dhabi crown prince', 'abu dhabi chamber', 'abu dhabi tourism', 'abu dhabi court', 'abu dhabi municipality', 'zayed city'];
  for (const kw of abuDhabiKws) { if (text.includes(kw)) return 'Abu Dhabi News'; }

  // ECONOMY & BUSINESS
  const economyKws = ['economy', 'gdp', 'inflation', 'stock market', 'stock exchange', 'dfm', 'adx', 'difc', 'investment', 'real estate', 'property market', 'mortgage', 'rent increase', 'startup funding', 'series a', 'series b', 'venture capital', 'ipo', 'acquisition', 'merger', 'revenue', 'profit', 'quarterly results', 'annual report', 'oil price', 'crude oil', 'barrel', 'opec', 'gold price', 'dirham', 'exchange rate', 'retail sales', 'trade deal', 'export', 'import', 'tourism revenue', 'hotel occupancy', 'business license', 'entrepreneur', 'founder', 'unicorn', 'valuation', 'bank rate', 'interest rate', 'central bank', 'financial results', 'earnings'];
  for (const kw of economyKws) { if (text.includes(kw)) return 'Economy & Business'; }

  // TECHNOLOGY
  const techKws = ['artificial intelligence', ' ai ', 'chatgpt', 'openai', 'gemini', 'machine learning', 'large language model', 'llm', 'robotics', 'automation', 'cybersecurity', 'data breach', 'hacking', 'cyber attack', '5g', 'blockchain', 'cryptocurrency', 'bitcoin', 'ethereum', 'nft', 'gitex', 'tech summit', 'cloud computing', 'fintech', 'smart city', 'iot', 'internet of things', 'electric vehicle', 'tesla', 'self driving', 'autonomous', 'metaverse', 'virtual reality', 'augmented reality', 'digital transformation', 'tech startup', 'data center', 'semiconductor', 'satellite'];
  for (const kw of techKws) { if (text.includes(kw)) return 'Technology'; }

  // UAE GOVERNMENT — federal level only
  const govKws = ['sheikh', 'his highness', 'ruler of', 'crown prince of', 'uae president', 'uae vice president', 'prime minister of uae', 'federal authority', 'uae cabinet', 'uae ministry', 'uae minister', 'uae law', 'uae decree', 'uae policy', 'wam news', 'uae government', 'emirates news agency', 'uae vision', 'uae strategy', 'uae council', 'uae federal', 'mohammed bin rashid', 'mohammed bin zayed', 'mbr', 'mbz', 'hamdan bin mohammed', 'khaled bin mohammed', 'maktoum', 'nahyan', 'issued a decree', 'approved by cabinet', 'official visit', 'state visit', 'received in audience'];
  for (const kw of govKws) { if (text.includes(kw)) return 'UAE Government'; }

  // Default based on source name
  if (source) {
    const src = source.toLowerCase();
    if (src.includes('wam') || src.includes('emirates news agency')) return 'UAE Government';
    if (src.includes('uae cabinet') || src.includes('uae government') || src.includes('federal')) return 'UAE Government';
    if (src.includes('dubai media office') || src.includes('dubai police') || src.includes('rta') || src.includes('dha ')) return 'Dubai News';
    if (src.includes('dubai')) return 'Dubai News';
    if (src.includes('abu dhabi')) return 'Abu Dhabi News';
    if (src.includes('gulf business') || src.includes('arabian business') || src.includes('zawya') || src.includes('bloomberg')) return 'Economy & Business';
    if (src.includes('gulf news') || src.includes('khaleej times') || src.includes('the national') || src.includes('time out') || src.includes('emirates 24') || src.includes('al arabiya') || src.includes('arab news') || src.includes('thenational')) return 'Dubai News';
  }

  return 'Dubai News';
}

// ─── Cache plumbing ───────────────────────────────────────────────────────────

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 min — serve stale, rebuild in background
const SOURCE_CACHE_TTL_MS = 10 * 60 * 1000;

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

    // Fetch sources in parallel with concurrency limit of 6 to balance speed vs rate-limiting
    const CONCURRENCY = 6;
    const results = new Array(ALL_SOURCES.length);
    let idx = 0;
    const workers = Array.from({ length: Math.min(CONCURRENCY, ALL_SOURCES.length) }, async () => {
      while (idx < ALL_SOURCES.length) {
        const i = idx++;
        const s = ALL_SOURCES[i];
        const before = Date.now();
        try {
          const raw = await fetchSourceArticles(s);
          const elapsed = Date.now() - before;
          sourceStatus.set(s.key, { ok: true, lastCheck: new Date(), articleCount: raw.length, elapsed });
          results[i] = { status: "fulfilled", value: { source: s, raw } };
        } catch (err) {
          sourceStatus.set(s.key, { ok: false, lastCheck: new Date(), articleCount: 0, error: err.message });
          results[i] = { status: "rejected", reason: err };
        }
      }
    });
    await Promise.all(workers);

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
      // Tag government sources for the Gov feed section
      normalized.isGovSource = source.isGovSource || [1, 5, 7].includes(source.tier);

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

  // Sort first so Claude rewrites the most important articles (top 15 visible ones)
  deduped.sort((a, b) => {
    const ta = a.publishedAtMs || 0;
    const tb = b.publishedAtMs || 0;
    const boostA = (a.tier || 99) <= 1 ? 30 * 60 * 1000 : 0;
    const boostB = (b.tier || 99) <= 1 ? 30 * 60 * 1000 : 0;
    return (tb + boostB) - (ta + boostA);
  });

  // Fetch images only for visible articles (first 20)
  await fetchAllImages(deduped);

  // Rewrite top 15 with Claude — the ones the user actually sees on load.
  // Articles beyond position 15 keep their calmified titles and get rewritten
  // on the next build cycle once the cache warms up.
  await processConcurrently(deduped.slice(0, 15), 3, async (item) => {
    const rew = await rewriteArticle(item);
    if (rew) {
      item.calmTitle = rew.calm_headline || item.calmTitle;
      item.calmSummary = rew.summary || item.calmSummary;
      item.residentImpact = rew.resident_impact;
      item.funFact = rew.fun_fact || null;
      item.dataPoints = rew.data_points || null;
      item.hasChartData = rew.has_chart_worthy_data || false;
    } else {
      item.rewriteFailed = true;
    }
  });

  // ── Smart categorization (uses calm titles for best accuracy) ────────────
  for (const item of deduped) {
    item.category = categorizeArticle(
      item.calmTitle || item.title || '',
      item.calmSummary || item.description || '',
      item.sourceName || ''
    );
    item.isBreaking = item.category === 'Breaking News';
  }

  // ── Persist all processed articles to Supabase (archive) ─────────────────
  persistArticles(deduped.slice(0, 40)).catch(() => {});

  // ── Filter to last 7 days for homepage feed ───────────────────────────────
  const cutoffMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recent = deduped.filter(a => (a.publishedAtMs || 0) >= cutoffMs);
  // Fall back to all articles if fewer than 10 in last 7 days
  const feedItems = recent.length >= 10 ? recent : deduped;

  const payload = {
    generatedAtMs: Date.now(),
    items: feedItems.slice(0, 100),
    sourceStatus: Object.fromEntries(sourceStatus),
  };

  cache = payload;
  buildInFlight = null;
  return cache;
}

// ─── Persist articles to Supabase for archive ─────────────────────────────────
async function persistArticles(items) {
  if (!supabaseReady()) return;
  const rows = items
    .filter(item => item.url)
    .map(item => ({
      url: item.url,
      original_title: item.title || null,
      calm_headline: item.calmTitle || null,
      summary: item.calmSummary || null,
      resident_impact: item.residentImpact || null,
      fun_fact: item.funFact || null,
      data_points: item.dataPoints || null,
      has_chart_worthy_data: item.hasChartData || false,
      category: item.category || null,
      source: item.sourceName || null,
      image_url: item.imageUrl || null,
      published_at: item.publishedAt ? new Date(item.publishedAt).toISOString() : null,
    }));

  // Batch in chunks of 50 to stay within Supabase request limits
  for (let i = 0; i < rows.length; i += 50) {
    const chunk = rows.slice(i, i + 50);
    const { error } = await supabase
      .from("articles")
      .upsert(chunk, { onConflict: "url", ignoreDuplicates: false });
    if (error) console.warn("[supabase] persist batch error:", error.message);
  }
  console.log(`[supabase] persisted ${rows.length} articles to archive`);
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
