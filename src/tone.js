import { stripHtml } from "./util.js";

const HEADLINE_REPLACEMENTS = [
  { from: /\bbreaking\b/gi, to: "update" },
  { from: /^\s*live\b[:\s-]*/gi, to: "" },
  { from: /\bjust now\b/gi, to: "" },
  { from: /\b(\d+)\s*m\s*read\b/gi, to: "" },
  { from: /\b(dead|killed|fatal(ity|ities)?)\b/gi, to: "loss of life" },
  { from: /\bwar\b/gi, to: "conflict" },
  { from: /\burgent\b/gi, to: "important" },
  { from: /\bpanic\b/gi, to: "concern" },
  { from: /\bterror(ism|ist|ists)?\b/gi, to: "security threat" },
  { from: /\bchaos\b/gi, to: "disruption" },
  { from: /\bcrash(es|ed)?\b/gi, to: "incident" },
  { from: /\bskyrocket(s|ed|ing)?\b/gi, to: "rise" },
  { from: /\bplummet(s|ed|ing)?\b/gi, to: "drop" },
  { from: /\bslam(s|med|ming)?\b/gi, to: "criticise" },
  { from: /\bblast(s|ed|ing)?\b/gi, to: "explosion" },
  { from: /\bshock(s|ed|ing)?\b/gi, to: "surprise" },
  { from: /!+/g, to: "" },
];

const SUMMARY_REPLACEMENTS = [
  { from: /^\s*live\b[:\s-]*/gi, to: "" },
  { from: /\bjust now\b/gi, to: "" },
  { from: /\b(\d+)\s*m\s*read\b/gi, to: "" },
  { from: /\burgent\b/gi, to: "important" },
  { from: /\bpanic\b/gi, to: "concern" },
  { from: /\bterror(ism|ist|ists)?\b/gi, to: "security" },
  { from: /\bchaos\b/gi, to: "disruption" },
  { from: /!+/g, to: "" },
];

// Prefixes commonly prepended by news sites that add noise
const STRIP_PREFIXES = [
  /^\s*(update|latest|exclusive|opinion|watch|video|photos?|gallery|in pics|explained|analysis)[:\s|–—-]+/gi,
  /^\s*\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}[:\s|–—-]*/g, // leading dates like "18 Feb 2026 -"
];

function calmifyText(text, rules) {
  if (!text) return "";
  let t = " " + stripHtml(text) + " ";
  for (const r of rules) t = t.replace(r.from, r.to);
  t = t.replace(/\s+/g, " ").trim();
  t = t.replace(/\uFFFD/g, "");
  return t;
}

/**
 * Shorten a title to a citizen-friendly, few-word summary.
 * Strategy:
 *  1. Strip noisy prefixes (UPDATE:, EXCLUSIVE:, dates, etc.)
 *  2. If the title contains a colon or dash separator, keep only the most
 *     meaningful half (the shorter informative side).
 *  3. Cap at ~10 words so card titles stay scannable.
 */
function simplifyTitle(title) {
  if (!title) return title;
  let t = title;

  // Strip noisy prefixes
  for (const re of STRIP_PREFIXES) {
    t = t.replace(re, "");
  }
  t = t.trim();

  // If there's a separator (: — – | -), pick the more informative half.
  const sepMatch = t.match(/^(.+?)[:\|–—]\s*(.+)$/);
  if (sepMatch) {
    const left = sepMatch[1].trim();
    const right = sepMatch[2].trim();
    // Prefer the longer half (usually the actual headline), but only if
    // both sides have at least 3 words; otherwise keep full title.
    const lw = left.split(/\s+/).length;
    const rw = right.split(/\s+/).length;
    if (lw >= 3 && rw >= 3) {
      t = rw >= lw ? right : left;
    } else if (lw < 3 && rw >= 3) {
      t = right;
    }
  }

  // Cap at ~10 words
  const words = t.split(/\s+/);
  if (words.length > 10) {
    t = words.slice(0, 10).join(" ") + "…";
  }

  // Capitalise first letter
  t = t.charAt(0).toUpperCase() + t.slice(1);

  return t;
}

export function calmifyArticle(article) {
  const originalTitle = article.title || "";
  const originalDescription = article.description || "";

  const calmed = calmifyText(originalTitle, HEADLINE_REPLACEMENTS);
  const calmTitle = simplifyTitle(calmed);

  const calmSummaryRaw = calmifyText(originalDescription || article.excerpt || "", SUMMARY_REPLACEMENTS);

  const calmSummary =
    calmSummaryRaw ||
    `${calmTitle || originalTitle || "New update"}. Open the full story for details.`;

  const oneLine = calmSummary.replace(/\s+/g, " ").trim();

  return {
    ...article,
    originalTitle,
    originalDescription,
    calmTitle,
    calmSummary: oneLine,
  };
}

