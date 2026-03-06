import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { load } from "cheerio";
import { fileURLToPath } from "url";
import { buildNewsCache, getCachedNews, getCachedArticleById, startBackgroundBuild, getSourceStatus } from "./src/news-cache.js";
import { calmifyArticle } from "./src/tone.js";
import communityRouter from "./src/community.js";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";

const _supabase = createSupabaseClient(
  process.env.SUPABASE_URL || "",
  process.env.SUPABASE_KEY || ""
);
const _anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY || "" });
import articleRouter from "./src/article-router.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const RESEND_FROM = process.env.RESEND_FROM || "onboarding@resend.dev";
const APP_BASE_URL = process.env.APP_BASE_URL || `http://localhost:${PORT}`;
const TOPIC_KEYS = new Set(["safety", "politics", "finance", "health", "community", "transport", "news", "education"]);
const TIMING_KEYS = new Set(["morning", "evening", "breaking", "weekly"]);

const SUB_FILE = path.join(__dirname, "subscribers.json");
const DIGEST_STATE_FILE = path.join(__dirname, "digest-state.json");
let subscribers = [];
let digestState = { morningDate: "", eveningDate: "" };

function normalizeTopics(topics) {
  if (!Array.isArray(topics)) return [];
  return [...new Set(
    topics
      .map((t) => String(t || "").trim().toLowerCase())
      .map((t) => (t === "world" ? "community" : t))
      .filter((t) => TOPIC_KEYS.has(t))
  )];
}

function normalizeTiming(timing) {
  if (!Array.isArray(timing)) return [];
  return [...new Set(
    timing
      .map((t) => String(t || "").trim().toLowerCase())
      .filter((t) => TIMING_KEYS.has(t))
  )];
}

function loadSubscribers() {
  try {
    const raw = JSON.parse(fs.readFileSync(SUB_FILE, "utf8"));
    if (!Array.isArray(raw)) throw new Error("Invalid subscribers file");
    subscribers = raw
      .map((entry) => {
        if (typeof entry === "string") {
          return {
            email: entry.toLowerCase(),
            topics: [],
            timing: ["morning", "evening"],
            subscribedAt: new Date().toISOString(),
            active: true,
          };
        }
        if (!entry || typeof entry !== "object") return null;
        const email = String(entry.email || "").trim().toLowerCase();
        if (!email) return null;
        return {
          email,
          topics: normalizeTopics(entry.topics),
          timing: normalizeTiming(entry.timing?.length ? entry.timing : ["morning", "evening"]),
          subscribedAt: entry.subscribedAt || entry.createdAt || new Date().toISOString(),
          active: entry.active !== false,
        };
      })
      .filter(Boolean);
  } catch {
    subscribers = [];
  }
}
function saveSubscribers() {
  try { fs.writeFileSync(SUB_FILE, JSON.stringify(subscribers, null, 2)); } catch {}
}

function loadDigestState() {
  try {
    const raw = JSON.parse(fs.readFileSync(DIGEST_STATE_FILE, "utf8"));
    digestState = {
      morningDate: String(raw.morningDate || ""),
      eveningDate: String(raw.eveningDate || ""),
    };
  } catch {
    digestState = { morningDate: "", eveningDate: "" };
  }
}

function saveDigestState() {
  try { fs.writeFileSync(DIGEST_STATE_FILE, JSON.stringify(digestState, null, 2)); } catch {}
}

loadSubscribers();
loadDigestState();

// Check if API key is loaded
console.log('API Key loaded:', !!process.env.CLAUDE_API_KEY);
console.log("Resend key loaded:", !!RESEND_API_KEY);

async function sendResendEmail({ to, subject, html, text }) {
  if (!RESEND_API_KEY) {
    throw new Error("Missing RESEND_API_KEY");
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: RESEND_FROM,
      to: [to],
      subject,
      html,
      text,
    }),
  });
  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`Resend ${response.status}: ${errText}`);
  }
}

function classifyTopic(item) {
  const text = `${item?.calmTitle || ""} ${item?.title || ""} ${item?.calmSummary || ""} ${item?.sourceName || ""}`.toLowerCase();
  if (/school|university|student|education/.test(text)) return "education";
  if (/health|hospital|clinic|vaccine|medical/.test(text)) return "health";
  if (/stock|market|price|finance|salary|economy/.test(text)) return "finance";
  if (/president|cabinet|minister|diplomat|parliament/.test(text)) return "politics";
  if (/missile|drone|defence|emergency|incident|crisis/.test(text)) return "safety";
  if (/flight|airport|traffic|transport|road/.test(text)) return "transport";
  if (/family|community|resident|travel|ramadan/.test(text)) return "community";
  return "news";
}

function getDubaiParts(now = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dubai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function dubaiLocalToUtcMs(year, month, day, hour = 0, minute = 0, second = 0) {
  return Date.UTC(year, month - 1, day, hour, minute, second) - (4 * 60 * 60 * 1000);
}

function formatDubaiDateKey(parts) {
  const y = String(parts.year);
  const m = String(parts.month).padStart(2, "0");
  const d = String(parts.day).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function prettyTopic(t) {
  const map = {
    safety: "Safety",
    politics: "Government",
    finance: "Finance",
    health: "Health",
    transport: "Transport",
    community: "World Affairs",
    education: "Education",
    news: "General News",
  };
  return map[t] || t;
}

function prettyTiming(t) {
  const map = {
    morning: "Morning Digest (7:00 AM GST)",
    evening: "Evening Digest (8:00 PM GST)",
    breaking: "Breaking Only (Max 3/day)",
    weekly: "Weekly Summary (Friday)",
  };
  return map[t] || t;
}

function escapeHtml(text) {
  return String(text || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function nextScheduledTimeLabel(timing) {
  const picks = Array.isArray(timing) ? timing : [];
  if (picks.includes("morning")) return "tomorrow at 7:00 AM GST";
  if (picks.includes("evening")) return "today at 8:00 PM GST";
  if (picks.includes("weekly")) return "this Friday evening";
  if (picks.includes("breaking")) return "when a major UAE update is published";
  return "on the next digest cycle";
}

function getDigestStories({ fromMs, toMs, topics }) {
  const items = getCachedNews()?.items || [];
  return items
    .filter((item) => {
      const published = Number(item.publishedAtMs || new Date(item.publishedAt || 0).getTime() || 0);
      if (!published) return false;
      if (published < fromMs || published > toMs) return false;
      if (!topics?.length) return true;
      return topics.includes(classifyTopic(item));
    })
    .sort((a, b) => Number(b.publishedAtMs || 0) - Number(a.publishedAtMs || 0))
    .slice(0, 5);
}

function buildDigestEmail(slotLabel, stories) {
  const headline = `CWN ${slotLabel} digest`;
  const htmlItems = stories.map((s) => {
    const title = s.calmTitle || s.title || "Update";
    const summary = s.calmSummary || s.description || "";
    const url = `${APP_BASE_URL}/article.html?id=${encodeURIComponent(s.id)}`;
    return `<li style="margin-bottom:14px;"><a href="${url}" style="color:#C8102E;font-weight:700;text-decoration:none;">${title}</a><div style="color:#444;margin-top:4px;">${summary}</div></li>`;
  }).join("");
  const textItems = stories.map((s, i) => {
    const title = s.calmTitle || s.title || "Update";
    const summary = s.calmSummary || s.description || "";
    const url = `${APP_BASE_URL}/article.html?id=${encodeURIComponent(s.id)}`;
    return `${i + 1}. ${title}\n${summary}\n${url}`;
  }).join("\n\n");
  return {
    subject: `${headline} - top ${stories.length} stories`,
    html: `<div style="font-family:Arial,sans-serif;line-height:1.5;"><h2 style="margin:0 0 12px;">${headline}</h2><ul style="padding-left:18px;">${htmlItems}</ul></div>`,
    text: `${headline}\n\n${textItems}`,
  };
}

async function sendDigestToSubscribers(slotLabel, rangeBuilder) {
  if (!RESEND_API_KEY || !subscribers.length) return;
  const now = new Date();
  for (const sub of subscribers) {
    if (sub.active === false) continue;
    const timings = normalizeTiming(sub.timing);
    if (timings.length && !timings.includes(slotLabel)) continue;
    const range = rangeBuilder(now);
    const stories = getDigestStories({
      fromMs: range.fromMs,
      toMs: range.toMs,
      topics: sub.topics,
    });
    if (!stories.length) continue;
    const payload = buildDigestEmail(slotLabel, stories);
    try {
      await sendResendEmail({ to: sub.email, ...payload });
    } catch (err) {
      console.error(`Digest send failed for ${sub.email}:`, err.message);
    }
  }
}

async function maybeSendScheduledDigests() {
  const parts = getDubaiParts();
  const dateKey = formatDubaiDateKey(parts);
  if (parts.hour === 7 && parts.minute === 0 && digestState.morningDate !== dateKey) {
    await sendDigestToSubscribers("morning", () => {
      const toMs = Date.now();
      const fromMs = toMs - (12 * 60 * 60 * 1000);
      return { fromMs, toMs };
    });
    digestState.morningDate = dateKey;
    saveDigestState();
    console.log("Morning digest processed for", dateKey);
  }
  if (parts.hour === 20 && parts.minute === 0 && digestState.eveningDate !== dateKey) {
    await sendDigestToSubscribers("evening", () => {
      const fromMs = dubaiLocalToUtcMs(parts.year, parts.month, parts.day, 0, 0, 0);
      const toMs = Date.now();
      return { fromMs, toMs };
    });
    digestState.eveningDate = dateKey;
    saveDigestState();
    console.log("Evening digest processed for", dateKey);
  }
}

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Serve static files from project root (so you can open the HTML via http://localhost:3000/uae-calm-uae-news.html)
app.use(express.static(__dirname, { extensions: ["html"] }));

app.get("/api/news", async (req, res) => {
  try {
    // SERVE CACHE FIRST: immediately return whatever is cached, don't wait for API calls
    const cached = getCachedNews();
    
    // Trigger background rebuild silently (don't wait for it)
    startBackgroundBuild();

    if (cached) {
      // Send cached data instantly
      return res.json(cached);
    }

    // If no cache yet, wait for first build
    const fresh = await buildNewsCache({ force: true });
    return res.json(fresh);
  } catch (err) {
    console.error("Error in /api/news:", err.message, err.stack);
    console.error("Error in /api/news", err);
    // If rebuild fails, return whatever we have cached
    const data = getCachedNews();
    if (data) return res.json(data);
    return res.status(500).json({ error: "Failed to load news." });
  }
});

app.get("/api/source-status", (req, res) => {
  res.json(getSourceStatus());
});

// ── Article translation endpoint (Claude Haiku + Supabase cache) ──────────────
const SUPPORTED_LANGS = { ml: "Malayalam", ar: "Arabic", hi: "Hindi", tl: "Filipino/Tagalog" };

app.post("/api/translate", async (req, res) => {
  try {
    const { articleUrl, lang, headline, summary, residentImpact } = req.body || {};
    if (!articleUrl || !lang) return res.status(400).json({ error: "Missing articleUrl or lang" });
    if (!SUPPORTED_LANGS[lang]) return res.status(400).json({ error: "Unsupported language" });

    // 1. Check Supabase cache
    const { data: cached } = await _supabase
      .from("article_translations")
      .select("headline, summary, resident_impact")
      .eq("article_url", articleUrl)
      .eq("lang", lang)
      .maybeSingle();

    if (cached) return res.json({ headline: cached.headline, summary: cached.summary, resident_impact: cached.resident_impact });

    // 2. Translate with Claude Haiku
    const langName = SUPPORTED_LANGS[lang];
    const prompt = `Translate the following UAE news content into ${langName}.
Return ONLY valid JSON with no extra text:
{"headline":"...","summary":"...","resident_impact":"..."}

Headline: ${String(headline || "").slice(0, 200)}
Summary: ${String(summary || "").slice(0, 400)}
Resident impact: ${String(residentImpact || "")}`;

    const msg = await _anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = (msg.content?.[0]?.text || "").replace(/^```json\s*|```$/gm, "").trim();
    let translated;
    try { translated = JSON.parse(raw); } catch {
      // Fallback: return original if parse fails
      return res.json({ headline: headline || "", summary: summary || "", resident_impact: residentImpact || null });
    }

    const result = {
      headline: translated.headline || headline || "",
      summary: translated.summary || summary || "",
      resident_impact: translated.resident_impact || residentImpact || null,
    };

    // 3. Cache in Supabase
    await _supabase.from("article_translations").upsert({
      article_url: articleUrl,
      lang,
      headline: result.headline,
      summary: result.summary,
      resident_impact: result.resident_impact,
    });

    return res.json(result);
  } catch (err) {
    console.error("/api/translate error:", err.message);
    return res.status(500).json({ error: "Translation failed" });
  }
});

app.get("/api/image", async (req, res) => {
  const url = String(req.query.url || "").trim();
  if (!url) return res.status(400).end();

  // Try native fetch first, then curl as fallback
  try {
    const upstream = await fetch(url, {
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "accept": "image/*,*/*;q=0.8",
        "referer": new URL(url).origin + "/",
      },
    });
    if (!upstream.ok) throw new Error(`HTTP ${upstream.status}`);
    const contentType = upstream.headers.get("content-type") || "image/jpeg";
    res.set("Content-Type", contentType);
    res.set("Cache-Control", "public, max-age=3600");
    const buffer = Buffer.from(await upstream.arrayBuffer());
    return res.send(buffer);
  } catch {
    // Fallback to curl
    try {
      const { execFile } = await import("child_process");
      const { promisify } = await import("util");
      const execFileAsync = promisify(execFile);
      const { stdout } = await execFileAsync(
        "curl.exe",
        ["-L", "-s", "--compressed", "--http1.1", "-o", "-",
         "-A", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
         "-H", "Accept: image/*,*/*;q=0.8",
         "-H", `Referer: ${new URL(url).origin}/`,
         url],
        { maxBuffer: 10 * 1024 * 1024, encoding: "buffer" }
      );
      const ext = url.split("?")[0].split(".").pop().toLowerCase();
      const mimeMap = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml" };
      res.set("Content-Type", mimeMap[ext] || "image/jpeg");
      res.set("Cache-Control", "public, max-age=3600");
      return res.send(stdout);
    } catch {
      return res.status(502).end();
    }
  }
});

// Fetch and summarize full article content
async function fetchAndSummarizeArticle(article) {
  if (!article || !article.url) return article;
  
  try {
    const response = await fetch(article.url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      timeout: 10000,
    });
    
    if (!response.ok) return article;
    
    const html = await response.text();
    const $ = load(html);
    
    // Extract all paragraph text
    const paragraphs = [];
    $('p, article p, main p, .content p, .article-content p').each((i, el) => {
      const text = $(el).text().trim();
      if (text.length > 50) paragraphs.push(text);
    });
    
    // If still no paragraphs, try general divs
    if (paragraphs.length === 0) {
      $('div').each((i, el) => {
        const text = $(el).text().trim();
        if (text.length > 100 && text.length < 500) paragraphs.push(text);
      });
    }
    
    if (paragraphs.length === 0) return article;
    
    // Join first 3-4 paragraphs to create a detailed summary
    const fullSummary = paragraphs.slice(0, 4).join(' ');
    
    if (fullSummary.length > 150) {
      // Apply calm tone to the summary
      const calmified = calmifyArticle({ ...article, description: fullSummary });
      const summarizedText = calmified.calmSummary || fullSummary;
      return { ...article, summarizedContent: summarizedText };
    }
  } catch (e) {
    console.log(`Failed to fetch article ${article.url}: ${e.message}`);
  }
  
  return article;
}

app.get("/api/article", async (req, res) => {
  try {
    const id = String(req.query.id || "").trim();
    if (!id) return res.status(400).json({ error: "Missing id" });

    // Ensure we have at least one cache build
    if (!getCachedNews()) {
      await buildNewsCache({ force: true });
    } else {
      buildNewsCache({ force: false }).catch(() => {});
    }

    let article = getCachedArticleById(id);
    if (!article) return res.status(404).json({ error: "Not found" });
    
    // Fetch and summarize full article content
    article = await fetchAndSummarizeArticle(article);
    
    return res.json(article);
  } catch (err) {
    return res.status(500).json({ error: "Failed to load article." });
  }
});

async function sendWelcomeEmail({ email, topics, timing }) {
  if (!RESEND_API_KEY) return;
  const topicsList = topics.length ? topics.map(prettyTopic) : ["All Topics"];
  const timingList = timing.length ? timing.map(prettyTiming) : ["Morning Digest (7:00 AM GST)", "Evening Digest (8:00 PM GST)"];
  const nextTime = nextScheduledTimeLabel(timing);
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;color:#1A1208;">
      <div style="padding:18px 0;border-bottom:1px solid #eee;font-weight:700;font-size:18px;">Central Watch News 🇦🇪</div>
      <h2 style="font-family:'Playfair Display',Georgia,serif;margin:18px 0 8px;">You're subscribed!</h2>
      <p style="margin:0 0 12px;">Welcome to calm UAE updates from CWN.</p>
      <p style="margin:0 0 6px;"><strong>Topics:</strong> ${escapeHtml(topicsList.join(", "))}</p>
      <p style="margin:0 0 6px;"><strong>Timing:</strong> ${escapeHtml(timingList.join(", "))}</p>
      <p style="margin:0 0 16px;">Your first digest will arrive ${escapeHtml(nextTime)}.</p>
      <a href="${APP_BASE_URL}" style="display:inline-block;background:#C8102E;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px;">Read CWN</a>
      <p style="margin-top:18px;color:#666;font-size:12px;">Unsubscribe anytime.</p>
    </div>`;
  const text = `Central Watch News\n\nYou're subscribed!\nTopics: ${topicsList.join(", ")}\nTiming: ${timingList.join(", ")}\nYour first digest will arrive ${nextTime}.\n\n${APP_BASE_URL}\n\nUnsubscribe anytime.`;
  await sendResendEmail({
    to: email,
    subject: "Welcome to Central Watch News 🇦🇪",
    html,
    text,
  });
}

// endpoint for subscribing email notifications
app.post("/api/subscribe", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const topics = normalizeTopics(req.body.topics);
    const timing = normalizeTiming(req.body.timing?.length ? req.body.timing : ["morning", "evening"]);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return res.status(400).json({ error: "Invalid email" });
    }
    const existing = subscribers.find((s) => s.email === email);
    if (existing) {
      return res.json({ status: "exists", message: "You're already subscribed!" });
    } else {
      const entry = {
        email,
        topics,
        timing,
        subscribedAt: new Date().toISOString(),
        active: true,
      };
      subscribers.push(entry);
      console.log("New subscriber", email, "topics:", topics.length ? topics.join(",") : "all");
      saveSubscribers();
      try {
        await sendWelcomeEmail(entry);
      } catch (err) {
        console.error("Welcome email failed:", err.message);
      }
    }
    return res.json({ status: "ok" });
  } catch (err) {
    return res.status(500).json({ error: "Failed to subscribe" });
  }
});

app.use('/api/community', communityRouter);
app.get('/article/:id', (req, res) => res.sendFile(path.join(__dirname, 'article-view.html')));
app.use('/article', articleRouter);

app.listen(PORT, async () => {
  console.log(`Clockwork News server running at http://localhost:${PORT}`);
  
  // Prime cache on startup
  console.log('Priming cache on startup...');
  try {
    await buildNewsCache({ force: true });
    console.log('Cache primed successfully on startup');
  } catch (err) {
    console.error('Error priming cache on startup:', err.message);
  }

  try {
    await maybeSendScheduledDigests();
  } catch (err) {
    console.error("Initial digest check error:", err.message);
  }

  // Run background rebuild every 30 seconds
  setInterval(async () => {
    console.log('Triggering scheduled background rebuild...');
    try {
      await buildNewsCache({ force: false });
      console.log('Scheduled background rebuild completed');
    } catch (err) {
      console.error('Error in scheduled background rebuild:', err.message);
    }
  }, 30000); // 30 seconds

  // Check Dubai-time digest schedule every 30 seconds
  setInterval(async () => {
    try {
      await maybeSendScheduledDigests();
    } catch (err) {
      console.error("Digest scheduler error:", err.message);
    }
  }, 30000);
});

