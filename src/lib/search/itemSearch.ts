import type { Item } from '../../types';
import { EXPAND_MAP } from './abbreviations';

export type MatchLayer =
  | 'exact-name'
  | 'exact-alias'
  | 'normalized'
  | 'prefix'
  | 'word-prefix'
  | 'substring'
  | 'keywords'
  | 'partial'
  | 'fuzzy'
  | 'phonetic';

export type MatchedField = 'name' | 'alias' | 'alias1' | 'name+alias';

export interface SearchResult {
  item: Item;
  score: number;
  matchType: MatchLayer;
  matchedField: MatchedField;
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

// ---------------------------------------------------------------------------
// Noise filtering — strip qty / packaging words that salespeople mix in
// "K27 10" → "K27", "cdi cddlx 2+4 socket wali 2pc" → "cdi cddlx socket"
// ---------------------------------------------------------------------------

/** Matches quantity-like tokens: 3pc, 10pcs, 2peti, 1box, 5litr, 15kit, etc. */
const NOISE_QTY_RE = /^\d+(pc|pcs|peti|box|kit|set|litr|ltr|nos?|bucket|pkt)s?$/i;

/** Standalone noise words that carry no search meaning */
const NOISE_WORDS = new Set([
  'wali', 'wala', 'wale', 'type', 'no', 'single', 'double',
  'bucket', 'peti', 'litr', 'ltr', 'pcs', 'pc', 'nos',
  'box', 'packets', 'packet', 'pkt',
]);

/**
 * Normalises a raw search query:
 *  1. lowercase + trim + collapse whitespace
 *  2. expand known shorthand tokens
 */
/**
 * Expands a single token using shorthand and abbreviation/misspelling maps (pasplv1-style).
 */
function expandToken(t: string): string {
  const lower = t.toLowerCase();
  return SHORTHAND_MAP[lower] ?? EXPAND_MAP[lower] ?? lower;
}

/** Check if a token is purely noise (quantity/packaging). */
function isNoise(t: string): boolean {
  return NOISE_WORDS.has(t) || NOISE_QTY_RE.test(t) || /^\d+$/.test(t);
}

export function normalizeQuery(q: string): string {
  let tokens = q
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .filter(Boolean);

  // Strip noise tokens only if we'd still have ≥1 meaningful token left
  if (tokens.length > 1) {
    const meaningful = tokens.filter(t => !isNoise(t));
    if (meaningful.length > 0) tokens = meaningful;
  }

  const expanded: string[] = [];
  for (const t of tokens) {
    const et = expandToken(t);
    // Only expand model-code variants for tokens that have BOTH letters AND digits
    // e.g. "dis100" → "discover 100" (via abbreviation), "dio05" → variants
    // But NOT "shine" or "rear" which are pure words
    if (/[a-z]/i.test(t) && /\d/.test(t)) {
      const m = et.match(/^([a-z]{2,})[-_/\. ]?0?(\d{1,3})$/i);
      if (m) {
        const base = m[1];
        const num = m[2];
        expanded.push(base, `${base}${num}`, `${base}0${num}`, et);
      } else {
        expanded.push(et);
      }
    } else {
      // Pure word token — just expand abbreviations, no model-code variants
      expanded.push(et);
    }
  }

  return Array.from(new Set(expanded)).join(' ');
}

function hasTokenPrefix(value: string | null | undefined, token: string): boolean {
  if (!value) return false;
  const v = value.toLowerCase();
  const t = token.toLowerCase();
  return v.split(/\s+/).some(word => word.startsWith(t));
}

/**
 * Returns true when the query looks like a part-code lookup.
 * Matches:
 *  - Long numeric codes: "52204499", "84821020"
 *  - Codes with separators: "51122-04", "6002/RSR"
 *  - Short alphanumeric codes: "K27", "Gk65m", "GK65M" (letter+digit mix, 2-8 chars)
 */
export function detectCodeLike(q: string): boolean {
  const t = q.trim();
  if (/\d{4,}[/\-]\d{2,}/.test(t)) return true;           // 51122-04
  if (/^\d{5,}$/.test(t)) return true;                     // 52204499
  if (/^[a-z0-9]{4,}-[a-z0-9]{2,}$/i.test(t)) return true; // DIS-PR-02
  // Short alphanumeric code: must have both letter(s) AND digit(s), 2-8 chars total
  if (/^[a-z0-9]{2,8}$/i.test(t) && /[a-z]/i.test(t) && /\d/.test(t)) return true; // K27, Gk65m
  return false;
}

// ---------------------------------------------------------------------------
// Phonetics (Soundex)
// ---------------------------------------------------------------------------

/**
 * Computes a Soundex-like phonetic code for coarse phonetic typo matching.
 */
function soundex(input: string): string {
  if (!input) return "";
  const s = input.toUpperCase().replace(/[^A-Z]/g, "");
  if (!s) return "";
  const first = s[0];
  const map: Record<string, string> = {
    B: "1", F: "1", P: "1", V: "1",
    C: "2", G: "2", J: "2", K: "2", Q: "2", S: "2", X: "2", Z: "2",
    D: "3", T: "3",
    L: "4",
    M: "5", N: "5",
    R: "6",
  };
  let out = first;
  let prev = map[first] || "";
  for (let i = 1; i < s.length; i++) {
    const ch = s[i];
    if ("AEIOUYHW".includes(ch)) {
      prev = "";
      continue;
    }
    const code = map[ch] || "";
    if (code && code !== prev) {
      out += code;
      prev = code;
    }
    if (out.length === 4) break;
  }
  while (out.length < 4) out += "0";
  return out;
}

const FUZZY_FALLBACK_THRESHOLD = 15;
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
  /** All tokens from name, alias, alias1, parent_group, main_group (pasplv1-style) */
  allWords: Set<string>;
  allPhonetics: Set<string>;
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

/** Tokenize string into lowercase alphanumeric tokens (pasplv1-style). */
function toTokens(s: string): string[] {
  return String(s)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
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

    const nameWords = nameLower.split(/\s+/).filter(Boolean);
    const allWords = new Set<string>([
      ...nameWords,
      ...toTokens(aliasLower),
      ...toTokens(alias1Lower),
      ...toTokens(it.parent_group ?? ''),
      ...toTokens(it.main_group ?? ''),
      ...toTokens(it.item_category ?? ''),
    ].filter(Boolean));

    // Expand model concatenations like "dio 05" -> "dio05" in index words too
    const allWordsArr = Array.from(allWords);
    for (const w of allWordsArr) {
      const m = w.match(/^([a-z0-9]{2,})[-_/\. ]?0?([0-9]{1,2})$/);
      if (m) {
        allWords.add(`${m[1]}${m[2]}`);
        allWords.add(`${m[1]}0${m[2]}`);
        allWords.add(m[1]); // base word
      }
    }

    const allPhonetics = new Set<string>();
    for (const w of allWords) {
      if (w.length >= 4) {
        const sx = soundex(w);
        if (sx) allPhonetics.add(sx);
      }
    }

    all[i] = {
      item: it,
      nameLower,
      aliasLower,
      alias1Lower,
      nameNorm,
      aliasNorm,
      alias1Norm,
      nameWords,
      allWords,
      allPhonetics,
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

/**
 * Levenshtein similarity: 1 - (distance / maxLen). pasplv1 uses ≥ 0.8 for fuzzy match.
 * E.g. "pistn" vs "piston" → dist=1, sim=0.83; "brek" vs "brake" → dist=2, sim=0.6.
 */
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  const dist = levenshtein(a, b, maxLen);
  return 1 - Math.min(dist, maxLen) / maxLen;
}

// ---------------------------------------------------------------------------
// Fuzzy matching — pasplv1-style: Levenshtein similarity ≥ 0.8 vs product words.
// Checks name, alias, alias1, parent_group, main_group (allWords).
// "pistn" matches "PISTON" (sim 0.83), "actva" matches "ACTIVA" (sim 0.8).
// For multi-word queries, every query word must fuzzy-hit a product word.
// ---------------------------------------------------------------------------

const FUZZY_SIMILARITY_THRESHOLD = 0.8;
const MIN_TOKEN_LEN_FOR_FUZZY = 3;

function tokenFuzzyMatches(token: string, words: Set<string>): boolean {
  if (token.length < MIN_TOKEN_LEN_FOR_FUZZY) return false;
  for (const w of words) {
    if (w.length < MIN_TOKEN_LEN_FOR_FUZZY) continue;
    if (w.includes(token)) return true;
    if (similarity(token, w) >= FUZZY_SIMILARITY_THRESHOLD) return true;
  }
  return false;
}

function fuzzyMatchItem(
  qNorm: string,
  qWords: string[],
  p: PrepItem,
): boolean {
  if (qWords.length > 1) {
    for (const qw of qWords) {
      if (!tokenFuzzyMatches(qw, p.allWords)) return false;
    }
    return true;
  }

  return tokenFuzzyMatches(qNorm, p.allWords);
}

function phoneticMatchItem(
  qWords: string[],
  p: PrepItem,
): boolean {
  // Only consider tokens >= 4 chars for phonetic matching (short tokens too noisy)
  const validPhoneticWords = qWords.filter(w => w.length >= 4);
  if (validPhoneticWords.length === 0) return false;

  // ALL long query words must have a phonetic match in the item
  for (const qw of validPhoneticWords) {
    const sx = soundex(qw);
    if (!sx || !p.allPhonetics.has(sx)) return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// 9-layer cascade search
//
//  Phase 1 — O(1) hash-map lookups (layers 0-2)
//    Layer 0  Exact name match                              → 100  field: name
//    Layer 1  Exact alias / alias1 match                   → 100  field: alias/alias1
//    Layer 2  Normalized alias / alias1 match              →  95  field: alias/alias1
//
//  Phase 2 — Linear scan (layers 3-6)
//    Layer 3a Prefix on name (raw/norm)                    →  85  field: name
//    Layer 3a Prefix on alias/alias1 (raw/norm)            →  88  field: alias/alias1  ← boosted
//    Layer 3b Word-boundary prefix in name words           →  80  field: name           ← NEW
//    Layer 4  Substring (name/alias/alias1, raw/norm)      →  75  field: whichever
//    Layer 5  All keywords in name+alias                   →  60  field: name+alias
//    Layer 6  ≥60% keywords in name+alias                  →  40  field: name+alias
//
//  Phase 3 — Fuzzy & Phonetic fallback (layer 7 & 8, only if < 15 results)
//    Layer 7  Levenshtein on name words + alias            →  30  field: name/alias
//    Layer 8  Soundex phonetics on long words              →  25  field: name
// ---------------------------------------------------------------------------

export function searchItems(query: string, items: Item[]): SearchResult[] {
  const raw = query;
  const q = normalizeQuery(query);
  if (!q) return [];

  const isCodeLike = detectCodeLike(raw);

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
    field: MatchedField,
  ) => {
    const hits = map.get(key);
    if (!hits) return;
    for (let k = 0; k < hits.length; k++) {
      const p = all[hits[k]];
      if (seen.has(p.item.id)) continue;
      seen.add(p.item.id);
      results.push({ item: p.item, score, matchType: layer, matchedField: field });
    }
  };

  collect(idx.byName, q, 100, 'exact-name', 'name');
  collect(idx.byAlias, q, 100, 'exact-alias', 'alias');
  collect(idx.byAlias1, q, 100, 'exact-alias', 'alias1');

  const qNorm = strip(q);
  collect(idx.byNormAlias, qNorm, 95, 'normalized', 'alias');
  collect(idx.byNormAlias1, qNorm, 95, 'normalized', 'alias1');

  if (results.length >= MAX_RESULTS) {
    return results.sort((a, b) => b.score - a.score).slice(0, MAX_RESULTS);
  }

  // ------ Phase 2: linear scan (layers 3a, 3b, 4, 5, 6) ------

  const qWords = q.split(/\s+/).filter(Boolean);
  const multiWord = qWords.length > 1;
  const wordCount = qWords.length;
  const partialMin = Math.ceil(wordCount * PARTIAL_KEYWORD_RATIO);
  // For word-boundary prefix: first query token is the strongest signal
  const qFirst = qWords[0];

  for (let i = 0; i < all.length; i++) {
    const p = all[i];
    if (seen.has(p.item.id)) continue;

    let score = 0;
    let layer: MatchLayer = 'prefix';
    let field: MatchedField = 'name';

    // Layer 3a: Prefix — alias/alias1 prefix is higher-confidence (code prefix = 88)
    if (p.aliasLower.startsWith(q) || p.alias1Lower.startsWith(q)) {
      score = 88;
      layer = 'prefix';
      field = p.aliasLower.startsWith(q) ? 'alias' : 'alias1';
    } else if (p.aliasNorm.startsWith(qNorm) || p.alias1Norm.startsWith(qNorm)) {
      score = 88;
      layer = 'prefix';
      field = p.aliasNorm.startsWith(qNorm) ? 'alias' : 'alias1';
    } else if (p.nameLower.startsWith(q) || p.nameNorm.startsWith(qNorm)) {
      score = 85;
      layer = 'prefix';
      field = 'name';
    }

    // Layer 3b: Word-boundary prefix — query matches start of any name word
    else if (p.nameWords.some(w => w.startsWith(qFirst))) {
      score = 80;
      layer = 'word-prefix';
      field = 'name';
    }

    // Layer 4: Substring — raw then normalized; check alias fields too
    else if (
      p.nameLower.includes(q) ||
      p.aliasLower.includes(q) ||
      p.alias1Lower.includes(q)
    ) {
      score = 75;
      layer = 'substring';
      field = p.nameLower.includes(q)
        ? 'name'
        : p.aliasLower.includes(q)
          ? 'alias'
          : 'alias1';
    } else if (
      p.nameNorm.includes(qNorm) ||
      p.aliasNorm.includes(qNorm) ||
      p.alias1Norm.includes(qNorm)
    ) {
      score = 75;
      layer = 'substring';
      field = p.nameNorm.includes(qNorm)
        ? 'name'
        : p.aliasNorm.includes(qNorm)
          ? 'alias'
          : 'alias1';
    }

    // Layer 5 & 6: Keyword matching — require words in item.name
    else if (multiWord) {
      let nameHits = 0;
      for (let k = 0; k < wordCount; k++) {
        const w = qWords[k];
        if (p.nameLower.includes(w)) {
          nameHits++;
        }
      }

      if (nameHits === wordCount) {
        score = 60;
        layer = 'keywords';
        field = 'name';
      } else if (nameHits >= partialMin) {
        score = 40;
        layer = 'partial';
        field = 'name';
      }
    }

    // Brand / group boost for word-like queries (discovery)
    if (score === 0 && !isCodeLike && qFirst) {
      if (hasTokenPrefix(p.item.main_group, qFirst)) {
        score = 55;
        layer = 'keywords';
        field = 'name';
      } else if (hasTokenPrefix(p.item.parent_group, qFirst)) {
        score = 50;
        layer = 'keywords';
        field = 'name';
      }
    }

    // Layer: fuzzy-token (pasplv1-style) — Levenshtein similarity ≥ 0.8 vs product words
    if (score === 0 && !isCodeLike && qWords.every(qw => tokenFuzzyMatches(qw, p.allWords))) {
      score = 50;
      layer = 'fuzzy';
      field = 'name';
    }

    if (score > 0) {
      // Keyword-overlap bonus: boost items matching more query tokens
      // e.g. "cdi dis100 varroc" → item with cdi+discover+varroc gets +3 bonus vs one with only cdi
      if (multiWord && score < 100) {
        let overlap = 0;
        for (const qw of qWords) {
          if (p.allWords.has(qw) || p.nameLower.includes(qw) || p.aliasLower.includes(qw)) {
            overlap++;
          }
        }
        score += Math.min(overlap, wordCount);
      }
      results.push({ item: p.item, score, matchType: layer, matchedField: field });
      seen.add(p.item.id);
    }
  }

  // ------ Phase 3: fuzzy & phonetic fallback (layer 7 & 8) ------
  // Only for non code-like (wordy) queries
  if (!isCodeLike && results.length < FUZZY_FALLBACK_THRESHOLD) {
    for (let i = 0; i < all.length; i++) {
      const p = all[i];
      if (seen.has(p.item.id)) continue;
      if (fuzzyMatchItem(qNorm, qWords, p)) {
        seen.add(p.item.id);
        results.push({ item: p.item, score: 30, matchType: 'fuzzy', matchedField: 'name' });
      } else if (phoneticMatchItem(qWords, p)) {
        seen.add(p.item.id);
        results.push({ item: p.item, score: 25, matchType: 'phonetic', matchedField: 'name' });
      }
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, MAX_RESULTS);
}
