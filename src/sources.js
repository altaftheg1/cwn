import * as cheerio from "cheerio";
import { absoluteUrl, safeJsonParse } from "./util.js";
import { execFile } from "child_process";
import { promisify } from "util";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const execFileAsync = promisify(execFile);

async function fetchHtmlWithCurl(url) {
  const { stdout } = await execFileAsync(
    "curl.exe",
    [
      "-L",
      "-s",
      "--compressed",
      "--http1.1",
      "-A",
      USER_AGENT,
      "-H",
      "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "-H",
      "Accept-Language: en-US,en;q=0.9",
      "--max-time",
      "8",
      url,
    ],
    { maxBuffer: 8 * 1024 * 1024 }
  );
  return String(stdout || "");
}

async function fetchHtml(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          "user-agent": USER_AGENT,
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "en-US,en;q=0.9",
          "cache-control": "no-cache",
          pragma: "no-cache",
        },
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }
  } catch {
    return await fetchHtmlWithCurl(url);
  }
}

// ─── RSS / Atom Feed Support ──────────────────────────────────────────────────

function parseRss(xml, baseUrl) {
  const $ = cheerio.load(xml, { xmlMode: true });
  const items = [];

  // RSS 2.0 <item> elements
  $("item").each((_, el) => {
    const title = $("title", el).first().text().trim();
    // <link> in RSS is often a text node sibling of other elements
    let link = "";
    $(el).children("link").each((__, linkEl) => {
      const t = $(linkEl).text().trim();
      if (t && t.startsWith("http")) { link = t; }
    });
    if (!link) link = $(el).find("guid").text().trim();
    if (!link) link = $(el).find("feedburner\\:origLink").text().trim();

    // Google News RSS wraps original URLs — extract real URL from <source url="...">
    if (link && link.includes("news.google.com")) {
      const srcUrl = $("source", el).attr("url") || "";
      if (srcUrl && srcUrl.startsWith("http") && !srcUrl.includes("news.google.com")) {
        link = srcUrl;
      }
    }

    const description = $("description", el).first().text().trim();
    const pubDate =
      $("pubDate", el).first().text().trim() ||
      $("dc\\:date", el).first().text().trim();

    // Image from enclosure / media tags
    let imageUrl =
      $(el).find("enclosure[type*='image']").attr("url") ||
      $(el).find("media\\:thumbnail").attr("url") ||
      $(el).find("media\\:content[medium='image']").attr("url") ||
      $(el).find("media\\:content").first().attr("url") ||
      "";

    if (!imageUrl) {
      // Attempt to extract first <img> from description HTML
      const m = description.match(/<img[^>]+src=["']([^"']+)["']/i);
      if (m) imageUrl = m[1];
    }

    if (!title || !link) return;

    let publishedAt = "";
    if (pubDate) {
      try { publishedAt = new Date(pubDate).toISOString(); } catch {}
    }

    items.push({
      title,
      url: absoluteUrl(baseUrl, link),
      description: description.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 500),
      publishedAt,
      imageUrl: imageUrl ? absoluteUrl(baseUrl, imageUrl) : "",
    });
  });

  // Atom <entry> elements (fallback if no RSS items found)
  if (items.length === 0) {
    $("entry").each((_, el) => {
      const title = $("title", el).first().text().trim();
      const link =
        $(el).find("link[rel='alternate']").attr("href") ||
        $(el).find("link").first().attr("href") ||
        "";
      const summary =
        $("summary", el).first().text().trim() ||
        $("content", el).first().text().trim();
      const published =
        $("published", el).first().text().trim() ||
        $("updated", el).first().text().trim();
      const imageUrl =
        $(el).find("media\\:thumbnail").attr("url") ||
        $(el).find("media\\:content").attr("url") ||
        "";

      if (!title || !link) return;

      let publishedAt = "";
      if (published) {
        try { publishedAt = new Date(published).toISOString(); } catch {}
      }

      items.push({
        title,
        url: absoluteUrl(baseUrl, link),
        description: summary.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 500),
        publishedAt,
        imageUrl: imageUrl ? absoluteUrl(baseUrl, imageUrl) : "",
      });
    });
  }

  return items.length > 0 ? items.slice(0, 10) : null;
}

async function fetchRss(rssUrl) {
  let xml;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const res = await fetch(rssUrl, {
        signal: controller.signal,
        headers: {
          "user-agent": USER_AGENT,
          accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
          "accept-language": "en-US,en;q=0.9",
        },
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      xml = await res.text();
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }
  } catch {
    try {
      xml = await fetchHtmlWithCurl(rssUrl);
    } catch {
      return null;
    }
  }

  if (!xml || xml.trim().length < 100) return null;

  // Must look like XML / RSS
  if (!xml.trim().startsWith("<")) return null;

  try {
    return parseRss(xml, rssUrl);
  } catch {
    return null;
  }
}

// ─── JSON-LD / OG extraction (HTML scraping) ─────────────────────────────────

function readJsonLdNodes($) {
  const scripts = $('script[type="application/ld+json"]');
  const blobs = [];
  scripts.each((_, el) => {
    const txt = $(el).text();
    if (!txt) return;
    const parsed = safeJsonParse(txt);
    if (!parsed) return;
    if (Array.isArray(parsed)) blobs.push(...parsed);
    else blobs.push(parsed);
  });

  const nodes = [];
  for (const b of blobs) {
    if (b && typeof b === "object" && b["@graph"] && Array.isArray(b["@graph"])) {
      nodes.push(...b["@graph"]);
    } else {
      nodes.push(b);
    }
  }
  return nodes.filter(Boolean);
}

function extractImageFromJsonLd(img) {
  if (!img) return "";
  if (typeof img === "string") return img;
  if (Array.isArray(img)) {
    for (const item of img) {
      if (typeof item === "string") return item;
      if (item && typeof item === "object") return item.url || item["@id"] || "";
    }
    return "";
  }
  if (typeof img === "object") return img.url || img["@id"] || "";
  return "";
}

function extractJsonLdList(html, pageUrl) {
  const $ = cheerio.load(html);
  const nodes = readJsonLdNodes($);

  const articles = [];
  for (const n of nodes) {
    const t = n && typeof n === "object" ? n["@type"] : null;
    const types = Array.isArray(t) ? t : t ? [t] : [];
    const isNews =
      types.includes("NewsArticle") ||
      types.includes("Article") ||
      types.includes("ReportageNewsArticle") ||
      types.includes("BlogPosting");
    if (!isNews) continue;

    const url = absoluteUrl(pageUrl, n.url || n.mainEntityOfPage || n["@id"]);
    const title = n.headline || n.name || "";
    const description = n.description || n.abstract || "";
    const datePublished = n.datePublished || n.dateCreated || n.dateModified || "";
    const image = extractImageFromJsonLd(n.image) || extractImageFromJsonLd(n.thumbnailUrl);

    articles.push({
      url,
      title,
      description,
      publishedAt: datePublished,
      imageUrl: absoluteUrl(pageUrl, image),
    });
  }

  return articles.filter((a) => a.url && a.title);
}

function extractBestArticleFromPage(html, pageUrl) {
  const $ = cheerio.load(html);
  const nodes = readJsonLdNodes($);

  const ogTitle = $('meta[property="og:title"]').attr("content") || "";
  const ogDesc = $('meta[property="og:description"]').attr("content") || $('meta[name="description"]').attr("content") || "";
  const ogImage = $('meta[property="og:image"]').attr("content") || "";
  const ogPublished = $('meta[property="article:published_time"]').attr("content") || "";

  const candidates = [];
  for (const n of nodes) {
    const t = n && typeof n === "object" ? n["@type"] : null;
    const types = Array.isArray(t) ? t : t ? [t] : [];
    const isNews =
      types.includes("NewsArticle") ||
      types.includes("Article") ||
      types.includes("ReportageNewsArticle") ||
      types.includes("BlogPosting");
    if (!isNews) continue;

    const url = absoluteUrl(pageUrl, n.url || n.mainEntityOfPage || n["@id"]) || pageUrl;
    const title = n.headline || n.name || "";
    const description = n.description || n.abstract || "";
    const datePublished = n.datePublished || n.dateCreated || n.dateModified || "";
    const image = extractImageFromJsonLd(n.image) || extractImageFromJsonLd(n.thumbnailUrl);
    const resolvedImage = absoluteUrl(pageUrl, image) || absoluteUrl(pageUrl, ogImage);

    candidates.push({ url, title, description, publishedAt: datePublished, imageUrl: resolvedImage });
  }

  candidates.sort((a, b) => {
    const aMatch = a.url === pageUrl ? 1 : 0;
    const bMatch = b.url === pageUrl ? 1 : 0;
    if (bMatch !== aMatch) return bMatch - aMatch;
    const aScore = (a.description ? 1 : 0) + (a.publishedAt ? 1 : 0);
    const bScore = (b.description ? 1 : 0) + (b.publishedAt ? 1 : 0);
    return bScore - aScore;
  });

  const best = candidates[0] || null;
  if (best && best.title) return best;

  if (ogTitle) {
    return {
      url: pageUrl,
      title: ogTitle,
      description: ogDesc,
      publishedAt: ogPublished,
      imageUrl: absoluteUrl(pageUrl, ogImage),
    };
  }

  return null;
}

function extractFallbackLinks(html, pageUrl) {
  const $ = cheerio.load(html);
  const links = [];
  $("a").each((_, el) => {
    const href = $(el).attr("href");
    const text = ($(el).text() || "").trim();
    if (!href || !text) return;
    const url = absoluteUrl(pageUrl, href);
    if (!url) return;
    if (text.length < 22) return;
    links.push({ url, title: text });
  });

  const map = new Map();
  for (const l of links) {
    if (!map.has(l.url)) map.set(l.url, l);
  }
  return Array.from(map.values()).slice(0, 20);
}

function isProbablyArticleUrl(url, allowedHosts) {
  if (!url) return false;
  const trimmed = String(url).trim();
  if (trimmed.startsWith("tel:") || trimmed.startsWith("mailto:")) return false;
  try {
    const u = new URL(trimmed);
    if (allowedHosts && allowedHosts.length) {
      const host = u.hostname.toLowerCase().replace(/^www\./, "");
      const ok = allowedHosts.some((h) => {
        const allowed = String(h).toLowerCase().replace(/^www\./, "");
        return host === allowed || host.endsWith("." + allowed);
      });
      if (!ok) return false;
    }
    const p = u.pathname.toLowerCase();
    const bad = [
      "/privacy", "/privacy-notice", "/terms", "/terms-and-conditions",
      "/contact", "/advertise", "/sitemap", "/login", "/subscribe",
      "/epaper", "/newsletter", "/accessibility", "/footer/",
    ];
    if (bad.some((b) => p.includes(b))) return false;
    const segs = p.split("/").filter(Boolean);
    if (segs.length < 2) return false;
    if (p.endsWith("/")) return true;
    if (/\d/.test(p)) return true;
    if (p.includes(".html")) return true;
    if (p.includes("/article/")) return true;
    return segs.length >= 3;
  } catch {
    return false;
  }
}

async function enrichArticles(candidates) {
  const out = [];
  const queue = [...candidates];
  // 2 workers max to avoid flooding the network during a build
  const workers = new Array(2).fill(0).map(async () => {
    while (queue.length) {
      const c = queue.shift();
      if (!c) break;
      try {
        const html = await fetchHtml(c.url);
        const best = extractBestArticleFromPage(html, c.url);
        if (best) out.push({ ...c, ...best });
        else out.push(c);
      } catch {
        out.push(c);
      }
    }
  });
  await Promise.all(workers);
  return out;
}

function extractUaePortalCards(html, pageUrl) {
  const $ = cheerio.load(html);
  const cards = [];
  $("p.card-text").each((_, el) => {
    const title = ($(el).text() || "").trim();
    const container = $(el).closest("a");
    const href = container.attr("href") || "";
    const url = absoluteUrl(pageUrl, href);
    const date = $(el).closest(".card-container").find(".card-date").first().text().trim();
    const img = $(el).closest("a").find("img").first().attr("src") || "";
    if (!title || !url) return;
    let publishedAt = "";
    if (date) {
      const d = new Date(date);
      if (!Number.isNaN(d.getTime())) publishedAt = d.toISOString();
    }
    cards.push({ url, title, description: "", publishedAt, imageUrl: absoluteUrl(pageUrl, img) });
  });

  const map = new Map();
  for (const c of cards) {
    if (!map.has(c.url)) map.set(c.url, c);
  }
  return Array.from(map.values()).slice(0, 15);
}

// Generic gov/institutional news page scraper — tries common card patterns
function extractGenericNewsCards(html, pageUrl) {
  const $ = cheerio.load(html);
  const cards = [];

  // Pattern 1: <article> elements
  $("article, .news-item, .news-card, .media-item, .press-release, .card").each((_, el) => {
    const a = $(el).find("a[href]").first();
    const href = a.attr("href") || $(el).closest("a").attr("href") || "";
    const url = href ? absoluteUrl(pageUrl, href) : "";
    if (!url) return;

    const title =
      $(el).find("h1,h2,h3,h4,.title,.headline,.card-title,.item-title").first().text().trim() ||
      a.text().trim();
    if (!title || title.length < 10) return;

    const dateText =
      $(el).find("time,.date,.pub-date,.published,.post-date").first().attr("datetime") ||
      $(el).find("time,.date,.pub-date,.published,.post-date").first().text().trim();
    let publishedAt = "";
    if (dateText) {
      try { publishedAt = new Date(dateText).toISOString(); } catch {}
    }

    const img =
      $(el).find("img").first().attr("src") ||
      $(el).find("img").first().attr("data-src") || "";

    cards.push({
      url,
      title,
      description: $(el).find("p,.excerpt,.summary,.description,.teaser").first().text().trim().slice(0, 300),
      publishedAt,
      imageUrl: img ? absoluteUrl(pageUrl, img) : "",
    });
  });

  // Pattern 2: OG/meta fallback for single article pages
  if (cards.length === 0) {
    const ogTitle = $('meta[property="og:title"]').attr("content") || "";
    const ogDesc = $('meta[property="og:description"]').attr("content") || "";
    const ogImage = $('meta[property="og:image"]').attr("content") || "";
    const ogPublished = $('meta[property="article:published_time"]').attr("content") || "";
    if (ogTitle) {
      cards.push({
        url: pageUrl,
        title: ogTitle,
        description: ogDesc,
        publishedAt: ogPublished,
        imageUrl: absoluteUrl(pageUrl, ogImage),
      });
    }
  }

  // Deduplicate by URL
  const map = new Map();
  for (const c of cards) {
    if (!map.has(c.url) && isProbablyArticleUrl(c.url, [new URL(pageUrl).hostname])) {
      map.set(c.url, c);
    }
  }
  return Array.from(map.values()).slice(0, 12);
}

// ─── Main export ─────────────────────────────────────────────────────────────

export async function fetchSourceArticles(source) {
  // 1. Try RSS feed first
  if (source.rssUrl) {
    try {
      const rssItems = await fetchRss(source.rssUrl);
      if (rssItems && rssItems.length > 0) {
        console.log(`[RSS OK] ${source.name}: ${rssItems.length} items`);
        return rssItems;
      }
    } catch (err) {
      console.warn(`[RSS fail] ${source.name}: ${err.message}`);
    }
  }

  // 2. Fall back to HTML scrape
  const scrapeUrl = source.scrapeUrl || source.url;
  if (!scrapeUrl) {
    console.warn(`[skip] ${source.name}: no URL`);
    return [];
  }

  let html;
  try {
    html = await fetchHtml(scrapeUrl);
  } catch (err) {
    console.warn(`[scrape fail] ${source.name}: ${err.message}`);
    return [];
  }

  // UAE portal: specific card grid extractor
  if (source.scrapeType === "uae") {
    const uaeCards = extractUaePortalCards(html, scrapeUrl);
    console.log(`[scrape OK] ${source.name} (uae-portal): ${uaeCards.length} items`);
    return uaeCards.slice(0, 12);
  }

  // Try JSON-LD first
  const jsonLd = extractJsonLdList(html, scrapeUrl);
  const sourceHost = new URL(scrapeUrl).hostname;
  const allowedHosts = [sourceHost];

  let candidates = [];
  if (jsonLd.length > 0) {
    candidates = jsonLd
      .map((x) => ({ url: x.url, title: x.title, description: x.description, publishedAt: x.publishedAt, imageUrl: x.imageUrl }))
      .filter((x) => isProbablyArticleUrl(x.url, allowedHosts));
  } else {
    // Try generic card extractor
    const genericCards = extractGenericNewsCards(html, scrapeUrl);
    if (genericCards.length > 0) {
      console.log(`[scrape OK] ${source.name} (generic): ${genericCards.length} items`);
      return genericCards;
    }
    // Last resort: anchor-based fallback
    const links = extractFallbackLinks(html, scrapeUrl);
    candidates = links
      .map((l) => ({ url: l.url, title: l.title, description: "", publishedAt: "", imageUrl: "" }))
      .filter((x) => isProbablyArticleUrl(x.url, allowedHosts));
  }

  candidates = candidates.slice(0, 6);
  if (candidates.length === 0) {
    console.warn(`[scrape] ${source.name}: 0 candidates`);
    return [];
  }

  const enriched = await enrichArticles(candidates);
  console.log(`[scrape OK] ${source.name}: ${enriched.length} items`);
  return enriched;
}
