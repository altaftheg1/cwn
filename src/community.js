import 'dotenv/config';
import express from 'express';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'crypto';

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

// ── Rate limiter ──────────────────────────────────────────────────────────────
const rateLimitMap = new Map();
const RATE_LIMIT = 3;
const RATE_WINDOW_MS = 60 * 60 * 1000;

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count += 1;
  return true;
}

// ── Claude text moderation ────────────────────────────────────────────────────
const MODERATION_SYSTEM = `You are a content moderator for a UAE community news site.
Analyse this community post and return JSON only.
No preamble, no explanation, just JSON.

Return this exact format:
{
  "approved": true/false,
  "reason": "one sentence explanation",
  "risk_level": "low/medium/high"
}

APPROVE if post is:
- A calm factual ground observation
- About roads, weather, crowds, buildings
- Neutral in tone
- About UAE locations only

REJECT if post contains:
- Political opinions or commentary
- Government criticism
- Unverified emergency claims
- Panic inducing language
- Anything offensive or inappropriate
- Personal information shared publicly
- Advertising or spam
- Content unrelated to UAE
- Anything that could cause public fear`;

async function moderateText(content, location) {
  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 256,
    system: MODERATION_SYSTEM,
    messages: [{ role: 'user', content: `Location: ${location}\nPost: ${content}` }],
  });
  const text = msg.content[0]?.text || '{}';
  const clean = text.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
  const parsed = JSON.parse(clean);
  return {
    approved: Boolean(parsed.approved),
    reason: String(parsed.reason || ''),
    risk_level: ['low', 'medium', 'high'].includes(parsed.risk_level) ? parsed.risk_level : 'medium',
  };
}

async function moderateImage(base64Data, mimeType) {
  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 128,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64Data } },
        { type: 'text', text: 'Does this image contain inappropriate, offensive, violent, adult, or politically sensitive content? Reply with JSON only: {"safe": true/false, "reason": "brief reason"}' },
      ],
    }],
  });
  const text = msg.content[0]?.text || '{"safe":true}';
  const clean = text.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
  try {
    const parsed = JSON.parse(clean);
    return { safe: Boolean(parsed.safe) };
  } catch {
    return { safe: true };
  }
}

// ── POST /api/community/upload ────────────────────────────────────────────────
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/quicktime'];

router.post('/upload', async (req, res) => {
  try {
    const { base64, mimeType, extension, mediaType } = req.body;
    if (!base64 || !mimeType || !extension || !mediaType) {
      return res.status(400).json({ error: 'Missing required fields.' });
    }

    const isImage = mediaType === 'image';
    const isVideo = mediaType === 'video';

    if (isImage && !ALLOWED_IMAGE_TYPES.includes(mimeType)) {
      return res.status(400).json({ error: 'Unsupported image format. Use JPG, PNG, or WEBP.' });
    }
    if (isVideo && !ALLOWED_VIDEO_TYPES.includes(mimeType)) {
      return res.status(400).json({ error: 'Unsupported video format. Use MP4 or MOV.' });
    }
    if (!isImage && !isVideo) {
      return res.status(400).json({ error: 'Invalid media type.' });
    }

    const buffer = Buffer.from(base64, 'base64');
    const maxBytes = isImage ? 5 * 1024 * 1024 : 20 * 1024 * 1024;
    if (buffer.length > maxBytes) {
      return res.status(400).json({ error: `${isImage ? 'Photo' : 'Video'} must be under ${isImage ? '5' : '20'}MB.` });
    }

    // Moderate image content with Claude vision
    if (isImage) {
      let imgMod;
      try {
        imgMod = await moderateImage(base64, mimeType);
      } catch (e) {
        console.error('[community] Image moderation error:', e.message);
        imgMod = { safe: true }; // fail open on API error
      }
      if (!imgMod.safe) {
        return res.status(200).json({ approved: false, error: 'Image contains inappropriate content and cannot be uploaded.' });
      }
    }

    const ext = String(extension).replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 8) || 'bin';
    const path = `${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('community-media')
      .upload(path, buffer, { contentType: mimeType, upsert: false });

    if (uploadError) {
      console.error('[community] Storage upload error:', uploadError.message);
      return res.status(500).json({ error: 'Failed to upload media.' });
    }

    const { data: urlData } = supabase.storage.from('community-media').getPublicUrl(path);
    return res.json({ url: urlData.publicUrl, mediaType });
  } catch (err) {
    console.error('[community] Upload error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ── POST /api/community/submit ────────────────────────────────────────────────
const VALID_LOCATIONS = [
  'Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman',
  'RAK', 'Fujairah', 'Um Al Quwain', 'Other',
];

router.post('/submit', async (req, res) => {
  try {
    const ip = req.ip || 'unknown';
    if (!checkRateLimit(ip)) {
      return res.status(429).json({ error: 'Please wait before submitting another report.' });
    }

    const content      = String(req.body.content || '').trim();
    const location     = String(req.body.location || '').trim();
    const is_anonymous = req.body.is_anonymous !== false;
    const display_name = is_anonymous ? null : String(req.body.display_name || '').trim() || null;
    const contact      = is_anonymous ? null : String(req.body.contact || '').trim() || null;
    const media_url    = String(req.body.media_url || '').trim() || null;
    const media_type   = ['image', 'video'].includes(req.body.media_type) ? req.body.media_type : null;

    if (!content || content.length > 280) {
      return res.status(400).json({ error: 'Content must be 1–280 characters.' });
    }
    if (!VALID_LOCATIONS.includes(location)) {
      return res.status(400).json({ error: 'Invalid location.' });
    }

    let modResult;
    try {
      modResult = await moderateText(content, location);
    } catch (err) {
      console.error('[community] Moderation error:', err.message);
      return res.status(502).json({ error: 'Moderation service unavailable. Try again shortly.' });
    }

    if (!modResult.approved) {
      return res.status(200).json({
        approved: false,
        message: "Your post doesn't meet our community guidelines. CWN accepts calm factual observations only.",
      });
    }

    const { error: dbError } = await supabase.from('posts').insert({
      content, location, is_anonymous, display_name, contact,
      approved: true, risk_level: modResult.risk_level,
      media_url, media_type,
    });

    if (dbError) {
      console.error('[community] Supabase insert error:', dbError.message);
      return res.status(500).json({ error: 'Failed to save report.' });
    }

    return res.json({ approved: true, message: 'Report submitted successfully.' });
  } catch (err) {
    console.error('[community] Submit error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ── GET /api/community/posts ──────────────────────────────────────────────────
router.get('/posts', async (req, res) => {
  try {
    const offset = Math.max(0, parseInt(req.query.offset) || 0);
    const limit  = 10;

    const { data, error, count } = await supabase
      .from('posts')
      .select(
        'id, content, location, is_anonymous, display_name, risk_level, created_at, ' +
        'media_url, media_type, malayalam_content, hindi_content, arabic_content, tagalog_content',
        { count: 'exact' }
      )
      .eq('approved', true)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('[community] Supabase select error:', error.message);
      return res.status(500).json({ error: 'Failed to load posts.' });
    }

    return res.json({ posts: data || [], total: count || 0, offset, limit });
  } catch (err) {
    console.error('[community] Posts error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ── GET /api/community/search ─────────────────────────────────────────────────
router.get('/search', async (req, res) => {
  try {
    const q      = String(req.query.q || '').trim();
    const lang   = req.query.lang || 'en';
    const offset = Math.max(0, parseInt(req.query.offset) || 0);
    const limit  = 10;

    if (!q) return res.json({ posts: [], total: 0 });

    const langCol = { ml: 'malayalam_content', ar: 'arabic_content', hi: 'hindi_content', tl: 'tagalog_content' }[lang];
    const safeQ   = q.replace(/[%_]/g, '\\$&'); // escape ILIKE special chars

    let query = supabase
      .from('posts')
      .select(
        'id, content, location, is_anonymous, display_name, risk_level, created_at, ' +
        'media_url, media_type, malayalam_content, hindi_content, arabic_content, tagalog_content',
        { count: 'exact' }
      )
      .eq('approved', true)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    // Search in content + location; add translated column when relevant
    const orFilter = langCol
      ? `content.ilike.%${safeQ}%,${langCol}.ilike.%${safeQ}%,location.ilike.%${safeQ}%`
      : `content.ilike.%${safeQ}%,location.ilike.%${safeQ}%`;

    query = query.or(orFilter);

    const { data, error, count } = await query;

    if (error) {
      console.error('[community] Search error:', error.message);
      return res.status(500).json({ error: 'Search failed.' });
    }

    return res.json({ posts: data || [], total: count || 0 });
  } catch (err) {
    console.error('[community] Search error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ── POST /api/community/translate-post ───────────────────────────────────────
const LANG_NAME = { ml: 'Malayalam', ar: 'Arabic', hi: 'Hindi', tl: 'Filipino/Tagalog' };
const LANG_COL  = { ml: 'malayalam_content', ar: 'arabic_content', hi: 'hindi_content', tl: 'tagalog_content' };

router.post('/translate-post', async (req, res) => {
  try {
    const { post_id, lang } = req.body;
    if (!post_id || !LANG_NAME[lang]) {
      return res.status(400).json({ error: 'Invalid request.' });
    }

    const col = LANG_COL[lang];

    // Check if already translated in Supabase
    const { data: existing } = await supabase
      .from('posts')
      .select(`id, content, ${col}`)
      .eq('id', post_id)
      .single();

    if (!existing) return res.status(404).json({ error: 'Post not found.' });
    if (existing[col]) return res.json({ translated: existing[col], cached: true });

    // Translate with Claude Haiku
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: `Translate this short UAE community ground report to ${LANG_NAME[lang]}. Return only the translated text, nothing else.\n\n${existing.content}`,
      }],
    });

    const translated = msg.content[0]?.text?.trim() || existing.content;

    // Cache in Supabase — fire and forget (don't block the response)
    supabase.from('posts').update({ [col]: translated }).eq('id', post_id)
      .then(({ error: e }) => { if (e) console.error('[community] translate-post cache error:', e.message); });

    return res.json({ translated, cached: false });
  } catch (err) {
    console.error('[community] translate-post error:', err.message);
    return res.status(500).json({ error: 'Translation failed.' });
  }
});

export default router;
