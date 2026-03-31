import type { Item } from '../../types';
import { EXPAND_MAP } from './abbreviations';
import type { SearchIndex, PrepItem } from './searchIndex';
import { strip, soundex, toTokens } from './searchIndex';

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
  | 'phonetic'
  /** pasplv1-style: union of posting lists + per-token score (sparse sales shorthand). */
  | 'union-token';

export type MatchedField = 'name' | 'alias' | 'alias1' | 'name+alias';

export interface SearchResult {
  item: Item;
  score: number;
  matchType: MatchLayer;
  matchedField: MatchedField;
}

/** Visible cap (~2 scrolls). Ranking logic is unchanged aside from final slice. */
export const MAX_RESULTS = 72;
/** For future strong / “also relevant” UI split (tune with pressure tests). */
export const STRONG_THRESHOLD = 72;

const DETECTED_BRAND_BOOST = 20;
const PARENT_GROUP_TOKEN_BOOST = 15;
/** If more distinct parent_groups match query tokens, skip group boost (noise guard). */
const MAX_PARENT_GROUPS_FOR_TOKEN_BOOST = 8;

/**
 * Candidate cap before final sort — avoids starving keyword / multi-token hits.
 */
const POOL_LIMIT = 320;
/** pasplv1-style: every query token satisfied on the item. */
const ALL_TOKENS_MATCHED_BONUS = 52;
/** Beats generic prefix (88) after bonuses. */
const KEYWORD_FULL_INTERSECT_SCORE = 92;

// ---------------------------------------------------------------------------
// Query utilities — exported for UI use (code badge, input hint, etc.)
// ---------------------------------------------------------------------------

/** Expands common shorthand tokens used by auto-parts salespeople. */
const SHORTHAND_MAP: Record<string, string> = {
  rr: 'rear',
  fr: 'front',
  dlx: 'deluxe',
  spl: 'splendor',
  std: 'standard',
  hh: 'hero honda',
  // pas -> passion removed: "disk pas" means "disk pad", not "disk passion"
  disc: 'disc',
  sh: 'shock',
  shocker: 'shock',
  sup: 'suspension',
};

/** OEM chain kits: boost TIDC when user says chain + kit + a vehicle line */
const CHAIN_KIT_VEHICLE_HINT =
  /\b(activa|splendor|discover|pulsar|shine|passion|platina|glamour|maestro|jupiter|apache|unicorn|wego|ct\s*100|ct100|c100|honda|hero|bajaj|yamaha|disc)\b/i;

/**
 * Expands a single token using shorthand and abbreviation/misspelling maps (pasplv1-style).
 */
function expandToken(t: string): string {
  const lower = t.toLowerCase();
  return SHORTHAND_MAP[lower] ?? EXPAND_MAP[lower] ?? lower;
}

/** CT100 / C100 naming is inconsistent in the catalog — search all variants. */
function expandCt100TokenVariants(t: string): string[] {
  const compact = t.toLowerCase().replace(/-/g, '');
  if (compact === 'ct100' || compact === 'c100') {
    return ['ct100', 'c100', '100'];
  }
  return [];
}

function pushExpandedModelCodeVariants(t: string, et: string, expanded: string[]): void {
  if (/[a-z]/i.test(t) && /\d/.test(t)) {
    const m = et.match(/^([a-z]{2,})[-_/. ]?0?(\d{1,3})$/i);
    if (m) {
      const base = m[1];
      const num = m[2];
      expanded.push(base, `${base}${num}`, `${base}0${num}`, et);
    } else {
      expanded.push(et);
    }
  } else {
    expanded.push(et);
  }
}

export function normalizeQuery(q: string): string {
  let s = q.toLowerCase().trim().replace(/\s+/g, ' ');
  s = s.replace(/\bmain handle\b/g, 'handle bar');

  const tokens = s.split(' ').filter(Boolean);
  const expanded: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const next = tokens[i + 1];

    if (t === 'ct' && next === '100') {
      expanded.push('ct100', 'c100', '100', 'ct');
      i++;
      continue;
    }

    const ctVars = expandCt100TokenVariants(t);
    if (ctVars.length > 0) {
      expanded.push(...ctVars);
      continue;
    }

    const et = expandToken(t);
    if (et.includes(' ')) {
      for (const part of et.split(/\s+/).filter(Boolean)) {
        const ePart = expandToken(part);
        pushExpandedModelCodeVariants(part, ePart, expanded);
      }
      continue;
    }

    pushExpandedModelCodeVariants(t, et, expanded);
  }

  if (/\bchain\b/.test(s) && /\bkit\b/.test(s) && CHAIN_KIT_VEHICLE_HINT.test(s)) {
    expanded.push('tidc');
  }

  return Array.from(new Set(expanded)).join(' ');
}

function hasTokenPrefix(value: string | null | undefined, token: string): boolean {
  if (!value) return false;
  const v = value.toLowerCase();
  const t = token.toLowerCase();
  return v.split(/\s+/).some(word => word.startsWith(t));
}

/** Alias1 codes often start with these OEM prefixes (TIDC, INEL, …). */
const KNOWN_ALIAS_BRAND_PREFIXES = [
  'tidck',
  'tidcgk',
  'tidca',
  'tidcsc',
  'tidc',
  'inel',
  'ev',
  'kv',
  'ask',
] as const;

const BRAND_CODE_PREFIXES = KNOWN_ALIAS_BRAND_PREFIXES;

/** Loose substring matches (e.g. K39 inside DK39) must not outrank true brand codes. */
const SUBSTRING_MATCH_CAP = 60;

/** True if match is continued by more alphanumerics (K390, 37800K24901). */
function isNormSubstringContinued(norm: string, q: string, pos: number): boolean {
  const after = norm[pos + q.length];
  return !!(after && /[a-z0-9]/i.test(after));
}

/** For w.includes(token): reject "k39" inside "k390" or "37800k24901". */
function substringBoundaryOkForIncludes(haystack: string, needle: string): boolean {
  if (needle.length === 0) return true;
  let pos = 0;
  while ((pos = haystack.indexOf(needle, pos)) >= 0) {
    if (!isNormSubstringContinued(haystack, needle, pos)) return true;
    pos += 1;
  }
  return false;
}

/**
 * Score for query q as substring of alias norm. 0 = no match or invalid continuation.
 * K39 in K390 → 0; K39 in TIDCK39 / DK39 → bounded (≤ SUBSTRING_MATCH_CAP for weak embeds).
 */
function scoreAliasNormSubstring(norm: string, q: string): number {
  if (!q || q.length < 2 || norm.length < q.length) return 0;
  const pos = norm.indexOf(q);
  if (pos < 0) return 0;
  if (isNormSubstringContinued(norm, q, pos)) return 0;
  let score = 58;
  const before = pos > 0 ? norm[pos - 1] : '';
  if (pos > 0 && /[a-z0-9]/i.test(before)) {
    score = 48;
    for (const p of KNOWN_ALIAS_BRAND_PREFIXES) {
      if (norm.startsWith(p) && pos === p.length) {
        score = 58;
        break;
      }
    }
  }
  if (KNOWN_ALIAS_BRAND_PREFIXES.some(pref => norm.startsWith(pref))) {
    score += 10;
  }
  return Math.min(score, SUBSTRING_MATCH_CAP);
}

function scoreSubstringTokenAgainstPrep(p: PrepItem, qw: string): number {
  const q = strip(qw.toLowerCase());
  if (q.length < 2) return 0;
  let best = 0;
  for (const norm of [p.alias1Norm, p.aliasNorm]) {
    if (!norm) continue;
    const s = scoreAliasNormSubstring(norm, q);
    if (s > best) best = s;
  }
  const nl = p.nameLower;
  const ql = qw.toLowerCase();
  const pos = nl.indexOf(ql);
  if (pos >= 0 && !isNormSubstringContinued(nl, ql, pos)) {
    best = Math.max(best, 52);
  }
  return best;
}

function aliasOrNameIncludesBounded(p: PrepItem, qw: string): boolean {
  const ql = qw.toLowerCase();
  const qn = strip(ql);
  for (const norm of [p.alias1Norm, p.aliasNorm]) {
    if (!norm || qn.length < 2) continue;
    const pos = norm.indexOf(qn);
    if (pos >= 0 && !isNormSubstringContinued(norm, qn, pos)) return true;
  }
  const np = p.nameLower.indexOf(ql);
  if (np >= 0 && !isNormSubstringContinued(p.nameLower, ql, np)) return true;
  return false;
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
  if (/\d{4,}[/-]\d{2,}/.test(t)) return true;           // 51122-04
  if (/^\d{5,}$/.test(t)) return true;                     // 52204499
  if (/^[a-z0-9]{4,}-[a-z0-9]{2,}$/i.test(t)) return true; // DIS-PR-02
  // Short alphanumeric code: must have both letter(s) AND digit(s), 2-8 chars total
  if (/^[a-z0-9]{2,8}$/i.test(t) && /[a-z]/i.test(t) && /\d/.test(t)) return true; // K27, Gk65m
  return false;
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
 */
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  const dist = levenshtein(a, b, maxLen);
  return 1 - Math.min(dist, maxLen) / maxLen;
}

// ---------------------------------------------------------------------------
// Fuzzy matching helpers
// ---------------------------------------------------------------------------

/** Run fuzzy/phonetic only when the pool is still small (typo recovery without scanning huge lists). */
const FUZZY_PHASE_MAX_PRIOR_RESULTS = 100;
const PARTIAL_KEYWORD_RATIO = 0.6;
const FUZZY_SIMILARITY_THRESHOLD = 0.8;
const MIN_TOKEN_LEN_FOR_FUZZY = 3;

function tokenFuzzyMatches(token: string, words: Set<string>): boolean {
  if (token.length < MIN_TOKEN_LEN_FOR_FUZZY) return false;
  for (const w of words) {
    if (w.length < MIN_TOKEN_LEN_FOR_FUZZY) continue;
    if (w.includes(token)) {
      if (!substringBoundaryOkForIncludes(w, token)) continue;
      return true;
    }
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
  const validPhoneticWords = qWords.filter(w => w.length >= 4);
  if (validPhoneticWords.length === 0) return false;
  for (const qw of validPhoneticWords) {
    const sx = soundex(qw);
    if (!sx || !p.allPhonetics.has(sx)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Helper: intersect two sets without intermediate array allocation
// ---------------------------------------------------------------------------

function intersectSets(a: Set<number>, b: Set<number>): Set<number> {
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
  const out = new Set<number>();
  for (const v of smaller) {
    if (larger.has(v)) out.add(v);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Helper: apply brand/group filter via index sets
// ---------------------------------------------------------------------------

function getFilteredSet(
  idx: SearchIndex,
  brandFilter?: string | null,
  groupFilter?: string | null,
): Set<number> | null {
  if (!brandFilter && !groupFilter) return null;

  let result: Set<number> | null = null;

  if (brandFilter) {
    const brandSet = idx.brandGroups.get(brandFilter);
    if (!brandSet) return new Set();
    result = new Set(brandSet);
  }

  if (groupFilter) {
    const groupSet = idx.parentGroups.get(groupFilter);
    if (!groupSet) return new Set();
    result = result ? intersectSets(result, groupSet) : new Set(groupSet);
  }

  return result;
}

function passesFilter(i: number, filterSet: Set<number> | null): boolean {
  return filterSet === null || filterSet.has(i);
}

// ---------------------------------------------------------------------------
// Soft ranking boosts (after cascade, before final sort)
// ---------------------------------------------------------------------------

/** parent_group keys whose tokens overlap normalized query tokens (exact token match). */
function parentGroupKeysMatchingQueryTokens(idx: SearchIndex, qWords: string[]): Set<string> {
  const qset = new Set(qWords.filter(w => w.length >= 2));
  if (qset.size === 0) return new Set();

  const matched = new Set<string>();
  for (const g of idx.parentGroups.keys()) {
    const gt = toTokens(g);
    for (const t of gt) {
      if (qset.has(t)) {
        matched.add(g);
        break;
      }
    }
  }
  if (matched.size > MAX_PARENT_GROUPS_FOR_TOKEN_BOOST) return new Set();
  return matched;
}

/**
 * Lifts items for auto-detected brand (+20) and query-aligned subcategory (+15).
 * Sheet-driven brandFilter / groupFilter still hard-limit via passesFilter earlier.
 */
function applyRankingBoosts(
  results: SearchResult[],
  idx: SearchIndex,
  qWords: string[],
  detectedBrand: string | null | undefined,
): void {
  const parentKeys = parentGroupKeysMatchingQueryTokens(idx, qWords);
  const brandKey = detectedBrand?.trim() || null;

  for (const r of results) {
    if (brandKey && r.item.main_group === brandKey) {
      r.score += DETECTED_BRAND_BOOST;
    }
    const pg = r.item.parent_group;
    if (pg && parentKeys.has(pg)) {
      r.score += PARENT_GROUP_TOKEN_BOOST;
    }
  }
}

/**
 * Large bonus when every significant query token appears on the item (pasplv1 “all matched”).
 */
function applyAllTokensMatchedBonus(
  results: SearchResult[],
  idx: SearchIndex,
  qWords: string[],
): void {
  if (qWords.length <= 1) return;
  const { all } = idx;
  for (const r of results) {
    const pi = idx.idToIndex.get(r.item.id);
    if (pi === undefined) continue;
    const p = all[pi];
    let ok = true;
    for (const qw of qWords) {
      if (qw.length < 2) continue;
      if (p.allWords.has(qw)) continue;
      if (qw.length >= 3 && aliasOrNameIncludesBounded(p, qw)) {
        continue;
      }
      ok = false;
      break;
    }
    if (ok) r.score += ALL_TOKENS_MATCHED_BONUS;
  }
}

function sortSearchResultsDesc(a: SearchResult, b: SearchResult): number {
  const d = b.score - a.score;
  if (d !== 0) return d;
  return (a.item.name ?? '').localeCompare(b.item.name ?? '', undefined, { sensitivity: 'base' });
}

/**
 * Per-token additive score (pasplv1 intelligentSearch). Solves sparse multi-token lines
 * like "VE RR SUL SLP HH33" where intersection is empty but many items match 2–4 tokens.
 */
function scorePrepItemBySalesTokens(p: PrepItem, significantTokens: string[]): number {
  if (significantTokens.length === 0) return 0;
  let score = 0;
  let matched = 0;
  const n = significantTokens.length;

  for (const qw of significantTokens) {
    if (p.allWords.has(qw)) {
      score += 100;
      matched++;
      continue;
    }
    const subScore = scoreSubstringTokenAgainstPrep(p, qw);
    if (subScore > 0) {
      score += subScore;
      matched++;
      continue;
    }
    if (tokenFuzzyMatches(qw, p.allWords)) {
      score += 58;
      matched++;
      continue;
    }
    if (qw.length >= 4) {
      const sx = soundex(qw);
      if (sx && p.allPhonetics.has(sx)) {
        score += 55;
        matched++;
        continue;
      }
    }
  }
  if (matched === n && n > 0) score += 140;
  return score;
}

function mergeResultsByMaxScore(a: SearchResult[], b: SearchResult[]): SearchResult[] {
  const m = new Map<number, SearchResult>();
  for (const r of a) {
    const e = m.get(r.item.id);
    if (!e || r.score > e.score) m.set(r.item.id, r);
  }
  for (const r of b) {
    const e = m.get(r.item.id);
    if (!e || r.score > e.score) m.set(r.item.id, r);
  }
  return [...m.values()];
}

const MAX_UNION_SCORE_INDICES = 9000;

/**
 * Union of inverted-index postings per token, then pasplv1-style scoring.
 * This is the primary fix for "sales shorthand" queries that break keyword intersection.
 */
function pasplv1UnionTokenScore(
  idx: SearchIndex,
  qWords: string[],
  filterSet: Set<number> | null,
  all: PrepItem[],
): SearchResult[] {
  const significant = qWords.filter(w => w.length >= 2);
  if (significant.length < 2) return [];

  const union = new Set<number>();
  for (const w of significant) {
    const s = idx.wordToItems.get(w);
    if (s) {
      for (const i of s) union.add(i);
    }
  }
  if (union.size === 0) return [];

  let indices = [...union];
  if (indices.length > MAX_UNION_SCORE_INDICES) {
    indices.sort((a, b) => a - b);
    indices = indices.slice(0, MAX_UNION_SCORE_INDICES);
  }

  const out: SearchResult[] = [];
  for (const i of indices) {
    if (!passesFilter(i, filterSet)) continue;
    const p = all[i];
    const s = scorePrepItemBySalesTokens(p, significant);
    if (s <= 0) continue;
    out.push({
      item: p.item,
      score: s,
      matchType: 'union-token',
      matchedField: 'name+alias',
    });
  }
  return out.sort(sortSearchResultsDesc);
}

// ---------------------------------------------------------------------------
// Hybrid search: cascade + pasplv1 union-token pass (see merge after fuzzy)
//
//  Phase 1 — O(1) hash-map lookups (layers 0-2)
//    Layer 0  Exact name match                              → 100  field: name
//    Layer 1  Exact alias / alias1 match                   → 100  field: alias/alias1
//    Layer 2  Normalized alias / alias1 match              →  95  field: alias/alias1
//
//  Phase 2 — Index lookups (keyword-first for multi-token, then prefix)
//    Layer 5  All keywords via inverted word index         →  92  field: name+alias
//    Layer 6  ≥60% keywords via inverted word index        →  ≤80  field: name+alias
//    Layer 3a Prefix on name/alias/alias1 (raw/norm)       →  85-88  field: varies
//    Layer 3b Word-boundary prefix in name words (fallback)→  75  field: name
//
//  Phase 3 — Fuzzy & Phonetic (layer 7 & 8, trigram-narrowed)
//    Layer 7  Levenshtein on trigram-narrowed candidates   →  30  field: name/alias
//    Layer 8  Soundex phonetics on long words              →  25  field: name
// ---------------------------------------------------------------------------

export function searchItems(
  query: string,
  idx: SearchIndex,
  brandFilter?: string | null,
  groupFilter?: string | null,
  /** From NewOrderPage when heuristic is confident; +20 when item.main_group matches. */
  detectedBrand?: string | null,
): SearchResult[] {
  const raw = query;
  const q = normalizeQuery(query);
  if (!q) return [];

  const isCodeLike = detectCodeLike(raw);

  const { all } = idx;
  const results: SearchResult[] = [];
  const seen = new Set<number>();
  const filterSet = getFilteredSet(idx, brandFilter, groupFilter);

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
      const idx = hits[k];
      if (!passesFilter(idx, filterSet)) continue;
      const p = all[idx];
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

  // ------ Phase 1.5: Raw code prefix + brand prefix resolution ------
  // For code-like queries, normalizeQuery may expand "lt97" → "lt lt97 lt097"
  // which mangles the prefix lookup. Try the RAW stripped query first.
  // Also try prepending known brand prefixes (TIDCK, INEL, etc.) to resolve
  // short codes like "k282" → "TIDCK282".
  const rawStripped = strip(raw.toLowerCase().trim());
  if (isCodeLike && rawStripped.length >= 2) {
    // 1) Brand + short code EXACT first (score 95) — preferred over raw norm / loose substring hits
    if (results.length < POOL_LIMIT && rawStripped.length <= 10 && !/\s/.test(raw.trim())) {
      for (const prefix of BRAND_CODE_PREFIXES) {
        const prefixed = prefix + rawStripped;
        const exactA1 = idx.byNormAlias1.get(prefixed);
        if (exactA1) {
          for (const hi of exactA1) {
            if (!passesFilter(hi, filterSet)) continue;
            const p = all[hi];
            if (seen.has(p.item.id)) continue;
            seen.add(p.item.id);
            results.push({ item: p.item, score: 95, matchType: 'normalized', matchedField: 'alias1' });
          }
        }
        const exactAl = idx.byNormAlias.get(prefixed);
        if (exactAl) {
          for (const hi of exactAl) {
            if (!passesFilter(hi, filterSet)) continue;
            const p = all[hi];
            if (seen.has(p.item.id)) continue;
            seen.add(p.item.id);
            results.push({ item: p.item, score: 95, matchType: 'normalized', matchedField: 'alias' });
          }
        }
        if (results.length >= POOL_LIMIT) break;
      }
    }

    // 2) Exact lookup with raw stripped code (no OEM prefix)
    collect(idx.byNormAlias, rawStripped, 95, 'normalized', 'alias');
    collect(idx.byNormAlias1, rawStripped, 95, 'normalized', 'alias1');

    // 3) Prefix from start of field only (alias/name begin with raw code)
    if (rawStripped.length >= 3 && results.length < POOL_LIMIT) {
      const rawPrefixHits = idx.prefixToItems.get(rawStripped);
      if (rawPrefixHits) {
        for (const i of rawPrefixHits) {
          if (!passesFilter(i, filterSet)) continue;
          const p = all[i];
          if (seen.has(p.item.id)) continue;
          if (p.aliasNorm.startsWith(rawStripped) || p.alias1Norm.startsWith(rawStripped)) {
            seen.add(p.item.id);
            const field: MatchedField = p.aliasNorm.startsWith(rawStripped) ? 'alias' : 'alias1';
            results.push({ item: p.item, score: 90, matchType: 'prefix', matchedField: field });
          } else if (p.nameNorm.startsWith(rawStripped)) {
            seen.add(p.item.id);
            results.push({ item: p.item, score: 85, matchType: 'prefix', matchedField: 'name' });
          }
        }
      }
    }

    // 4) Brand-prefixed alias1 that *extends* the code (TIDCK39ND) — below exact / union substring caps
    if (results.length < POOL_LIMIT && rawStripped.length <= 10 && !/\s/.test(raw.trim())) {
      for (const prefix of BRAND_CODE_PREFIXES) {
        const prefixed = prefix + rawStripped;
        if (prefixed.length < 3) continue;
        const prefixHits = idx.prefixToItems.get(prefixed);
        if (!prefixHits) continue;
        for (const i of prefixHits) {
          if (!passesFilter(i, filterSet)) continue;
          const p = all[i];
          if (seen.has(p.item.id)) continue;
          if (p.alias1Norm.startsWith(prefixed) && p.alias1Norm.length > prefixed.length) {
            seen.add(p.item.id);
            results.push({ item: p.item, score: 88, matchType: 'prefix', matchedField: 'alias1' });
          }
        }
        if (results.length >= POOL_LIMIT) break;
      }
    }
  }

  // ------ Phase 2: Index-based lookups (layers 3-6) ------

  const qWords = q.split(/\s+/).filter(Boolean);
  const multiWord = qWords.length > 1;
  const wordCount = qWords.length;
  const partialMin = Math.ceil(wordCount * PARTIAL_KEYWORD_RATIO);
  const qFirst = qWords[0];

  // Keyword matching — before prefix: multi-token hits win the pool (pasplv1-style priority)
  if (qWords.length > 0) {
    const postingLists: (Set<number> | null)[] = qWords.map(w => {
      return idx.wordToItems.get(w) ?? null;
    });

    const validLists = postingLists.filter((s): s is Set<number> => s !== null && s.size > 0);

    // All keywords match — intersect posting lists
    if (validLists.length === wordCount && wordCount > 0) {
      const sorted = [...validLists].sort((a, b) => a.size - b.size);
      let candidates = new Set(sorted[0]);
      for (let ci = 1; ci < sorted.length; ci++) {
        candidates = intersectSets(candidates, sorted[ci]);
        if (candidates.size === 0) break;
      }

      if (filterSet) {
        candidates = intersectSets(candidates, filterSet);
      }

      for (const i of candidates) {
        const p = all[i];
        if (seen.has(p.item.id)) continue;
        seen.add(p.item.id);
        results.push({
          item: p.item,
          score: KEYWORD_FULL_INTERSECT_SCORE,
          matchType: 'keywords',
          matchedField: 'name+alias',
        });
        if (results.length >= POOL_LIMIT) break;
      }
    }

    // Partial keyword match (≥60% of words)
    if (results.length < POOL_LIMIT && wordCount >= 2) {
      const allCandidates = new Map<number, number>();
      for (const postings of validLists) {
        for (const i of postings) {
          if (!passesFilter(i, filterSet)) continue;
          allCandidates.set(i, (allCandidates.get(i) || 0) + 1);
        }
      }

      const partialResults = [...allCandidates.entries()]
        .filter(([i, count]) => count >= partialMin && !seen.has(all[i].item.id))
        .sort((a, b) => b[1] - a[1])
        .slice(0, Math.max(0, POOL_LIMIT - results.length));

      for (const [i, count] of partialResults) {
        const p = all[i];
        seen.add(p.item.id);
        results.push({
          item: p.item,
          score: Math.round((count / wordCount) * 80),
          matchType: 'partial',
          matchedField: 'name+alias',
        });
      }
    }
  }

  // Layer 3a: Prefix matching via prefix index — after keyword intersection
  if (qNorm.length >= 3) {
    const aliasPrefixKey = qNorm;
    const aliasPrefixHits = idx.prefixToItems.get(aliasPrefixKey);
    if (aliasPrefixHits) {
      for (const i of aliasPrefixHits) {
        if (!passesFilter(i, filterSet)) continue;
        const p = all[i];
        if (seen.has(p.item.id)) continue;
        if (
          p.aliasLower.startsWith(q) || p.alias1Lower.startsWith(q) ||
          p.aliasNorm.startsWith(qNorm) || p.alias1Norm.startsWith(qNorm)
        ) {
          seen.add(p.item.id);
          const field: MatchedField =
            p.aliasLower.startsWith(q) || p.aliasNorm.startsWith(qNorm) ? 'alias' : 'alias1';
          results.push({ item: p.item, score: 88, matchType: 'prefix', matchedField: field });
        } else if (p.nameLower.startsWith(q) || p.nameNorm.startsWith(qNorm)) {
          seen.add(p.item.id);
          results.push({ item: p.item, score: 85, matchType: 'prefix', matchedField: 'name' });
        }
      }
    }
  }

  // Word-boundary prefix — fallback for items not already matched by keywords
  if (qFirst && qFirst.length >= 3) {
    const wordPrefixKey = 'w:' + qFirst;
    const wordPrefixHits = idx.prefixToItems.get(wordPrefixKey);
    if (wordPrefixHits) {
      for (const i of wordPrefixHits) {
        if (!passesFilter(i, filterSet)) continue;
        const p = all[i];
        if (seen.has(p.item.id)) continue;
        seen.add(p.item.id);
        results.push({ item: p.item, score: 75, matchType: 'word-prefix', matchedField: 'name' });
      }
    }
  }

  // Brand / group boost for word-like queries (discovery) — via index
  if (!isCodeLike && qFirst && results.length < POOL_LIMIT) {
    // Check brand groups that match qFirst prefix
    for (const [brand, indices] of idx.brandGroups) {
      if (!hasTokenPrefix(brand, qFirst)) continue;
      for (const i of indices) {
        if (!passesFilter(i, filterSet)) continue;
        const p = all[i];
        if (seen.has(p.item.id)) continue;
        seen.add(p.item.id);
        results.push({ item: p.item, score: 55, matchType: 'keywords', matchedField: 'name' });
        if (results.length >= POOL_LIMIT) break;
      }
      if (results.length >= POOL_LIMIT) break;
    }
    // Check parent groups
    if (results.length < POOL_LIMIT) {
      for (const [group, indices] of idx.parentGroups) {
        if (!hasTokenPrefix(group, qFirst)) continue;
        for (const i of indices) {
          if (!passesFilter(i, filterSet)) continue;
          const p = all[i];
          if (seen.has(p.item.id)) continue;
          seen.add(p.item.id);
          results.push({ item: p.item, score: 50, matchType: 'keywords', matchedField: 'name' });
          if (results.length >= POOL_LIMIT) break;
        }
        if (results.length >= POOL_LIMIT) break;
      }
    }
  }

  // ------ Phase 3: fuzzy & phonetic fallback (layer 7 & 8) ------
  // Trigram-narrowed: instead of scanning all 12,470 items, use trigram index
  // to get a small candidate set, then run Levenshtein only on those

  // Typo / phonetic recovery when the pool is not already huge
  if (!isCodeLike && results.length < FUZZY_PHASE_MAX_PRIOR_RESULTS) {
    // Use trigram index to narrow candidates for fuzzy matching
    let fuzzyCandidates: Set<number>;

    if (qNorm.length >= 3) {
      // Generate trigrams from query
      const queryTrigrams: string[] = [];
      for (let ti = 0; ti <= qNorm.length - 3; ti++) {
        queryTrigrams.push(qNorm.substring(ti, ti + 3));
      }

      // Get posting lists for each trigram, intersect to narrow
      const trigramSets = queryTrigrams
        .map(t => idx.trigramToItems.get(t))
        .filter((s): s is Set<number> => s !== undefined)
        .sort((a, b) => a.size - b.size);

      if (trigramSets.length > 0) {
        fuzzyCandidates = new Set(trigramSets[0]);
        for (let ti = 1; ti < Math.min(trigramSets.length, 4); ti++) {
          fuzzyCandidates = intersectSets(fuzzyCandidates, trigramSets[ti]);
          if (fuzzyCandidates.size < 50) break;
        }
      } else {
        fuzzyCandidates = new Set();
      }
    } else {
      // Query too short for trigrams — use full scan as fallback
      fuzzyCandidates = new Set(Array.from({ length: all.length }, (_, i) => i));
    }

    // Run fuzzy + phonetic only on the narrowed candidates
    for (const i of fuzzyCandidates) {
      if (!passesFilter(i, filterSet)) continue;
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

  // pasplv1 union + per-token score: fixes sparse shorthand (e.g. VE RR SUL SLP HH33) where
  // keyword *intersection* is empty but many SKUs match 2–4 tokens strongly.
  if (!isCodeLike && multiWord && qWords.length >= 2) {
    const unionRanked = pasplv1UnionTokenScore(idx, qWords, filterSet, all);
    const merged = mergeResultsByMaxScore(results, unionRanked);
    results.length = 0;
    for (const r of merged) results.push(r);
  }

  // Apply keyword-overlap bonus for multi-word queries
  if (multiWord) {
    for (const r of results) {
      if (r.score >= 100) continue;
      const pi = idx.idToIndex.get(r.item.id);
      if (pi === undefined) continue;
      const p = all[pi];
      let overlap = 0;
      for (const qw of qWords) {
        if (p.allWords.has(qw)) {
          overlap++;
        } else if (qw.length >= 3 && aliasOrNameIncludesBounded(p, qw)) {
          overlap++;
        }
      }
      r.score += Math.min(overlap * 2, wordCount * 2);
    }
  }

  applyAllTokensMatchedBonus(results, idx, qWords);
  applyRankingBoosts(results, idx, qWords, detectedBrand);

  return results.sort(sortSearchResultsDesc).slice(0, MAX_RESULTS);
}
