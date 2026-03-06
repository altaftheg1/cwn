import crypto from "crypto";

export function safeJsonParse(text) {
  if (!text) return null;
  const trimmed = String(text).trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // Try to salvage JSON-LD where extra characters surround valid JSON
    const start = trimmed.search(/[{[]/);
    const lastObj = trimmed.lastIndexOf("}");
    const lastArr = trimmed.lastIndexOf("]");
    const end = Math.max(lastObj, lastArr);
    if (start >= 0 && end > start) {
      const sub = trimmed.slice(start, end + 1);
      try {
        return JSON.parse(sub);
      } catch {
        return null;
      }
    }
    return null;
  }
}

export function stripHtml(text) {
  if (!text) return "";
  return String(text).replace(/<[^>]*>/g, " ");
}

export function absoluteUrl(base, maybeUrl) {
  if (!maybeUrl) return "";
  try {
    return new URL(maybeUrl, base).toString();
  } catch {
    return "";
  }
}

export function parseDateToMs(s) {
  if (!s) return 0;
  const ms = new Date(s).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

export function normalizeArticle(a) {
  const title = (a.title || "").trim();
  const description = (a.description || "").trim();
  const url = (a.url || "").trim();
  let publishedAt = (a.publishedAt || "").trim();
  if (!publishedAt) {
    // Some pages include date prefixes in titles (e.g. "18 Feb 2026 ...")
    const m = title.match(/^\s*(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})\b/);
    if (m) {
      const d = new Date(`${m[1]} ${m[2]} ${m[3]}`);
      if (!Number.isNaN(d.getTime())) {
        publishedAt = d.toISOString();
      }
    }
  }
  const publishedAtMs = parseDateToMs(publishedAt);

  // sanitize image URL by removing irrelevant fragments (e.g.  #primaryimage )
  let imageUrl = a.imageUrl || "";
  if (imageUrl) {
    try {
      const u = new URL(imageUrl, url || undefined);
      if (u.hash) {
        // remove fragment only if it results in a different value
        u.hash = "";
        const cleaned = u.toString();
        // avoid turning a bogus url#fragment that pointed to the article itself
        // into the article url; require that the cleaned URL looks like an image
        if (cleaned !== url && /\.(jpe?g|png|gif|webp|svg)(\?|$)/i.test(cleaned)) {
          imageUrl = cleaned;
        } else {
          // drop it entirely
          imageUrl = "";
        }
      }
    } catch {}
  }

  return {
    id: "",
    sourceKey: a.sourceKey || "",
    sourceName: a.sourceName || "",
    sourceType: a.sourceType || "",
    topic: a.topic || "news",
    severity: a.severity || "low",
    title,
    description,
    url,
    imageUrl,
    publishedAt,
    publishedAtMs,
    location: a.location || "UAE",
  };
}

export function stableId(article) {
  // Stable per URL + source
  const h = crypto.createHash("sha256");
  h.update(article.sourceKey + "|" + article.url);
  return h.digest("hex").slice(0, 16);
}

