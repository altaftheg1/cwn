# AGENTS.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview

Clockwork News (CWN) is a Node.js web app that aggregates UAE news from multiple sources, rewrites headlines/summaries in calm, neutral language, and serves them through an Express API and static HTML frontend. The goal is to present news without sensationalist or alarming phrasing.

## Commands

### Run the server
```
npm start
```
This runs `node server.js` and starts the Express server on port 3000 (override with `PORT` env var). The cache is primed on startup.

### Install dependencies
```
npm install
```

There is no test runner, linter, or build step configured in this project.

## Architecture

The project uses ES modules (`"type": "module"` in package.json).

### Backend (`server.js`)
Express server with two API endpoints and static file serving:
- `GET /api/news` — returns the full cached news list (up to 60 items), triggers a background rebuild if stale
- `GET /api/article?id=<id>` — returns a single article by its stable SHA-256-based ID

Static HTML files in the project root are served directly (e.g. `/uae-calm-uae-news.html`).

### Source Scraping (`src/sources.js`)
`fetchSourceArticles(source)` scrapes a news source and returns article metadata. Key design decisions:
- Uses native `fetch` first, falls back to `curl.exe` for sites with malformed HTTP headers (notably WAM)
- Extracts articles from JSON-LD structured data when available, falls back to anchor-tag scraping
- The UAE Government Portal (`source.key === "uae"`) uses a custom HTML card-grid parser (`extractUaePortalCards`) instead of JSON-LD
- `isProbablyArticleUrl()` filters out non-article pages (privacy, terms, login, etc.) and requires URLs with multiple path segments
- Article enrichment fetches individual article pages (concurrency limited to 4) to fill in missing metadata via JSON-LD or OG meta tags

### Tone Rewriting (`src/tone.js`)
`calmifyArticle(article)` applies regex-based word replacements to neutralize sensationalist language. There are separate replacement rule sets for headlines and summaries. Examples: "breaking" → "update", "war" → "conflict", "chaos" → "disruption". Exclamation marks are stripped.

### Caching (`src/news-cache.js`)
In-memory cache with a 3-minute TTL. `buildNewsCache()` prevents concurrent rebuilds (dogpile protection) and has a 5-second minimum interval between non-forced builds. The pipeline: fetch all sources in parallel via `Promise.allSettled` → normalize → deduplicate by URL → apply tone rewriting → sort by publish date.

### News Sources
Hardcoded in `src/news-cache.js`:
- Emirates News Agency (WAM) — official
- UAE Government Portal — official
- Khaleej Times, Gulf News, Emirates24|7 — newsroom

### Utilities (`src/util.js`)
- `safeJsonParse` — tolerant JSON parser that salvages malformed JSON-LD
- `absoluteUrl` — resolves relative URLs against a base
- `normalizeArticle` — standardizes article shape, extracts dates from title text as fallback
- `stableId` — deterministic article ID from `SHA-256(sourceKey + "|" + url)`, truncated to 16 hex chars

### Frontend
Two static HTML files with inline CSS/JS (no build tooling):
- `uae-calm-uae-news.html` — main news listing with client-side search/filter and auto-refresh every 3 minutes
- `article.html` — single article detail view, fetches from `/api/article?id=`

The frontend classifies articles into topics (education, health, finance, etc.) client-side via keyword matching in `classifyTopic()`.
