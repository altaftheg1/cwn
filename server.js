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
import cron from "node-cron";

if (!process.env.SUPABASE_URL) console.warn('WARNING: SUPABASE_URL not set — database features disabled');
if (!process.env.SUPABASE_KEY) console.warn('WARNING: SUPABASE_KEY not set — database features disabled');
if (!process.env.CLAUDE_API_KEY) console.warn('WARNING: CLAUDE_API_KEY not set — AI features disabled');

const _supabase = createSupabaseClient(
  process.env.SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_KEY || 'placeholder'
);
const _anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY || 'placeholder' });
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
let digestState = { morningDate: "", eveningDate: "", weeklyDate: "", breakingLastMs: 0 };

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
  console.log(`[Resend] Sending to: ${to} | from: ${RESEND_FROM} | subject: ${subject}`);
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
  const body = await response.text().catch(() => "");
  console.log(`[Resend] Status: ${response.status} | Body: ${body}`);
  if (!response.ok) {
    throw new Error(`Resend ${response.status}: ${body}`);
  }
  return body;
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

// ── Unsubscribe link helper ──────────────────────────────────────────────────
function unsubLink(email) {
  return `${APP_BASE_URL}/unsubscribe?email=${encodeURIComponent(email)}`;
}

// ── Get stories for a digest window ──────────────────────────────────────────
function getDigestStories({ fromMs, toMs, topics, limit = 5 }) {
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
    .slice(0, limit);
}

// ── Rich digest email builders ────────────────────────────────────────────────
function buildDigestHtml({ greeting, stories, recipientEmail, dateStr }) {
  const unsub = unsubLink(recipientEmail);
  const storyItems = stories.map((s) => {
    const title   = escapeHtml(s.calmTitle || s.title || "Update");
    const summary = escapeHtml(s.calmSummary || s.description || "");
    const impact  = s.residentImpact ? escapeHtml(s.residentImpact) : "";
    const source  = escapeHtml(s.sourceName || "");
    const url     = `${APP_BASE_URL}/article.html?id=${encodeURIComponent(s.id)}`;
    return `
    <div style="border-bottom:1px solid #E8E4DF;padding:20px 0;">
      ${source ? `<div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#C8102E;font-weight:700;margin-bottom:8px;font-family:Arial,sans-serif;">${source}</div>` : ""}
      <h3 style="font-family:Georgia,serif;font-size:18px;color:#1A1208;margin:0 0 10px;line-height:1.35;font-weight:700;">${title}</h3>
      <p style="color:#3D3328;font-size:14px;line-height:1.6;margin:0 0 12px;">${summary}</p>
      ${impact ? `<div style="background:#F7F4EF;border-left:3px solid #C8102E;padding:10px 14px;font-size:13px;color:#444;margin:0 0 12px;"><strong>What this means for you:</strong> ${impact}</div>` : ""}
      <a href="${url}" style="color:#C8102E;font-size:13px;font-weight:700;text-decoration:none;">Read full story &rarr;</a>
    </div>`;
  }).join("");

  return `<!DOCTYPE html>
<html><body style="margin:0;padding:20px;background:#F7F4EF;font-family:Arial,sans-serif;">
<div style="max-width:600px;margin:0 auto;">
  <div style="background:#C8102E;border-radius:12px 12px 0 0;padding:22px 24px;text-align:center;">
    <div style="color:white;font-size:22px;font-weight:900;letter-spacing:2px;font-family:Georgia,serif;">TheDubaiBrief</div>
    <p style="color:rgba(255,255,255,0.8);font-size:12px;margin:4px 0 0;">TheDubaiBrief</p>
  </div>
  <div style="background:#1A1208;padding:18px 24px;">
    <h1 style="color:white;font-size:20px;font-family:Georgia,serif;margin:0 0 4px;">${escapeHtml(greeting)}</h1>
    <p style="color:rgba(255,255,255,0.5);font-size:12px;margin:0;">${escapeHtml(dateStr)}</p>
  </div>
  <div style="background:white;padding:8px 24px 8px;">
    ${storyItems || '<p style="color:#888;padding:24px 0;text-align:center;">No new stories in your selected topics yet. Check back soon.</p>'}
  </div>
  <div style="background:white;border-top:1px solid #E8E4DF;padding:20px 24px;text-align:center;">
    <a href="${APP_BASE_URL}" style="display:inline-block;background:#C8102E;color:white;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:700;font-size:14px;">Read all stories on TheDubaiBrief &rarr;</a>
  </div>
  <div style="background:#F7F4EF;border-radius:0 0 12px 12px;padding:18px 24px;text-align:center;border-top:1px solid #E8E4DF;">
    <p style="font-size:13px;color:#888;margin:0 0 6px;">
      <a href="https://buymeacoffee.com/cwn" style="color:#C8102E;text-decoration:none;font-weight:600;">&curren; Support TheDubaiBrief</a>
    </p>
    <p style="font-size:11px;color:#aaa;margin:0;">
      <a href="${unsub}" style="color:#aaa;">Unsubscribe</a> &nbsp;&middot;&nbsp;
      <a href="${APP_BASE_URL}/privacy.html" style="color:#aaa;">Privacy Policy</a>
      &nbsp;&middot;&nbsp; TheDubaiBrief &middot; Dubai, UAE
    </p>
  </div>
</div>
</body></html>`;
}

function buildDigestText({ greeting, stories, recipientEmail, dateStr }) {
  const unsub = unsubLink(recipientEmail);
  const items = stories.map((s, i) => {
    const title   = s.calmTitle || s.title || "Update";
    const summary = s.calmSummary || s.description || "";
    const url     = `${APP_BASE_URL}/article.html?id=${encodeURIComponent(s.id)}`;
    return `${i + 1}. ${title}\n${summary}\n${url}`;
  }).join("\n\n");
  return `${greeting}\nTheDubaiBrief · Dubai, UAE\n${dateStr}\n\n${items}\n\n---\nRead all: ${APP_BASE_URL}\nSupport TheDubaiBrief: https://buymeacoffee.com/cwn\nUnsubscribe: ${unsub}`;
}

// ── Dispatch a digest slot to all matching active subscribers ─────────────────
async function sendDigestToSubscribers({ slotKey, greeting, subject, fromMs, toMs }) {
  if (!RESEND_API_KEY) { console.log(`[Digest:${slotKey}] No RESEND_API_KEY — skipping.`); return; }
  const active = subscribers.filter((s) => s.active !== false);
  if (!active.length) { console.log(`[Digest:${slotKey}] No active subscribers.`); return; }

  const parts   = getDubaiParts();
  const dateStr = new Date().toLocaleDateString("en-GB", {
    timeZone: "Asia/Dubai", weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
  let sent = 0, skipped = 0, failed = 0;

  for (const sub of active) {
    const timings = normalizeTiming(sub.timing);
    // Default (no preference saved) → gets morning + evening
    const wantsSlot = timings.length === 0
      ? ["morning", "evening"].includes(slotKey)
      : timings.includes(slotKey);
    if (!wantsSlot) { skipped++; continue; }

    const limit   = slotKey === "weekly" ? 10 : 5;
    const stories = getDigestStories({ fromMs, toMs, topics: sub.topics, limit });
    if (!stories.length) { skipped++; continue; }

    const html = buildDigestHtml({ greeting, stories, recipientEmail: sub.email, dateStr });
    const text = buildDigestText({ greeting, stories, recipientEmail: sub.email, dateStr });
    try {
      await sendResendEmail({ to: sub.email, subject, html, text });
      sent++;
    } catch (err) {
      failed++;
      console.error(`[Digest:${slotKey}] Failed for ${sub.email}:`, err.message);
    }
  }
  console.log(`[Digest:${slotKey}] sent=${sent} skipped=${skipped} failed=${failed}`);
}

// ── Cron-based scheduler (all times UTC, Dubai = UTC+4) ───────────────────────
// Morning digest — 7:00 AM Dubai = 03:00 UTC
cron.schedule("0 3 * * *", async () => {
  console.log("[Cron] Morning digest starting…");
  const now = Date.now();
  await sendDigestToSubscribers({
    slotKey: "morning",
    greeting: "Good Morning, UAE 🇦🇪",
    subject:  "TheDubaiBrief Morning Digest 🇦🇪",
    fromMs: now - 12 * 60 * 60 * 1000,
    toMs: now,
  });
}, { timezone: "UTC" });

// Evening digest — 8:00 PM Dubai = 16:00 UTC
cron.schedule("0 16 * * *", async () => {
  console.log("[Cron] Evening digest starting…");
  const parts = getDubaiParts();
  await sendDigestToSubscribers({
    slotKey: "evening",
    greeting: "Good Evening, UAE 🇦🇪",
    subject:  "TheDubaiBrief Evening Digest 🇦🇪",
    fromMs: dubaiLocalToUtcMs(parts.year, parts.month, parts.day, 0, 0, 0),
    toMs: Date.now(),
  });
}, { timezone: "UTC" });

// Weekly digest — Friday 9:00 AM Dubai = Friday 05:00 UTC
cron.schedule("0 5 * * 5", async () => {
  console.log("[Cron] Weekly digest starting…");
  const now = Date.now();
  await sendDigestToSubscribers({
    slotKey: "weekly",
    greeting: "Your Weekly UAE News Roundup 🇦🇪",
    subject:  "TheDubaiBrief Weekly Summary — Top Stories This Week",
    fromMs: now - 7 * 24 * 60 * 60 * 1000,
    toMs: now,
  });
}, { timezone: "UTC" });

// Breaking news check — every 5 minutes
cron.schedule("*/5 * * * *", async () => {
  if (!RESEND_API_KEY) return;
  const BREAKING_COOLDOWN_MS = 60 * 60 * 1000; // max 1 breaking alert per hour
  if (Date.now() - (digestState.breakingLastMs || 0) < BREAKING_COOLDOWN_MS) return;
  const items    = getCachedNews()?.items || [];
  const cutoffMs = Date.now() - 5 * 60 * 1000;
  const urgent   = items.filter((i) => Number(i.publishedAtMs || 0) > cutoffMs && i.severity === "high");
  if (!urgent.length) return;
  console.log(`[Cron] Breaking: ${urgent.length} urgent item(s) found — alerting subscribers`);
  const now = Date.now();
  await sendDigestToSubscribers({
    slotKey: "breaking",
    greeting: "🚨 Breaking UAE Update",
    subject:  `Breaking: ${urgent[0].calmTitle || urgent[0].title || "Urgent UAE Update"} — CWN`,
    fromMs: cutoffMs,
    toMs: now,
  });
  digestState.breakingLastMs = now;
  saveDigestState();
}, { timezone: "UTC" });

// Health check FIRST — before all middleware so it always responds
app.get('/healthz', (req, res) => res.status(200).send('ok'));

app.use(cors());
app.use(express.json({ limit: "30mb" })); // 30mb needed for base64-encoded video uploads

// Root → main page
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'uae-calm-uae-news.html')));

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

// ── Archive: query all historical articles from Supabase ──────────────────────
app.get("/api/archive", async (req, res) => {
  try {
    const { q, category, source, date, page = "1" } = req.query;
    const PAGE_SIZE = 20;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const offset = (pageNum - 1) * PAGE_SIZE;

    let query = _supabase
      .from("articles")
      .select("id, url, original_title, calm_headline, summary, resident_impact, category, source, image_url, published_at, created_at", { count: "exact" })
      .order("published_at", { ascending: false, nullsFirst: false })
      .range(offset, offset + PAGE_SIZE - 1);

    if (q && q.trim()) {
      const safe = q.trim();
      query = query.or(
        `calm_headline.ilike.%${safe}%,original_title.ilike.%${safe}%,summary.ilike.%${safe}%`
      );
    }
    if (category && category !== "all") query = query.eq("category", category);
    if (source && source.trim()) query = query.ilike("source", `%${source.trim()}%`);
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      const dayStart = new Date(date + "T00:00:00Z").toISOString();
      const dayEnd   = new Date(date + "T23:59:59Z").toISOString();
      query = query.gte("published_at", dayStart).lte("published_at", dayEnd);
    }

    const { data, count, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    res.json({ articles: data || [], total: count || 0, page: pageNum, pageSize: PAGE_SIZE });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Live visitor tracking ─────────────────────────────────────────────────────
const activeSessions = new Map(); // sessionId → lastSeenMs
const VISITOR_TTL_MS = 60 * 1000; // 60s — session expires if no ping received

function pruneVisitors() {
  const now = Date.now();
  for (const [id, t] of activeSessions) {
    if (now - t > VISITOR_TTL_MS) activeSessions.delete(id);
  }
}

app.post("/api/ping", (req, res) => {
  const sid = String(req.body?.sid || "").trim().slice(0, 128);
  pruneVisitors();
  if (sid) activeSessions.set(sid, Date.now());
  res.json({ visitors: activeSessions.size });
});

app.get("/api/visitors", (req, res) => {
  pruneVisitors();
  res.json({ visitors: activeSessions.size });
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
  if (!RESEND_API_KEY) {
    console.warn("[Email] No RESEND_API_KEY — welcome email skipped for", email);
    return;
  }
  const topicsList = topics.length ? topics.map(prettyTopic) : ["All Topics"];
  const timingList = timing.length ? timing.map(prettyTiming) : ["Morning Digest (7:00 AM GST)", "Evening Digest (8:00 PM GST)"];
  const nextTime   = nextScheduledTimeLabel(timing);
  const unsub      = unsubLink(email);

  const html = `<!DOCTYPE html>
<html><body style="font-family:Georgia,serif;max-width:600px;margin:0 auto;background:#F7F4EF;padding:40px 20px;">
  <div style="text-align:center;margin-bottom:32px;">
    <div style="background:#C8102E;color:white;display:inline-block;padding:12px 24px;font-size:24px;font-weight:900;letter-spacing:2px;">TheDubaiBrief</div>
    <p style="color:#666;font-size:13px;margin-top:8px;">TheDubaiBrief</p>
  </div>
  <h1 style="font-size:28px;color:#1A1208;text-align:center;margin-bottom:8px;">You're all set! 🇦🇪</h1>
  <p style="text-align:center;color:#666;margin-bottom:32px;">UAE news — calm, clear, and in plain English.</p>
  <div style="background:white;border-radius:12px;padding:24px;margin-bottom:24px;">
    <h2 style="font-size:16px;color:#1A1208;margin-bottom:16px;">Your subscription summary:</h2>
    <p style="color:#444;margin-bottom:8px;">📋 Topics: ${escapeHtml(topicsList.join(", "))}</p>
    <p style="color:#444;margin-bottom:8px;">🕐 Timing: ${escapeHtml(timingList.join(", "))}</p>
    <p style="color:#444;">📧 Email: ${escapeHtml(email)}</p>
  </div>
  <div style="background:#C8102E;border-radius:12px;padding:24px;margin-bottom:24px;text-align:center;">
    <p style="color:white;font-size:15px;margin-bottom:16px;">"No panic. No agenda. Just clear UAE news for residents."</p>
    <a href="${APP_BASE_URL}" style="background:white;color:#C8102E;padding:12px 24px;border-radius:6px;font-weight:700;text-decoration:none;font-size:14px;">Read Today's News &rarr;</a>
  </div>
  <p style="text-align:center;color:#999;font-size:12px;">
    Your first digest arrives ${escapeHtml(nextTime)}.<br><br>
    <a href="${unsub}" style="color:#aaa;">Unsubscribe anytime</a><br><br>
    TheDubaiBrief &middot; Dubai, UAE 🇦🇪
  </p>
</body></html>`;

  const text = `TheDubaiBrief

You're all set!

Topics: ${topicsList.join(", ")}
Timing: ${timingList.join(", ")}
Email: ${email}

Your first digest arrives ${nextTime}.

Read Today's News: ${APP_BASE_URL}
Unsubscribe: ${unsub}`;

  await sendResendEmail({
    to: email,
    subject: "Welcome to TheDubaiBrief 🇦🇪",
    html,
    text,
  });
}

// ── Unsubscribe confirmation email ────────────────────────────────────────────
async function sendUnsubscribeConfirmEmail(email) {
  if (!RESEND_API_KEY) return;
  const resubUrl = `${APP_BASE_URL}/uae-calm-uae-news.html`;
  const html = `<!DOCTYPE html>
<html><body style="font-family:Georgia,serif;max-width:600px;margin:0 auto;background:#F7F4EF;padding:40px 20px;text-align:center;">
  <div style="margin-bottom:24px;">
    <div style="background:#C8102E;color:white;display:inline-block;padding:10px 22px;font-size:22px;font-weight:900;letter-spacing:2px;">TheDubaiBrief</div>
  </div>
  <h1 style="font-size:24px;color:#1A1208;">You've been unsubscribed</h1>
  <p style="color:#666;margin:16px 0 28px;">You won't receive any more emails from TheDubaiBrief.</p>
  <a href="${resubUrl}" style="display:inline-block;background:#C8102E;color:white;padding:12px 24px;border-radius:6px;font-weight:700;text-decoration:none;font-size:14px;">Changed your mind? Resubscribe here</a>
  <p style="color:#aaa;font-size:12px;margin-top:28px;">TheDubaiBrief &middot; Dubai, UAE</p>
</body></html>`;
  const text = `You've been unsubscribed from TheDubaiBrief.

You won't receive any more emails.

Changed your mind? Visit: ${resubUrl}`;
  await sendResendEmail({ to: email, subject: "You've been unsubscribed from TheDubaiBrief", html, text });
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

// ── GET /unsubscribe ──────────────────────────────────────────────────────────
app.get("/unsubscribe", async (req, res) => {
  const email = String(req.query.email || "").trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).sendFile(path.join(__dirname, "unsubscribe.html"));
  }
  const sub = subscribers.find((s) => s.email === email);
  if (sub && sub.active !== false) {
    sub.active = false;
    saveSubscribers();
    console.log("[Unsubscribe] Deactivated:", email);
    sendUnsubscribeConfirmEmail(email).catch((e) =>
      console.error("[Unsub confirm email failed]", e.message)
    );
  }
  res.sendFile(path.join(__dirname, "unsubscribe.html"));
});

// ── POST /api/resubscribe ─────────────────────────────────────────────────────
app.post("/api/resubscribe", (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const sub = subscribers.find((s) => s.email === email);
  if (!sub) return res.status(404).json({ error: "Subscriber not found." });
  sub.active = true;
  saveSubscribers();
  console.log("[Resubscribe] Reactivated:", email);
  res.json({ status: "ok" });
});
app.get('/article/:id', (req, res) => res.sendFile(path.join(__dirname, 'article-view.html')));
app.use('/article', articleRouter);
app.get('/archive', (req, res) => res.sendFile(path.join(__dirname, 'archive.html')));

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`TheDubaiBrief server running on port ${PORT}`);
  
  // Prime cache on startup
  console.log('Priming cache on startup...');
  try {
    await buildNewsCache({ force: true });
    console.log('Cache primed successfully on startup');
  } catch (err) {
    console.error('Error priming cache on startup:', err.message);
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

  // Digest scheduling handled by node-cron (see cron.schedule calls above)
});

