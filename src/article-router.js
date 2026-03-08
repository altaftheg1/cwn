import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { load } from 'cheerio';
import { getCachedArticleById, buildNewsCache, getCachedNews } from './news-cache.js';

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const supabase = createClient(
  process.env.SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_KEY || 'placeholder'
);

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY || 'placeholder' });

// ── Fetch full article text from source URL ───────────────────────────────────
async function fetchArticleText(url) {
  if (!url) return null;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const $ = load(html);
    const paragraphs = [];
    $('p, article p, main p, .content p, .article-content p, .article-body p').each((_, el) => {
      const text = $(el).text().trim();
      if (text.length > 50) paragraphs.push(text);
    });
    if (!paragraphs.length) {
      $('div').each((_, el) => {
        const text = $(el).text().trim();
        if (text.length > 100 && text.length < 800) paragraphs.push(text);
      });
    }
    return paragraphs.slice(0, 8).join('\n\n') || null;
  } catch {
    return null;
  }
}

// ── Claude deep rewrite ───────────────────────────────────────────────────────
const DEEP_REWRITE_SYSTEM_PROMPT = `You are a UAE news editor for TheDubaiBrief.
Rewrite this article for everyday residents and expats.
Use simple, calm, clear English anyone can understand.
No panic language. No jargon. No complex words.

Return JSON only. No preamble. No markdown. Just JSON.

{
  "calm_title": "rewritten headline, max 6 words, calm and clear",
  "summary": "two sentence plain English summary",
  "resident_impact": "one practical sentence about what this means for people living in UAE, or null",
  "sections": [
    {
      "heading": "short section heading",
      "content": "paragraph in simple plain English, 2-4 sentences max per section",
      "has_data": true,
      "data_type": "bar",
      "data_title": "chart title or null",
      "data_labels": ["label1", "label2"],
      "data_values": [10, 20]
    }
  ],
  "key_facts": [
    "one line fact 1",
    "one line fact 2",
    "one line fact 3"
  ],
  "what_happens_next": "simple one paragraph explanation of what to expect, or null",
  "should_i_worry": "calm honest one sentence answer, or null"
}

IMPORTANT rules for data/charts:
- Only include chart data if article contains clear specific numbers
- Never invent or estimate numbers
- Only use numbers explicitly stated in article
- If no clear data exists set has_data to false and data_type, data_title, data_labels, data_values to null`;

async function deepRewrite(article, fullText) {
  const contentParts = [
    `Title: ${article.title || article.calmTitle || ''}`,
    `Source: ${article.sourceName || ''}`,
    `Summary: ${article.description || article.calmSummary || ''}`,
  ];
  if (fullText) contentParts.push(`\nFull article content:\n${fullText}`);

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    system: DEEP_REWRITE_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: contentParts.join('\n') }],
  });

  const raw = message.content[0]?.text || '{}';
  const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/, '').trim();
  return JSON.parse(cleaned);
}

// ── GET /article/deep/:id — deep rewrite with Supabase cache ─────────────────
// (mounted at /article, so this route handles /article/deep/:id)
router.get('/deep/:id', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'Missing article id.' });

    // 1. Check Supabase cache
    const { data: cached, error: cacheErr } = await supabase
      .from('articles')
      .select('rewritten')
      .eq('id', id)
      .maybeSingle();

    if (!cacheErr && cached?.rewritten) {
      return res.json({ cached: true, ...cached.rewritten });
    }

    // 2. Get article from news cache
    if (!getCachedNews()) {
      await buildNewsCache({ force: true });
    }
    const article = getCachedArticleById(id);
    if (!article) return res.status(404).json({ error: 'Article not found.' });

    // 3. Fetch full article text
    const fullText = await fetchArticleText(article.url);

    // 4. Deep rewrite with Claude
    let rewritten;
    try {
      rewritten = await deepRewrite(article, fullText);
    } catch (err) {
      console.error('[article-router] Claude rewrite error:', err.message);
      return res.status(502).json({ error: 'Rewrite service unavailable. Try again shortly.' });
    }

    // Merge original article metadata into rewritten result
    const result = {
      id: article.id,
      url: article.url,
      imageUrl: article.imageUrl,
      sourceName: article.sourceName,
      publishedAt: article.publishedAt,
      topic: article.topic,
      ...rewritten,
    };

    // 5. Save to Supabase (upsert — never rewrite same article twice)
    await supabase.from('articles').upsert({ id, rewritten: result });

    return res.json({ cached: false, ...result });
  } catch (err) {
    console.error('[article-router] Deep article error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// Note: GET /article/:id (HTML page) is handled directly in server.js
// using server.js __dirname to avoid Windows path resolution issues.

export default router;
