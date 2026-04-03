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
  /** pasplv1-style: union of posting lists + per-token score (primary path). */
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
 * Cap for fast O(1) map collection from prefix/code paths (safety).
 */
const POOL_LIMIT = 320;

/** pasplv1 per-token scores (intelligentSearch). */
const SCORE_WORD = 100;
const SCORE_SUBSTRING = 60;
const SCORE_FUZZY = 60;
const SCORE_PHONETIC = 55;
/** pasplv1: every query token satisfied on the item. */
const ALL_TOKENS_MATCHED_BONUS = 150;

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

/** Alias1 codes often start with these OEM prefixes (TIDC, INEL, …). */
const BRAND_CODE_PREFIXES = [
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
// Soft ranking boosts (after merge, before final sort)
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

function sortSearchResultsDesc(a: SearchResult, b: SearchResult): number {
  const d = b.score - a.score;
  if (d !== 0) return d;
  return (a.item.name ?? '').localeCompare(b.item.name ?? '', undefined, { sensitivity: 'base' });
}

/** pasplv1: substring on full catalog text (name + aliases + groups). */
function scoreSubstringAgainstFullText(p: PrepItem, qw: string): number {
  const ql = qw.toLowerCase();
  if (ql.length < 2) return 0;
  if (p.fullTextLower.includes(ql)) return SCORE_SUBSTRING;
  const qn = strip(ql);
  if (qn.length >= 2) {
    if (p.nameNorm.includes(qn) || p.aliasNorm.includes(qn) || p.alias1Norm.includes(qn)) {
      return SCORE_SUBSTRING;
    }
  }
  return 0;
}

/**
 * Per-token additive score (pasplv1 intelligentSearch).
 */
function scorePrepItemBySalesTokens(p: PrepItem, significantTokens: string[]): number {
  if (significantTokens.length === 0) return 0;
  let score = 0;
  let matched = 0;
  const n = significantTokens.length;

  for (const qw of significantTokens) {
    if (p.allWords.has(qw)) {
      score += SCORE_WORD;
      matched++;
      continue;
    }
    const sub = scoreSubstringAgainstFullText(p, qw);
    if (sub > 0) {
      score += sub;
      matched++;
      continue;
    }
    if (tokenFuzzyMatches(qw, p.allWords)) {
      score += SCORE_FUZZY;
      matched++;
      continue;
    }
    if (qw.length >= 4) {
      const sx = soundex(qw);
      if (sx && p.allPhonetics.has(sx)) {
        score += SCORE_PHONETIC;
        matched++;
        continue;
      }
    }
  }
  if (matched === n && n > 0) score += ALL_TOKENS_MATCHED_BONUS;
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

function fuzzyIndexKeyFallback(
  token: string,
  idx: SearchIndex,
  filterSet: Set<number> | null,
  union: Set<number>,
): void {
  if (token.length < 3) return;
  const first = token[0];
  const keys = idx.firstCharToKeys.get(first);
  if (!keys) return;
  const tLen = token.length;
  for (let ki = 0; ki < keys.length; ki++) {
    const key = keys[ki];
    if (key.length < 3) continue;
    if (Math.abs(key.length - tLen) > 2) continue;
    if (similarity(token, key) >= FUZZY_SIMILARITY_THRESHOLD) {
      const s = idx.wordToItems.get(key);
      if (s) {
        for (const i of s) {
          if (passesFilter(i, filterSet)) union.add(i);
        }
      }
    }
  }
}

function gatherUnionCandidates(
  idx: SearchIndex,
  significantTokens: string[],
  filterSet: Set<number> | null,
): Set<number> {
  const union = new Set<number>();
  const unmatched: string[] = [];

  for (const w of significantTokens) {
    const s = idx.wordToItems.get(w);
    if (s && s.size > 0) {
      for (const i of s) {
        if (passesFilter(i, filterSet)) union.add(i);
      }
    } else {
      unmatched.push(w);
    }
  }

  for (const w of unmatched) {
    fuzzyIndexKeyFallback(w, idx, filterSet, union);
  }

  return union;
}

/**
 * pasplv1 primary path: union of inverted-index postings per token + fuzzy index-key fallback,
 * then per-token scoring. If no index hits, score filtered catalog (pasplv1 fallback).
 */
function v1UnionSearch(
  idx: SearchIndex,
  qWords: string[],
  filterSet: Set<number> | null,
  all: PrepItem[],
): SearchResult[] {
  const significant = qWords.filter(w => w.length >= 2);
  if (significant.length === 0) return [];

  const union = gatherUnionCandidates(idx, significant, filterSet);

  let indices: number[];
  if (union.size === 0) {
    indices = [];
    for (let i = 0; i < all.length; i++) {
      if (passesFilter(i, filterSet)) indices.push(i);
    }
    if (indices.length > MAX_UNION_SCORE_INDICES) {
      indices.sort((a, b) => a - b);
      indices = indices.slice(0, MAX_UNION_SCORE_INDICES);
    }
  } else {
    indices = [...union];
    if (indices.length > MAX_UNION_SCORE_INDICES) {
      indices.sort((a, b) => a - b);
      indices = indices.slice(0, MAX_UNION_SCORE_INDICES);
    }
  }

  const out: SearchResult[] = [];
  for (const i of indices) {
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
// Phase 1: fast exact / normalized / code-like paths (no first-match-wins vs union).
// ---------------------------------------------------------------------------

function collectFastPathResults(
  raw: string,
  q: string,
  qNorm: string,
  idx: SearchIndex,
  filterSet: Set<number> | null,
  all: PrepItem[],
  isCodeLike: boolean,
): SearchResult[] {
  const results: SearchResult[] = [];

  const pushHits = (
    map: Map<string, number[]>,
    key: string,
    score: number,
    layer: MatchLayer,
    field: MatchedField,
  ) => {
    const hits = map.get(key);
    if (!hits) return;
    for (let k = 0; k < hits.length; k++) {
      const itemIdx = hits[k];
      if (!passesFilter(itemIdx, filterSet)) continue;
      const p = all[itemIdx];
      results.push({ item: p.item, score, matchType: layer, matchedField: field });
      if (results.length >= POOL_LIMIT) return;
    }
  };

  pushHits(idx.byName, q, 100, 'exact-name', 'name');
  if (results.length >= POOL_LIMIT) return results;
  pushHits(idx.byAlias, q, 100, 'exact-alias', 'alias');
  if (results.length >= POOL_LIMIT) return results;
  pushHits(idx.byAlias1, q, 100, 'exact-alias', 'alias1');
  if (results.length >= POOL_LIMIT) return results;

  pushHits(idx.byNormAlias, qNorm, 95, 'normalized', 'alias');
  if (results.length >= POOL_LIMIT) return results;
  pushHits(idx.byNormAlias1, qNorm, 95, 'normalized', 'alias1');
  if (results.length >= POOL_LIMIT) return results;

  const rawStripped = strip(raw.toLowerCase().trim());
  if (isCodeLike && rawStripped.length >= 2) {
    if (results.length < POOL_LIMIT && rawStripped.length <= 10 && !/\s/.test(raw.trim())) {
      for (const prefix of BRAND_CODE_PREFIXES) {
        const prefixed = prefix + rawStripped;
        const exactA1 = idx.byNormAlias1.get(prefixed);
        if (exactA1) {
          for (const hi of exactA1) {
            if (!passesFilter(hi, filterSet)) continue;
            results.push({ item: all[hi].item, score: 95, matchType: 'normalized', matchedField: 'alias1' });
            if (results.length >= POOL_LIMIT) return results;
          }
        }
        const exactAl = idx.byNormAlias.get(prefixed);
        if (exactAl) {
          for (const hi of exactAl) {
            if (!passesFilter(hi, filterSet)) continue;
            results.push({ item: all[hi].item, score: 95, matchType: 'normalized', matchedField: 'alias' });
            if (results.length >= POOL_LIMIT) return results;
          }
        }
      }
    }

    pushHits(idx.byNormAlias, rawStripped, 95, 'normalized', 'alias');
    if (results.length >= POOL_LIMIT) return results;
    pushHits(idx.byNormAlias1, rawStripped, 95, 'normalized', 'alias1');
    if (results.length >= POOL_LIMIT) return results;

    if (rawStripped.length >= 3 && results.length < POOL_LIMIT) {
      const rawPrefixHits = idx.prefixToItems.get(rawStripped);
      if (rawPrefixHits) {
        for (const i of rawPrefixHits) {
          if (!passesFilter(i, filterSet)) continue;
          const p = all[i];
          if (p.aliasNorm.startsWith(rawStripped) || p.alias1Norm.startsWith(rawStripped)) {
            const field: MatchedField = p.aliasNorm.startsWith(rawStripped) ? 'alias' : 'alias1';
            results.push({ item: p.item, score: 90, matchType: 'prefix', matchedField: field });
          } else if (p.nameNorm.startsWith(rawStripped)) {
            results.push({ item: p.item, score: 85, matchType: 'prefix', matchedField: 'name' });
          }
          if (results.length >= POOL_LIMIT) break;
        }
      }
    }

    if (results.length < POOL_LIMIT && rawStripped.length <= 10 && !/\s/.test(raw.trim())) {
      for (const prefix of BRAND_CODE_PREFIXES) {
        const prefixed = prefix + rawStripped;
        if (prefixed.length < 3) continue;
        const prefixHits = idx.prefixToItems.get(prefixed);
        if (!prefixHits) continue;
        for (const i of prefixHits) {
          if (!passesFilter(i, filterSet)) continue;
          const p = all[i];
          if (p.alias1Norm.startsWith(prefixed) && p.alias1Norm.length > prefixed.length) {
            results.push({ item: p.item, score: 88, matchType: 'prefix', matchedField: 'alias1' });
          }
          if (results.length >= POOL_LIMIT) break;
        }
        if (results.length >= POOL_LIMIT) break;
      }
    }
  }

  return results;
}

/**
 * pasplv1-style union scoring + fast exact/code paths, merged by max score.
 */
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
  const filterSet = getFilteredSet(idx, brandFilter, groupFilter);
  const { all } = idx;
  const qNorm = strip(q);
  const qWords = q.split(/\s+/).filter(Boolean);

  const fastResults = collectFastPathResults(raw, q, qNorm, idx, filterSet, all, isCodeLike);
  const unionResults = v1UnionSearch(idx, qWords, filterSet, all);

  const merged = mergeResultsByMaxScore(fastResults, unionResults);
  applyRankingBoosts(merged, idx, qWords, detectedBrand);

  return merged.sort(sortSearchResultsDesc).slice(0, MAX_RESULTS);
}
