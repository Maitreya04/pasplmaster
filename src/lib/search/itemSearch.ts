import type { Item } from '../../types';

export type MatchLayer =
  | 'exact-name'
  | 'exact-alias'
  | 'normalized'
  | 'prefix'
  | 'substring'
  | 'keywords'
  | 'partial'
  | 'fuzzy';

export interface SearchResult {
  item: Item;
  score: number;
  matchType: MatchLayer;
}

const MAX_RESULTS = 20;

// ---------------------------------------------------------------------------
// Query utilities — exported for UI use (code badge, input hint, etc.)
// ---------------------------------------------------------------------------

/** Expands common shorthand tokens used by auto-parts salespeople. */
export const SHORTHAND_MAP: Record<string, string> = {
  rr: 'rear',
  fr: 'front',
  dlx: 'deluxe',
  spl: 'splendor',
  std: 'standard',
  hh: 'hero honda',
  // pas -> passion removed: "disk pas" means "disk pad", not "disk passion"
  disc: 'disc',
  sh: 'shock',
  sup: 'suspension',
};

/**
 * Normalises a raw search query:
 *  1. lowercase + trim + collapse whitespace
 *  2. expand known shorthand tokens
 */
export function normalizeQuery(q: string): string {
  return q
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map(t => SHORTHAND_MAP[t] ?? t)
    .join(' ');
}

/**
 * Returns true when the query looks like a part-code lookup
 * (e.g. "51122-04", "6002RSR", "84821020").
 */
export function detectCodeLike(q: string): boolean {
  const t = q.trim();
  return /\d{4,}[/\-]\d{2,}/.test(t) || /^\d{5,}$/.test(t) || /^[a-z0-9]{4,}-[a-z0-9]{2,}$/i.test(t);
}

const FUZZY_FALLBACK_THRESHOLD = 5;
const PARTIAL_KEYWORD_RATIO = 0.6;

// ---------------------------------------------------------------------------
// Pre-processing — computed once per item-list identity.
// Builds flat array + hash-map indexes for O(1) exact/normalized lookups.
// ---------------------------------------------------------------------------

interface PrepItem {
  item: Item;
  nameLower: string;
  aliasLower: string;
  alias1Lower: string;
  nameNorm: string;
  aliasNorm: string;
  alias1Norm: string;
  nameWords: string[];
}

interface SearchIndex {
  all: PrepItem[];
  byName: Map<string, number[]>;
  byAlias: Map<string, number[]>;
  byAlias1: Map<string, number[]>;
  byNormAlias: Map<string, number[]>;
  byNormAlias1: Map<string, number[]>;
}

let _ref: Item[] | null = null;
let _idx: SearchIndex | null = null;

function strip(s: string): string {
  return s.replace(/[\s.\-/\\]/g, '');
}

function indexPush(map: Map<string, number[]>, key: string, i: number) {
  if (!key) return;
  const arr = map.get(key);
  if (arr) arr.push(i);
  else map.set(key, [i]);
}

function buildIndex(items: Item[]): SearchIndex {
  if (_ref === items && _idx) return _idx;
  _ref = items;

  const len = items.length;
  const all: PrepItem[] = new Array(len);
  const byName = new Map<string, number[]>();
  const byAlias = new Map<string, number[]>();
  const byAlias1 = new Map<string, number[]>();
  const byNormAlias = new Map<string, number[]>();
  const byNormAlias1 = new Map<string, number[]>();

  for (let i = 0; i < len; i++) {
    const it = items[i];
    const nameLower = it.name.toLowerCase();
    const aliasLower = (it.alias ?? '').toLowerCase();
    const alias1Lower = (it.alias1 ?? '').toLowerCase();
    const nameNorm = strip(nameLower);
    const aliasNorm = strip(aliasLower);
    const alias1Norm = strip(alias1Lower);

    all[i] = {
      item: it,
      nameLower,
      aliasLower,
      alias1Lower,
      nameNorm,
      aliasNorm,
      alias1Norm,
      nameWords: nameLower.split(/\s+/).filter(Boolean),
    };

    indexPush(byName, nameLower, i);
    indexPush(byAlias, aliasLower, i);
    indexPush(byAlias1, alias1Lower, i);
    indexPush(byNormAlias, aliasNorm, i);
    indexPush(byNormAlias1, alias1Norm, i);
  }

  _idx = { all, byName, byAlias, byAlias1, byNormAlias, byNormAlias1 };
  return _idx;
}

// ---------------------------------------------------------------------------
// Levenshtein — pre-allocated typed-array buffers (zero GC in hot path).
// Accepts adaptive maxDist for early exit.
// ---------------------------------------------------------------------------

const _LEV_CAP = 128;
const _levA = new Uint16Array(_LEV_CAP + 1);
const _levB = new Uint16Array(_LEV_CAP + 1);

function levenshtein(a: string, b: string, maxDist: number): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  if (Math.abs(m - n) > maxDist) return maxDist + 1;
  if (n > _LEV_CAP) return maxDist + 1;

  let prev = _levA;
  let curr = _levB;
  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    const ac = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      curr[j] =
        ac === b.charCodeAt(j - 1)
          ? prev[j - 1]
          : 1 + Math.min(prev[j], curr[j - 1], prev[j - 1]);
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }
  return prev[n];
}

/** Adaptive max distance: 2 edits for 5+ char pairs, 1 for shorter. */
function maxDist(a: number, b: number): number {
  return Math.max(a, b) >= 5 ? 2 : 1;
}

// ---------------------------------------------------------------------------
// Fuzzy matching — checks query against each individual name word, then
// alias and alias1 (stripped). "pistn" matches "PISTON" (distance 1),
// "brek" matches "BRAKE" (distance 2, both ≥5 via max(4,5)).
// For multi-word queries, every query word must fuzzy-hit a name word.
// ---------------------------------------------------------------------------

function fuzzyMatchItem(
  qNorm: string,
  qWords: string[],
  p: PrepItem,
): boolean {
  if (qWords.length > 1) {
    for (let w = 0; w < qWords.length; w++) {
      const qw = qWords[w];
      let hit = false;
      for (let n = 0; n < p.nameWords.length; n++) {
        const nw = p.nameWords[n];
        if (nw.includes(qw)) {
          hit = true;
          break;
        }
        const md = maxDist(qw.length, nw.length);
        if (Math.abs(qw.length - nw.length) > md) continue;
        if (levenshtein(qw, nw, md) <= md) {
          hit = true;
          break;
        }
      }
      if (!hit) return false;
    }
    return true;
  }

  for (let n = 0; n < p.nameWords.length; n++) {
    const nw = p.nameWords[n];
    const md = maxDist(qNorm.length, nw.length);
    if (Math.abs(qNorm.length - nw.length) > md) continue;
    if (levenshtein(qNorm, nw, md) <= md) return true;
  }

  if (p.aliasNorm) {
    const md = maxDist(qNorm.length, p.aliasNorm.length);
    if (levenshtein(qNorm, p.aliasNorm, md) <= md) return true;
  }
  if (p.alias1Norm) {
    const md = maxDist(qNorm.length, p.alias1Norm.length);
    if (levenshtein(qNorm, p.alias1Norm, md) <= md) return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// 8-layer cascade search
//
//  Phase 1 — O(1) hash-map lookups (layers 0-2)
//    Layer 0  Exact name match                         → 100
//    Layer 1  Exact alias / alias1 match               → 100
//    Layer 2  Normalized alias / alias1 match          →  95
//
//  Phase 2 — Linear scan (layers 3-6), with normalized fallback so
//            "activa100" and "activa 100" hit the same items.
//    Layer 3  Prefix (raw then normalized)             →  85
//    Layer 4  Substring (raw then normalized)          →  75
//    Layer 5  All keywords present in name             →  60
//    Layer 6  60%+ keywords present in name            →  40
//
//  Phase 3 — Fuzzy fallback (layer 7, only if < 5 results)
//    Layer 7  Levenshtein on individual name words +   →  30
//             alias/alias1. Adaptive distance:
//             ≤2 for 5+ char pairs, ≤1 for shorter.
// ---------------------------------------------------------------------------

export function searchItems(query: string, items: Item[]): SearchResult[] {
  const q = normalizeQuery(query);
  if (!q) return [];

  const idx = buildIndex(items);
  const { all } = idx;
  const results: SearchResult[] = [];
  const seen = new Set<number>();

  // ------ Phase 1: O(1) map lookups (layers 0, 1, 2) ------

  const collect = (
    map: Map<string, number[]>,
    key: string,
    score: number,
    layer: MatchLayer,
  ) => {
    const hits = map.get(key);
    if (!hits) return;
    for (let k = 0; k < hits.length; k++) {
      const p = all[hits[k]];
      if (seen.has(p.item.id)) continue;
      seen.add(p.item.id);
      results.push({ item: p.item, score, matchType: layer });
    }
  };

  collect(idx.byName, q, 100, 'exact-name');
  collect(idx.byAlias, q, 100, 'exact-alias');
  collect(idx.byAlias1, q, 100, 'exact-alias');

  const qNorm = strip(q);
  collect(idx.byNormAlias, qNorm, 95, 'normalized');
  collect(idx.byNormAlias1, qNorm, 95, 'normalized');

  if (results.length >= MAX_RESULTS) {
    return results.sort((a, b) => b.score - a.score).slice(0, MAX_RESULTS);
  }

  // ------ Phase 2: linear scan (layers 3, 4, 5, 6) ------

  const qWords = q.split(/\s+/).filter(Boolean);
  const multiWord = qWords.length > 1;
  const wordCount = qWords.length;
  const partialMin = Math.ceil(wordCount * PARTIAL_KEYWORD_RATIO);

  for (let i = 0; i < all.length; i++) {
    const p = all[i];
    if (seen.has(p.item.id)) continue;

    let score = 0;
    let layer: MatchLayer = 'prefix';

    // Layer 3: Prefix — raw then normalized
    if (
      p.aliasLower.startsWith(q) ||
      p.alias1Lower.startsWith(q) ||
      p.nameLower.startsWith(q)
    ) {
      score = 85;
      layer = 'prefix';
    } else if (
      p.aliasNorm.startsWith(qNorm) ||
      p.alias1Norm.startsWith(qNorm) ||
      p.nameNorm.startsWith(qNorm)
    ) {
      score = 85;
      layer = 'prefix';
    }

    // Layer 4: Substring — raw then normalized
    else if (
      p.nameLower.includes(q) ||
      p.aliasLower.includes(q) ||
      p.alias1Lower.includes(q)
    ) {
      score = 75;
      layer = 'substring';
    } else if (
      p.nameNorm.includes(qNorm) ||
      p.aliasNorm.includes(qNorm) ||
      p.alias1Norm.includes(qNorm)
    ) {
      score = 75;
      layer = 'substring';
    }

    // Layer 5 & 6: Keyword matching against name
    else if (multiWord) {
      let hits = 0;
      for (let k = 0; k < wordCount; k++) {
        if (p.nameLower.includes(qWords[k])) hits++;
      }
      if (hits === wordCount) {
        score = 60;
        layer = 'keywords';
      } else if (hits >= partialMin) {
        score = 40;
        layer = 'partial';
      }
    }

    if (score > 0) {
      results.push({ item: p.item, score, matchType: layer });
      seen.add(p.item.id);
    }
  }

  // ------ Phase 3: fuzzy fallback (layer 7) ------

  if (results.length < FUZZY_FALLBACK_THRESHOLD) {
    for (let i = 0; i < all.length; i++) {
      const p = all[i];
      if (seen.has(p.item.id)) continue;
      if (fuzzyMatchItem(qNorm, qWords, p)) {
        results.push({ item: p.item, score: 30, matchType: 'fuzzy' });
      }
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, MAX_RESULTS);
}
