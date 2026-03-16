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
import Stripe from "stripe";

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

const SUB_FILE = path.join(__dirname, "subscribers.json");
const DIGEST_STATE_FILE = path.join(__dirname, "digest-state.json");
let subscribers = [];
let digestState = { dailyDate: "", lastStoryId: "", eveningDate: "", lastEveningStoryId: "" };
let emailLogs = []; // { storyId, sentAt, type: 'morning'|'evening' }

const SUBJECT_TEMPLATES = [
  "The biggest story today",
  "This is the one story everyone is talking about",
  "Today's most important news",
  "You shouldn't miss this story today",
  "Here's the story dominating the news today",
  "One story you need to read today",
  "The top story from the UAE right now",
];

function randomSubject() {
  return SUBJECT_TEMPLATES[Math.floor(Math.random() * SUBJECT_TEMPLATES.length)];
}

function loadSubscribers() {
  try {
    const raw = JSON.parse(fs.readFileSync(SUB_FILE, "utf8"));
    if (!Array.isArray(raw)) throw new Error("Invalid subscribers file");
    subscribers = raw
      .map((entry) => {
        if (typeof entry === "string") {
          return { email: entry.toLowerCase(), subscribedAt: new Date().toISOString(), active: true };
        }
        if (!entry || typeof entry !== "object") return null;
        const email = String(entry.email || "").trim().toLowerCase();
        if (!email) return null;
        return {
          email,
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
      dailyDate: String(raw.dailyDate || ""),
      lastStoryId: String(raw.lastStoryId || ""),
      eveningDate: String(raw.eveningDate || ""),
      lastEveningStoryId: String(raw.lastEveningStoryId || ""),
    };
    emailLogs = Array.isArray(raw.emailLogs) ? raw.emailLogs : [];
  } catch {
    digestState = { dailyDate: "", lastStoryId: "", eveningDate: "", lastEveningStoryId: "" };
    emailLogs = [];
  }
}

function saveDigestState() {
  try { fs.writeFileSync(DIGEST_STATE_FILE, JSON.stringify({ ...digestState, emailLogs }, null, 2)); } catch {}
}

function wasStoryRecentlySent(storyId) {
  // Avoid sending the same story twice — check last 20 sends
  const recent = emailLogs.slice(-20);
  return recent.some(l => l.storyId === storyId);
}

function logEmailSent(storyId, type) {
  emailLogs.push({ storyId, sentAt: new Date().toISOString(), type });
  // Keep only last 100 entries
  if (emailLogs.length > 100) emailLogs = emailLogs.slice(-100);
}

function getTopStoryForSend(excludeIds = []) {
  const items = getCachedNews()?.items || [];
  if (!items.length) return null;
  const PRIORITY_ORDER = ["Breaking News", "Sports", "Politics", "Dubai News", "Abu Dhabi News", "Economy & Business", "Technology", "UAE Government"];
  const sorted = [...items].sort((a, b) => {
    const catA = a.category || a.topic || '';
    const catB = b.category || b.topic || '';
    const topicA = PRIORITY_ORDER.indexOf(catA);
    const topicB = PRIORITY_ORDER.indexOf(catB);
    if (topicA !== topicB) return topicA - topicB;
    return Number(b.publishedAtMs || 0) - Number(a.publishedAtMs || 0);
  });
  // Skip any IDs that were recently sent
  const candidate = sorted.find(s => !excludeIds.includes(s.id)) || sorted[0];
  return candidate || null;
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

function escapeHtml(text) {
  return String(text || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// ── Unsubscribe link helper ──────────────────────────────────────────────────
function unsubLink(email) {
  return `${APP_BASE_URL}/unsubscribe?email=${encodeURIComponent(email)}`;
}

// ── Daily brief email builders ────────────────────────────────────────────────
function buildDailyBriefHtml({ story, recipientEmail, dateStr, sendType = "morning", emailSponsor = null }) {
  const unsub    = unsubLink(recipientEmail);
  const title    = escapeHtml(story.calmTitle || story.title || "Today's Top Story");
  const summary  = escapeHtml(story.calmSummary || story.description || "");
  const source   = escapeHtml(story.sourceName || "");
  const category = escapeHtml(story.topic ? story.topic.charAt(0).toUpperCase() + story.topic.slice(1) : "UAE News");
  const image    = story.image || story.imageUrl || "";
  const articleUrl = story.id ? `${APP_BASE_URL}/article?id=${encodeURIComponent(story.id)}` : APP_BASE_URL;
  const timeLabel = sendType === "evening" ? "🌆 Evening Edition" : "☀️ Morning Edition";
  const isBreaking = story.topic === "safety" || story.topic === "politics";

  // Resident impact — use calmified impact if available
  const impact = story.residentImpact || story.impact || "";

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F7F4EF;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F7F4EF;padding:24px 16px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

  <!-- Header -->
  <tr><td style="background:#C8102E;border-radius:12px 12px 0 0;padding:20px 28px;text-align:center;">
    <div style="color:white;font-size:24px;font-weight:900;letter-spacing:2px;font-family:Georgia,serif;margin-bottom:4px;">TheDubaiBrief</div>
    <div style="color:rgba(255,255,255,0.8);font-size:12px;letter-spacing:1px;font-weight:600;">${escapeHtml(timeLabel)} &nbsp;·&nbsp; ${escapeHtml(dateStr)}</div>
  </td></tr>

  <!-- Sponsor line (if applicable) -->
  ${emailSponsor ? `
  <tr><td style="background:#FAFAF9;border-bottom:1px solid #E8E4DF;padding:12px 28px;text-align:center;">
    <div style="font-size:11px;color:#AAA;letter-spacing:0.5px;margin-bottom:6px;">TODAY'S BRIEFING BROUGHT TO YOU BY</div>
    ${emailSponsor.logo_url ? `<img src="${escapeHtml(emailSponsor.logo_url)}" style="height:32px;margin-bottom:6px;display:inline-block;" alt="${escapeHtml(emailSponsor.company_name||'')}">` : ''}
    <div style="font-size:14px;font-weight:700;color:#1A1208;">${escapeHtml(emailSponsor.company_name||'')}</div>
    <div style="font-size:13px;color:#555;margin:4px 0;">${escapeHtml(emailSponsor.headline||'')}</div>
    <a href="${escapeHtml(emailSponsor.destination_url||'#')}" style="display:inline-block;background:#C8102E;color:white;padding:6px 16px;border-radius:6px;font-size:12px;font-weight:700;text-decoration:none;margin-top:6px;">${escapeHtml(emailSponsor.cta_text||'Learn More')} →</a>
  </td></tr>
  ` : ''}

  <!-- Hero image (if available) -->
  ${image ? `<tr><td style="padding:0;"><img src="${escapeHtml(image)}" alt="" width="600" style="display:block;width:100%;max-width:600px;height:280px;object-fit:cover;" /></td></tr>` : ""}

  <!-- Story body -->
  <tr><td style="background:#FFFFFF;padding:28px 32px 24px;">
    <!-- Category + source badges -->
    <div style="margin-bottom:14px;">
      <span style="display:inline-block;background:#FFF0F2;color:#C8102E;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;padding:4px 10px;border-radius:4px;margin-right:8px;">${category}</span>
      ${source ? `<span style="display:inline-block;color:#9A8E82;font-size:12px;">via ${source}</span>` : ""}
    </div>

    <!-- Headline -->
    <h1 style="font-family:Georgia,serif;font-size:28px;color:#1A1208;margin:0 0 18px;line-height:1.3;font-weight:700;">${title}</h1>

    <!-- Summary -->
    <p style="color:#3D3328;font-size:16px;line-height:1.75;margin:0 0 24px;font-family:Georgia,serif;">${summary}</p>

    ${impact ? `
    <!-- Resident impact box -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
    <tr><td style="background:#FFFBF0;border-left:4px solid #C8102E;border-radius:0 8px 8px 0;padding:14px 18px;">
      <div style="font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#C8102E;margin-bottom:6px;">What This Means For You</div>
      <div style="font-size:14px;color:#3D3328;line-height:1.6;">${escapeHtml(impact)}</div>
    </td></tr>
    </table>
    ` : ""}

    <!-- CTA -->
    <div style="text-align:center;padding-top:8px;">
      <a href="${articleUrl}" style="display:inline-block;background:#C8102E;color:white;text-decoration:none;padding:14px 36px;border-radius:8px;font-weight:700;font-size:15px;letter-spacing:0.3px;">Find more latest news &rarr;</a>
    </div>
  </td></tr>

  <!-- Footer -->
  <tr><td style="background:#F0EDE8;border-radius:0 0 12px 12px;padding:18px 28px;text-align:center;border-top:1px solid #E2DDD5;">
    <p style="font-size:11px;color:#AAA;margin:0;line-height:1.8;">
      You subscribed to TheDubaiBrief — Dubai news, served calm.<br>
      <a href="${unsub}" style="color:#C8102E;text-decoration:none;">Unsubscribe</a>
      &nbsp;·&nbsp; <a href="${APP_BASE_URL}/privacy.html" style="color:#AAA;text-decoration:none;">Privacy Policy</a>
      &nbsp;·&nbsp; TheDubaiBrief &middot; Dubai, UAE 🇦🇪
    </p>
  </td></tr>

</table>
</td></tr>
</table>
</body></html>`;
}

function buildDailyBriefText({ story, recipientEmail, dateStr, sendType = "morning" }) {
  const unsub   = unsubLink(recipientEmail);
  const title   = story.calmTitle || story.title || "Today's Top Story";
  const summary = story.calmSummary || story.description || "";
  const timeLabel = sendType === "evening" ? "Evening Edition" : "Morning Edition";
  return `TheDubaiBrief — ${timeLabel}\n${dateStr}\n\n${title}\n\n${summary}\n\nFind more latest news: ${APP_BASE_URL}\n\n---\nYou subscribed to TheDubaiBrief — Dubai news, served calm.\nUnsubscribe: ${unsub}`;
}

// ── Send daily brief to all active subscribers ────────────────────────────────
async function sendDailyBrief(sendType = "morning") {
  if (!RESEND_API_KEY) { console.log("[DailyBrief] No RESEND_API_KEY — skipping."); return; }
  const active = subscribers.filter((s) => s.active !== false);
  if (!active.length) { console.log("[DailyBrief] No active subscribers."); return; }

  // Avoid re-sending same story as any recent send
  const recentIds = emailLogs.slice(-20).map(l => l.storyId);
  const story = getTopStoryForSend(recentIds);
  if (!story) { console.log("[DailyBrief] No stories available — skipping."); return; }

  const dateStr = new Date().toLocaleDateString("en-GB", {
    timeZone: "Asia/Dubai", weekday: "long", day: "numeric", month: "long", year: "numeric",
  });

  // Get email sponsor if any
  let emailSponsor = null;
  if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
    try {
      const todayStr = formatDubaiDateKey(getDubaiParts());
      const { data: sponsorAds } = await _supabase.from('ads').select('*').eq('start_date', todayStr).eq('status', 'approved').eq('include_email_addon', true).limit(1);
      if (sponsorAds?.length) emailSponsor = sponsorAds[0];
    } catch (err) {
      console.error('[DailyBrief] Error fetching email sponsor:', err.message);
    }
  }

  // Subject: breaking stories get urgent tone, otherwise calm
  const isBreaking = story.topic === "safety" || story.topic === "politics";
  const subject = sendType === "evening"
    ? (isBreaking ? `🚨 Breaking tonight: ${story.calmTitle || story.title}`.slice(0, 78) : `🌆 Your evening brief — ${story.calmTitle || story.title}`.slice(0, 78))
    : (isBreaking ? `🚨 ${story.calmTitle || story.title}`.slice(0, 78) : `☀️ Your morning brief — ${story.calmTitle || story.title}`.slice(0, 78));

  let sent = 0, failed = 0;

  for (const sub of active) {
    const html = buildDailyBriefHtml({ story, recipientEmail: sub.email, dateStr, sendType, emailSponsor });
    const text = buildDailyBriefText({ story, recipientEmail: sub.email, dateStr, sendType });
    try {
      await sendResendEmail({ to: sub.email, subject, html, text });
      sent++;
    } catch (err) {
      failed++;
      console.error(`[DailyBrief] Failed for ${sub.email}:`, err.message);
    }
  }

  // Update state
  logEmailSent(story.id || "", sendType);
  const todayKey = formatDubaiDateKey(getDubaiParts());
  if (sendType === "evening") {
    digestState.lastEveningStoryId = story.id || "";
    digestState.eveningDate = todayKey;
  } else {
    digestState.lastStoryId = story.id || "";
    digestState.dailyDate   = todayKey;
  }
  saveDigestState();
  console.log(`[DailyBrief:${sendType}] sent=${sent} failed=${failed} story="${story.calmTitle || story.title}"`);
}

// ── Cron: 7:00 AM Dubai = 03:00 UTC ──────────────────────────────────────────
cron.schedule("0 3 * * *", async () => {
  console.log("[Cron] Morning brief starting…");
  const todayKey = formatDubaiDateKey(getDubaiParts());
  if (digestState.dailyDate === todayKey) {
    console.log("[Cron] Morning brief already sent today — skipping.");
    return;
  }
  await sendDailyBrief("morning");
}, { timezone: "UTC" });

// ── Cron: 8:00 PM Dubai = 16:00 UTC ──────────────────────────────────────────
cron.schedule("0 16 * * *", async () => {
  console.log("[Cron] Evening brief starting…");
  const todayKey = formatDubaiDateKey(getDubaiParts());
  if (digestState.eveningDate === todayKey) {
    console.log("[Cron] Evening brief already sent today — skipping.");
    return;
  }
  await sendDailyBrief("evening");
}, { timezone: "UTC" });

// Health check FIRST — before all middleware so it always responds
app.get('/healthz', (req, res) => res.status(200).send('ok'));

app.use(cors());

// ── Stripe webhook MUST be registered before express.json() middleware ─────────
// It needs the raw body buffer, not parsed JSON
app.post('/api/ads/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = _stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET || '');
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'payment_intent.succeeded') {
    const pi = event.data.object;
    const adId = pi.metadata?.adId;
    if (adId && process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
      await _supabase.from('ads').update({ status: 'pending', stripe_payment_id: pi.id }).eq('id', parseInt(adId));
      const { data: ad } = await _supabase.from('ads').select('*').eq('id', parseInt(adId)).single();
      if (ad) await sendAdReceivedEmail(ad);
    }
  }
  res.json({ received: true });
});

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

app.get('/api/government', (req, res) => {
  const items = getCachedNews()?.items || [];
  const govItems = items
    .filter(item => item.isGovSource || item.topic === 'UAE Government' || item.category === 'UAE Government')
    .slice(0, 20);
  res.json({ items: govItems });
});

app.get('/government', (req, res) => res.sendFile(path.join(__dirname, 'government.html')));

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

// ── Command Palette Search ────────────────────────────────────────────────────
// GET /api/palette-search?q=... — returns article results + optional AI answer
app.get("/api/palette-search", async (req, res) => {
  const q = String(req.query.q || "").trim().slice(0, 200);
  if (!q) return res.json({ articles: [], aiAnswer: null });
  try {
    // 1. Article search — last 30 days
    let articles = [];
    if (_supabase) {
      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const isSchool = /school|closure|holiday|reopen|khda|adek|exam|term/i.test(q);
      let query = _supabase
        .from("articles")
        .select("id, calm_headline, original_title, summary, source, published_at, category, image_url")
        .order("published_at", { ascending: false })
        .limit(8);
      if (isSchool) {
        query = query.or(
          `calm_headline.ilike.%school%,original_title.ilike.%school%,summary.ilike.%school%,category.eq.Education`
        ).gte("created_at", cutoff);
      } else {
        query = query.or(
          `calm_headline.ilike.%${q}%,original_title.ilike.%${q}%,summary.ilike.%${q}%`
        ).gte("created_at", cutoff);
      }
      const { data } = await query;
      articles = data || [];
    }

    // 2. AI smart answer — only for questions or complex queries (>3 words)
    let aiAnswer = null;
    const looksLikeQuestion = q.includes("?") || q.split(" ").length >= 3;
    if (looksLikeQuestion && process.env.CLAUDE_API_KEY) {
      try {
        const resp = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": process.env.CLAUDE_API_KEY,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 200,
            messages: [{
              role: "user",
              content: `You are a helpful assistant for TheDubaiBrief, a UAE news site. Answer this question in 2-3 calm, friendly sentences based on general knowledge about UAE. Never cause panic. Be warm and reassuring. Question: ${q}`
            }]
          }),
        });
        if (resp.ok) {
          const d = await resp.json();
          aiAnswer = d.content?.[0]?.text?.trim() || null;
        }
      } catch {}
    }

    res.json({ articles, aiAnswer });
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

async function sendWelcomeEmail({ email }) {
  if (!RESEND_API_KEY) {
    console.warn("[Email] No RESEND_API_KEY — welcome email skipped for", email);
    return;
  }
  const unsub = unsubLink(email);

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F7F4EF;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F7F4EF;padding:24px 16px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

  <!-- Header -->
  <tr><td style="background:#C8102E;border-radius:12px 12px 0 0;padding:28px 28px 24px;text-align:center;">
    <div style="color:white;font-size:26px;font-weight:900;letter-spacing:2px;font-family:Georgia,serif;margin-bottom:6px;">TheDubaiBrief</div>
    <div style="color:rgba(255,255,255,0.75);font-size:13px;letter-spacing:0.5px;">Dubai's news, served calm 🇦🇪</div>
  </td></tr>

  <!-- Body -->
  <tr><td style="background:#FFFFFF;padding:36px 32px 28px;text-align:center;">
    <div style="font-size:40px;margin-bottom:16px;">🎉</div>
    <h1 style="font-family:Georgia,serif;font-size:28px;color:#1A1208;margin:0 0 12px;line-height:1.2;">You're in!</h1>
    <p style="color:#3D3328;font-size:16px;line-height:1.7;margin:0 0 28px;">Welcome to TheDubaiBrief — the calmer way to stay informed about what's happening in the UAE.</p>

    <!-- Schedule info box -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
    <tr><td style="background:#FFF8F0;border:1px solid #F0E8DC;border-radius:10px;padding:20px 24px;text-align:left;">
      <div style="font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#9A8E82;margin-bottom:14px;">Your delivery schedule</div>
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="padding:6px 0;font-size:15px;color:#1A1208;">☀️ <strong>Morning</strong></td>
          <td style="padding:6px 0;font-size:14px;color:#7A6E62;text-align:right;">7:00 AM GST</td>
        </tr>
        <tr>
          <td style="padding:6px 0;font-size:15px;color:#1A1208;">🌆 <strong>Evening</strong></td>
          <td style="padding:6px 0;font-size:14px;color:#7A6E62;text-align:right;">8:00 PM GST</td>
        </tr>
      </table>
      <div style="font-size:13px;color:#9A8E82;margin-top:12px;">One top story per send — no noise, no panic.</div>
    </td></tr>
    </table>

    <!-- Quote -->
    <div style="border-left:3px solid #C8102E;padding:12px 18px;text-align:left;margin-bottom:28px;background:#FAFAF9;border-radius:0 6px 6px 0;">
      <p style="color:#3D3328;font-size:14px;font-style:italic;margin:0;line-height:1.6;">"No panic. No agenda. Just clear UAE news for residents who want to stay informed without the stress."</p>
    </div>

    <!-- CTA -->
    <a href="${APP_BASE_URL}" style="display:inline-block;background:#C8102E;color:white;text-decoration:none;padding:14px 36px;border-radius:8px;font-weight:700;font-size:15px;">Read Today's News &rarr;</a>
  </td></tr>

  <!-- Footer -->
  <tr><td style="background:#F0EDE8;border-radius:0 0 12px 12px;padding:18px 28px;text-align:center;border-top:1px solid #E2DDD5;">
    <p style="font-size:11px;color:#AAA;margin:0;line-height:1.8;">
      You subscribed to TheDubaiBrief — Dubai news, served calm.<br>
      <a href="${unsub}" style="color:#C8102E;text-decoration:none;">Unsubscribe anytime</a>
      &nbsp;·&nbsp; <a href="${APP_BASE_URL}/privacy.html" style="color:#AAA;text-decoration:none;">Privacy Policy</a>
      &nbsp;·&nbsp; TheDubaiBrief &middot; Dubai, UAE 🇦🇪
    </p>
  </td></tr>

</table>
</td></tr>
</table>
</body></html>`;

  const text = `TheDubaiBrief — Dubai's news, served calm 🇦🇪

You're in! Welcome to TheDubaiBrief.

Your delivery schedule:
  ☀️ Morning — 7:00 AM GST
  🌆 Evening — 8:00 PM GST

One top story per send — no noise, no panic.

Read Today's News: ${APP_BASE_URL}

---
Unsubscribe: ${unsub}
TheDubaiBrief · Dubai, UAE`;

  await sendResendEmail({
    to: email,
    subject: "Welcome to TheDubaiBrief 🇦🇪 — your calm UAE news",
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
  <p style="color:#aaa;font-size:12px;margin-top:28px;">DUB &middot; Dubai, UAE</p>
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
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return res.status(400).json({ error: "Invalid email" });
    }
    const existing = subscribers.find((s) => s.email === email);
    if (existing) {
      return res.json({ status: "exists", message: "You're already subscribed!" });
    }
    const entry = { email, subscribedAt: new Date().toISOString(), active: true };
    subscribers.push(entry);
    console.log("New subscriber", email);
    saveSubscribers();
    try {
      await sendWelcomeEmail(entry);
    } catch (err) {
      console.error("Welcome email failed:", err.message);
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
app.get('/article', (req, res) => res.sendFile(path.join(__dirname, 'article.html')));
app.get('/article/:id', (req, res) => res.sendFile(path.join(__dirname, 'article-view.html')));
app.use('/article', articleRouter);
app.get('/archive', (req, res) => res.sendFile(path.join(__dirname, 'archive.html')));
app.get('/support', (req, res) => res.sendFile(path.join(__dirname, 'support.html')));
app.get('/advertise', (req, res) => res.sendFile(path.join(__dirname, 'advertise.html')));
app.get('/admin-dub-2026', (req, res) => res.sendFile(path.join(__dirname, 'admin-dub-2026.html')));

// ── Advertising System ────────────────────────────────────────────────────────

const _stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '');

const AD_PACKAGES = {
  morning:   { name: 'Morning Spotlight ☀️',   price: 49, slot: '06:00-12:00' },
  afternoon: { name: 'Afternoon Spotlight 🌤️', price: 39, slot: '12:00-18:00' },
  evening:   { name: 'Evening Spotlight 🌆',   price: 44, slot: '18:00-00:00' },
  fullday:   { name: 'Full Day Bundle 🌟',      price: 99, slot: '06:00-00:00' },
};

function dbReady() {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_KEY);
}

// Check slot availability
async function checkSlotAvailability(startDate, packages) {
  if (!dbReady()) return { available: true };
  const { data } = await _supabase
    .from('ads')
    .select('packages, start_date')
    .eq('start_date', startDate)
    .in('status', ['pending', 'approved']);
  if (!data) return { available: true };

  const takenSlots = new Set(data.flatMap(a => a.packages || []));
  const conflicts = packages.filter(p =>
    takenSlots.has(p) ||
    (takenSlots.has('fullday') && p !== 'fullday') ||
    (p === 'fullday' && takenSlots.size > 0)
  );
  return conflicts.length ? { available: false, conflicts } : { available: true };
}

// Helper: upload base64 image to Supabase storage
async function uploadAdImage(base64data, filename) {
  if (!dbReady() || !base64data) return null;
  try {
    const base64 = base64data.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64, 'base64');
    const { data, error } = await _supabase.storage.from('ad-images').upload(`${Date.now()}-${filename}`, buffer, { contentType: 'image/jpeg', upsert: true });
    if (error) throw error;
    const { data: urlData } = _supabase.storage.from('ad-images').getPublicUrl(data.path);
    return urlData.publicUrl;
  } catch (err) {
    console.error('[ads] image upload failed:', err.message);
    return null;
  }
}

// POST /api/ads/create-payment
app.post('/api/ads/create-payment', async (req, res) => {
  try {
    const { companyName, contactName, email, phone, websiteUrl, packages, includeEmailAddon, headline, description, ctaText, destinationUrl, startDate, adImage, adLogo } = req.body;

    if (!companyName || !email || !packages?.length || !headline || !startDate) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Check availability
    const avail = await checkSlotAvailability(startDate, packages);
    if (!avail.available) return res.status(409).json({ error: `Time slot(s) already taken: ${avail.conflicts.join(', ')}. Please choose another date.` });

    // Calculate total
    let total = packages.reduce((s, p) => s + (AD_PACKAGES[p]?.price || 0), 0);
    if (includeEmailAddon) total += 29;

    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(500).json({ error: 'Payment system not configured' });
    }

    // Upload images
    const imageUrl = adImage ? await uploadAdImage(adImage, 'ad.jpg') : null;
    const logoUrl = adLogo ? await uploadAdImage(adLogo, 'logo.jpg') : null;

    // Store submission in Supabase
    const adRecord = {
      company_name: companyName, contact_name: contactName, email, phone: phone||null,
      website_url: websiteUrl||null, packages, include_email_addon: includeEmailAddon||false,
      headline, description, image_url: imageUrl, logo_url: logoUrl,
      cta_text: ctaText||'Learn More', destination_url: destinationUrl,
      start_date: startDate, status: 'pending_payment', amount_paid: total,
    };

    let adId = null;
    if (dbReady()) {
      const { data, error } = await _supabase.from('ads').insert(adRecord).select('id').single();
      if (error) console.error('[ads] insert error:', error.message);
      else adId = data.id;
    }

    // Create Stripe payment intent
    const paymentIntent = await _stripe.paymentIntents.create({
      amount: total * 100,
      currency: 'usd',
      metadata: { adId: String(adId || ''), companyName, email, packages: packages.join(','), startDate },
      receipt_email: email,
    });

    // Update ad with payment intent ID
    if (adId && dbReady()) {
      await _supabase.from('ads').update({ stripe_payment_id: paymentIntent.id }).eq('id', adId);
    }

    return res.json({
      clientSecret: paymentIntent.client_secret,
      stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
      adId,
    });
  } catch (err) {
    console.error('[ads] create-payment error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/ads/available — check availability for a date
app.get('/api/ads/available', async (req, res) => {
  const date = req.query.date;
  if (!date) return res.status(400).json({ error: 'Missing date' });
  if (!dbReady()) return res.json({ slots: { morning: true, afternoon: true, evening: true, fullday: true } });
  const { data } = await _supabase.from('ads').select('packages').eq('start_date', date).in('status', ['pending', 'approved']);
  const taken = new Set((data || []).flatMap(a => a.packages || []));
  return res.json({ slots: {
    morning:   !taken.has('morning')   && !taken.has('fullday'),
    afternoon: !taken.has('afternoon') && !taken.has('fullday'),
    evening:   !taken.has('evening')   && !taken.has('fullday'),
    fullday:   taken.size === 0,
  }});
});

// GET /api/ads/active — get currently active ad for homepage display
app.get('/api/ads/active', async (req, res) => {
  if (!dbReady()) return res.json({ ad: null });
  const today = new Date().toISOString().split('T')[0];
  const hour = parseInt(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Dubai', hour: 'numeric', hour12: false }).format(new Date()));

  let slot;
  if (hour >= 6 && hour < 12) slot = 'morning';
  else if (hour >= 12 && hour < 18) slot = 'afternoon';
  else slot = 'evening';

  const { data } = await _supabase.from('ads').select('*').eq('start_date', today).eq('status', 'approved').limit(20);
  if (!data?.length) return res.json({ ad: null });

  const active = data.find(a => a.packages?.includes(slot) || a.packages?.includes('fullday'));
  return res.json({ ad: active || null });
});

// Admin auth check
function checkAdminAuth(req) {
  const ts = parseInt(req.headers['x-admin-auth'] || '0', 10);
  return Date.now() - ts < 2 * 60 * 60 * 1000;
}

// POST /api/admin/auth
app.post('/api/admin/auth', (req, res) => {
  const { passcode } = req.body;
  const correct = process.env.ADMIN_PASSCODE || 'dub-admin-2026';
  if (passcode === correct) return res.json({ ok: true });
  return res.status(401).json({ ok: false });
});

// GET /api/admin/ads
app.get('/api/admin/ads', async (req, res) => {
  if (!checkAdminAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
  if (!dbReady()) return res.json({ ads: [] });
  const { data } = await _supabase.from('ads').select('*').order('created_at', { ascending: false }).limit(100);
  return res.json({ ads: data || [] });
});

// POST /api/admin/ads/:id/approve
app.post('/api/admin/ads/:id/approve', async (req, res) => {
  if (!checkAdminAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
  const id = parseInt(req.params.id);
  const { adminNotes } = req.body;
  if (!dbReady()) return res.status(500).json({ error: 'DB not configured' });
  const { data: ad } = await _supabase.from('ads').select('*').eq('id', id).single();
  if (!ad) return res.status(404).json({ error: 'Ad not found' });
  await _supabase.from('ads').update({ status: 'approved', admin_notes: adminNotes || null, approved_at: new Date().toISOString() }).eq('id', id);
  await sendAdApprovedEmail(ad);
  return res.json({ ok: true });
});

// POST /api/admin/ads/:id/reject
app.post('/api/admin/ads/:id/reject', async (req, res) => {
  if (!checkAdminAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
  const id = parseInt(req.params.id);
  const { reason } = req.body;
  if (!dbReady()) return res.status(500).json({ error: 'DB not configured' });
  const { data: ad } = await _supabase.from('ads').select('*').eq('id', id).single();
  if (!ad) return res.status(404).json({ error: 'Ad not found' });

  // Process Stripe refund
  if (ad.stripe_payment_id && process.env.STRIPE_SECRET_KEY) {
    try {
      await _stripe.refunds.create({ payment_intent: ad.stripe_payment_id });
      console.log('[ads] Refund processed for ad', id);
    } catch (err) {
      console.error('[ads] Refund failed:', err.message);
    }
  }

  await _supabase.from('ads').update({ status: 'rejected', admin_notes: reason || null, rejected_at: new Date().toISOString() }).eq('id', id);
  await sendAdRejectedEmail(ad, reason);
  return res.json({ ok: true });
});

// ── Ad emails ──────────────────────────────────────────────────────────────────

async function sendAdReceivedEmail(ad) {
  if (!RESEND_API_KEY) return;
  const pkgNames = (ad.packages || []).map(p => AD_PACKAGES[p]?.name || p).join(' + ');
  const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#F7F4EF;padding:32px 16px;">
<div style="background:#C8102E;border-radius:12px 12px 0 0;padding:24px;text-align:center;">
  <div style="color:white;font-size:22px;font-weight:900;font-family:Georgia,serif;">TheDubaiBrief</div>
  <div style="color:rgba(255,255,255,0.8);font-size:13px;margin-top:4px;">Advertising</div>
</div>
<div style="background:white;padding:32px;border-radius:0 0 12px 12px;">
  <h2 style="font-family:Georgia,serif;font-size:24px;color:#1A1208;margin:0 0 16px;">Ad request received! 🎉</h2>
  <p style="color:#3D3328;font-size:15px;line-height:1.7;margin:0 0 16px;">Hi ${escapeHtml(ad.contact_name || ad.company_name)},</p>
  <p style="color:#3D3328;font-size:15px;line-height:1.7;margin:0 0 24px;">We've received your ad request and payment. Here's what you booked:</p>
  <div style="background:#F7F4EF;border-radius:10px;padding:20px;margin-bottom:24px;">
    <div style="margin-bottom:8px;font-size:14px;"><strong>Package:</strong> ${escapeHtml(pkgNames)}</div>
    <div style="margin-bottom:8px;font-size:14px;"><strong>Date:</strong> ${escapeHtml(ad.start_date || '')}</div>
    <div style="font-size:14px;"><strong>Amount paid:</strong> $${ad.amount_paid}</div>
  </div>
  <p style="color:#3D3328;font-size:15px;line-height:1.7;margin:0 0 16px;">Your ad is currently <strong>under review</strong>. We'll get back to you within 24 hours.</p>
  <p style="color:#666;font-size:13px;margin:0;">If we cannot approve your ad, a full refund will be processed within 3-5 business days.</p>
  <p style="color:#666;font-size:13px;margin-top:16px;">Questions? Reply to this email.</p>
  <p style="color:#666;font-size:13px;margin-top:8px;">— TheDubaiBrief Team</p>
</div>
</body></html>`;
  await sendResendEmail({ to: ad.email, subject: 'TheDubaiBrief — Ad received, pending review', html, text: `Hi ${ad.contact_name},\n\nWe've received your ad and payment for ${pkgNames} on ${ad.start_date}.\n\nYour ad is under review. We'll reply within 24 hours.\n\nTheDubaiBrief Team` });
}

async function sendAdApprovedEmail(ad) {
  if (!RESEND_API_KEY) return;
  const pkgNames = (ad.packages || []).map(p => AD_PACKAGES[p]?.name || p).join(' + ');
  const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#F7F4EF;padding:32px 16px;">
<div style="background:#28a745;border-radius:12px 12px 0 0;padding:24px;text-align:center;">
  <div style="color:white;font-size:22px;font-weight:900;font-family:Georgia,serif;">TheDubaiBrief</div>
  <div style="color:rgba(255,255,255,0.8);font-size:13px;margin-top:4px;">Your ad has been approved! 🎉</div>
</div>
<div style="background:white;padding:32px;border-radius:0 0 12px 12px;">
  <h2 style="font-family:Georgia,serif;font-size:24px;color:#1A1208;margin:0 0 16px;">Great news, ${escapeHtml(ad.contact_name || ad.company_name)}!</h2>
  <p style="color:#3D3328;font-size:15px;line-height:1.7;margin:0 0 24px;">Your TheDubaiBrief ad has been approved and will go live on your scheduled date.</p>
  <div style="background:#F7F4EF;border-radius:10px;padding:20px;margin-bottom:24px;">
    <div style="margin-bottom:8px;font-size:14px;"><strong>Package:</strong> ${escapeHtml(pkgNames)}</div>
    <div style="margin-bottom:8px;font-size:14px;"><strong>Go-live date:</strong> ${escapeHtml(ad.start_date || '')}</div>
    <div style="font-size:14px;"><strong>Headline:</strong> ${escapeHtml(ad.headline || '')}</div>
  </div>
  <p style="color:#666;font-size:13px;">Questions? Reply to this email.</p>
  <p style="color:#666;font-size:13px;margin-top:8px;">— TheDubaiBrief Team</p>
</div>
</body></html>`;
  await sendResendEmail({ to: ad.email, subject: 'Your TheDubaiBrief ad has been approved! 🎉', html, text: `Hi ${ad.contact_name},\n\nYour ad has been approved! It goes live on ${ad.start_date}.\n\nTheDubaiBrief Team` });
}

async function sendAdRejectedEmail(ad, reason) {
  if (!RESEND_API_KEY) return;
  const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#F7F4EF;padding:32px 16px;">
<div style="background:#C8102E;border-radius:12px 12px 0 0;padding:24px;text-align:center;">
  <div style="color:white;font-size:22px;font-weight:900;font-family:Georgia,serif;">TheDubaiBrief</div>
</div>
<div style="background:white;padding:32px;border-radius:0 0 12px 12px;">
  <h2 style="font-family:Georgia,serif;font-size:22px;color:#1A1208;margin:0 0 16px;">Update on your ad request</h2>
  <p style="color:#3D3328;font-size:15px;line-height:1.7;margin:0 0 16px;">Hi ${escapeHtml(ad.contact_name || ad.company_name)},</p>
  <p style="color:#3D3328;font-size:15px;line-height:1.7;margin:0 0 16px;">Thank you for your interest in advertising with TheDubaiBrief. Unfortunately we cannot approve this ad at this time.</p>
  ${reason ? `<div style="background:#FFF3CD;border-radius:8px;padding:16px;margin-bottom:16px;font-size:14px;"><strong>Reason:</strong> ${escapeHtml(reason)}</div>` : ''}
  <p style="color:#3D3328;font-size:15px;line-height:1.7;margin:0 0 16px;">A <strong>full refund</strong> has been processed and will appear within 3-5 business days.</p>
  <p style="color:#666;font-size:13px;">Questions? Reply to this email.</p>
  <p style="color:#666;font-size:13px;margin-top:8px;">— TheDubaiBrief Team</p>
</div>
</body></html>`;
  await sendResendEmail({ to: ad.email, subject: 'Update on your TheDubaiBrief ad request', html, text: `Hi ${ad.contact_name},\n\nWe cannot approve your ad at this time. Reason: ${reason||'N/A'}\n\nA full refund has been processed.\n\nTheDubaiBrief Team` });
}

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`DUB server running on port ${PORT}`);
  
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

