// Fuzzy title matching for setlist import (clean-room).
// Matches a loosely-typed line (acronyms, partial titles, different casing)
// against the song library. Pure & browser-safe.

export function normalizeTitle(s: string): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(s: string): string[] {
  return s ? s.split(" ").filter(Boolean) : [];
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n]!;
}

function editRatio(a: string, b: string): number {
  if (!a && !b) return 1;
  const max = Math.max(a.length, b.length);
  return max === 0 ? 1 : 1 - levenshtein(a, b) / max;
}

/** Similarity score in [0,1] between a query and a candidate title. */
export function matchScore(query: string, candidate: string): number {
  const q = normalizeTitle(query);
  const c = normalizeTitle(candidate);
  if (!q || !c) return 0;
  if (q === c) return 1;

  let score = 0;

  if (c.includes(q) || q.includes(c)) {
    const ratio = Math.min(q.length, c.length) / Math.max(q.length, c.length);
    score = Math.max(score, 0.78 + 0.2 * ratio);
  }
  if (c.startsWith(q) || q.startsWith(c)) score = Math.max(score, 0.84);

  const qt = new Set(tokens(q));
  const ct = new Set(tokens(c));
  if (qt.size && ct.size) {
    let inter = 0;
    for (const t of qt) if (ct.has(t)) inter++;
    const jaccard = inter / (qt.size + ct.size - inter);
    score = Math.max(score, 0.45 + 0.55 * jaccard);
  }

  // acronym: query (no spaces) equals the initials of the candidate words
  const qNoSpace = q.replace(/\s/g, "");
  const initials = tokens(c)
    .map((w) => w[0] ?? "")
    .join("");
  if (qNoSpace.length >= 2 && qNoSpace === initials) score = Math.max(score, 0.82);

  score = Math.max(score, editRatio(q, c));
  return Math.min(1, score);
}

export interface MatchResult {
  index: number;
  score: number;
}

/** Best-matching candidate index for a query, or null below threshold. */
export function bestMatch(query: string, candidates: string[], threshold = 0.5): MatchResult | null {
  let best: MatchResult = { index: -1, score: 0 };
  for (let i = 0; i < candidates.length; i++) {
    const sc = matchScore(query, candidates[i] ?? "");
    if (sc > best.score) best = { index: i, score: sc };
  }
  return best.index >= 0 && best.score >= threshold ? best : null;
}

/** Strip common list markers ("1.", "2)", "- ", "• ") from a line. */
export function stripListMarker(line: string): string {
  return line.replace(/^\s*(?:\d+[.)]\s*|[-*•]\s*)/, "").trim();
}
