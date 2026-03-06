import 'dotenv/config';
import express from 'express';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const anthropic = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY,
});

// ── Rate limiter ──────────────────────────────────────────────────────────────
// Map<ip, { count: number, resetAt: number }>
const rateLimitMap = new Map();
const RATE_LIMIT = 3;
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT) {
    return false;
  }
  entry.count += 1;
  return true;
}

// ── Claude moderation ─────────────────────────────────────────────────────────
const MODERATION_SYSTEM_PROMPT = `You are a content moderator for a UAE news site.
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

async function moderateWithClaude(content, location) {
  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 256,
    system: MODERATION_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Location: ${location}\nPost: ${content}`,
      },
    ],
  });

  const text = message.content[0]?.text || '{}';
  // Strip markdown code fences if the model wraps JSON
  const cleaned = text.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
  const parsed = JSON.parse(cleaned);

  return {
    approved: Boolean(parsed.approved),
    reason: String(parsed.reason || ''),
    risk_level: ['low', 'medium', 'high'].includes(parsed.risk_level)
      ? parsed.risk_level
      : 'medium',
  };
}

// ── POST /api/community/submit ────────────────────────────────────────────────
const VALID_LOCATIONS = [
  'Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman',
  'RAK', 'Fujairah', 'Um Al Quwain', 'Other',
];

router.post('/submit', async (req, res) => {
  try {
    const ip = req.ip || 'unknown';

    if (!checkRateLimit(ip)) {
      return res.status(429).json({
        error: 'Please wait before submitting another report.',
      });
    }

    const content = String(req.body.content || '').trim();
    const location = String(req.body.location || '').trim();
    const is_anonymous = req.body.is_anonymous !== false;
    const display_name = is_anonymous
      ? null
      : String(req.body.display_name || '').trim() || null;
    const contact = is_anonymous
      ? null
      : String(req.body.contact || '').trim() || null;

    if (!content || content.length > 280) {
      return res.status(400).json({ error: 'Content must be 1–280 characters.' });
    }
    if (!VALID_LOCATIONS.includes(location)) {
      return res.status(400).json({ error: 'Invalid location.' });
    }

    let modResult;
    try {
      modResult = await moderateWithClaude(content, location);
    } catch (err) {
      console.error('[community] Moderation error:', err.message);
      return res.status(502).json({
        error: 'Moderation service unavailable. Try again shortly.',
      });
    }

    if (!modResult.approved) {
      return res.status(200).json({
        approved: false,
        message:
          "Your post doesn't meet our community guidelines. CWN accepts calm factual observations only.",
      });
    }

    const { error: dbError } = await supabase.from('posts').insert({
      content,
      location,
      is_anonymous,
      display_name,
      contact,
      approved: true,
      risk_level: modResult.risk_level,
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
    // contact is intentionally omitted — never exposed via API
    const { data, error } = await supabase
      .from('posts')
      .select('id, content, location, is_anonymous, display_name, risk_level, created_at')
      .eq('approved', true)
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) {
      console.error('[community] Supabase select error:', error.message);
      return res.status(500).json({ error: 'Failed to load posts.' });
    }

    return res.json({ posts: data || [] });
  } catch (err) {
    console.error('[community] Posts error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

export default router;
