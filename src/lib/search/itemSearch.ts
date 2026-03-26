import type { Item } from '../../types';
import { EXPAND_MAP } from './abbreviations';
import type { SearchIndex, PrepItem } from './searchIndex';
import { strip, soundex } from './searchIndex';

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

/**
 * Expands a single token using shorthand and abbreviation/misspelling maps (pasplv1-style).
 */
function expandToken(t: string): string {
  const lower = t.toLowerCase();
  return SHORTHAND_MAP[lower] ?? EXPAND_MAP[lower] ?? lower;
}

export function normalizeQuery(q: string): string {
  const tokens = q
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .filter(Boolean);

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

const FUZZY_FALLBACK_THRESHOLD = 15;
const PARTIAL_KEYWORD_RATIO = 0.6;
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
// 9-layer cascade search — now using pre-built index
//
//  Phase 1 — O(1) hash-map lookups (layers 0-2)
//    Layer 0  Exact name match                              → 100  field: name
//    Layer 1  Exact alias / alias1 match                   → 100  field: alias/alias1
//    Layer 2  Normalized alias / alias1 match              →  95  field: alias/alias1
//
//  Phase 2 — Index lookups (layers 3-6)
//    Layer 3a Prefix on name/alias/alias1 (raw/norm)       →  85-88  field: varies
//    Layer 5  All keywords via inverted word index         →  85  field: name+alias
//    Layer 6  ≥60% keywords via inverted word index        →  ≤80  field: name+alias
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

  if (results.length >= MAX_RESULTS) {
    return results.sort((a, b) => b.score - a.score).slice(0, MAX_RESULTS);
  }

  // ------ Phase 1.5: Raw code prefix + brand prefix resolution ------
  // For code-like queries, normalizeQuery may expand "lt97" → "lt lt97 lt097"
  // which mangles the prefix lookup. Try the RAW stripped query first.
  // Also try prepending known brand prefixes (TIDCK, INEL, etc.) to resolve
  // short codes like "k282" → "TIDCK282".
  const rawStripped = strip(raw.toLowerCase().trim());
  if (isCodeLike && rawStripped.length >= 2) {
    // 1a. Exact lookup with raw code
    collect(idx.byNormAlias, rawStripped, 95, 'normalized', 'alias');
    collect(idx.byNormAlias1, rawStripped, 95, 'normalized', 'alias1');

    // 1b. Prefix lookup with raw code (alias1 starts with raw query)
    if (rawStripped.length >= 3 && results.length < MAX_RESULTS) {
      const rawPrefixHits = idx.prefixToItems.get(rawStripped);
      if (rawPrefixHits) {
        for (const i of rawPrefixHits) {
          if (!passesFilter(i, filterSet)) continue;
          const p = all[i];
          if (seen.has(p.item.id)) continue;
          if (
            p.aliasNorm.startsWith(rawStripped) || p.alias1Norm.startsWith(rawStripped)
          ) {
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

    // 1c. Brand prefix resolution — "k282" → try "TIDCK282", "TIDCGK282", "INELK282", etc.
    // Common brand prefixes used in alias1 codes
    if (results.length < MAX_RESULTS && rawStripped.length <= 10 && !raw.includes(' ')) {
      const BRAND_PREFIXES = ['tidck', 'tidcgk', 'tidca', 'tidcsc', 'tidc', 'inel', 'ev', 'kv'];
      for (const prefix of BRAND_PREFIXES) {
        const prefixed = prefix + rawStripped;
        // Try exact match first
        const exactHits = idx.byNormAlias1.get(prefixed);
        if (exactHits) {
          for (const hi of exactHits) {
            if (!passesFilter(hi, filterSet)) continue;
            const p = all[hi];
            if (seen.has(p.item.id)) continue;
            seen.add(p.item.id);
            results.push({ item: p.item, score: 92, matchType: 'normalized', matchedField: 'alias1' });
          }
        }
        // Try prefix match — e.g. "k6" matches "TIDCK6", "TIDCK6N", "TIDCK6ND"
        if (prefixed.length >= 3) {
          const prefixHits = idx.prefixToItems.get(prefixed);
          if (prefixHits) {
            for (const i of prefixHits) {
              if (!passesFilter(i, filterSet)) continue;
              const p = all[i];
              if (seen.has(p.item.id)) continue;
              if (p.alias1Norm.startsWith(prefixed)) {
                seen.add(p.item.id);
                results.push({ item: p.item, score: 85, matchType: 'prefix', matchedField: 'alias1' });
              }
            }
          }
        }
        if (results.length >= MAX_RESULTS) break;
      }
    }

    if (results.length >= MAX_RESULTS) {
      return results.sort((a, b) => b.score - a.score).slice(0, MAX_RESULTS);
    }
  }

  // ------ Phase 2: Index-based lookups (layers 3-6) ------

  const qWords = q.split(/\s+/).filter(Boolean);
  const multiWord = qWords.length > 1;
  const wordCount = qWords.length;
  const partialMin = Math.ceil(wordCount * PARTIAL_KEYWORD_RATIO);
  const qFirst = qWords[0];

  // Layer 3a: Prefix matching via prefix index — O(1)
  if (qNorm.length >= 3) {
    // Check alias/alias1 prefix (score 88)
    const aliasPrefixKey = qNorm;
    const aliasPrefixHits = idx.prefixToItems.get(aliasPrefixKey);
    if (aliasPrefixHits) {
      for (const i of aliasPrefixHits) {
        if (!passesFilter(i, filterSet)) continue;
        const p = all[i];
        if (seen.has(p.item.id)) continue;
        // Verify this is actually a prefix match on alias/alias1 (not name)
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

    if (results.length >= MAX_RESULTS) {
      return results.sort((a, b) => b.score - a.score).slice(0, MAX_RESULTS);
    }
  }

  // Keyword matching — runs BEFORE word-prefix so multi-word queries
  // prioritise items matching ALL terms over single-word prefix hits.
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
        results.push({ item: p.item, score: 85, matchType: 'keywords', matchedField: 'name+alias' });
        if (results.length >= MAX_RESULTS) break;
      }
    }

    // Partial keyword match (≥60% of words)
    if (results.length < MAX_RESULTS && wordCount >= 2) {
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
        .slice(0, MAX_RESULTS - results.length);

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

  if (results.length >= MAX_RESULTS) {
    return results.sort((a, b) => b.score - a.score).slice(0, MAX_RESULTS);
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
    if (results.length >= MAX_RESULTS) {
      return results.sort((a, b) => b.score - a.score).slice(0, MAX_RESULTS);
    }
  }

  // Brand / group boost for word-like queries (discovery) — via index
  if (!isCodeLike && qFirst && results.length < MAX_RESULTS) {
    // Check brand groups that match qFirst prefix
    for (const [brand, indices] of idx.brandGroups) {
      if (!hasTokenPrefix(brand, qFirst)) continue;
      for (const i of indices) {
        if (!passesFilter(i, filterSet)) continue;
        const p = all[i];
        if (seen.has(p.item.id)) continue;
        seen.add(p.item.id);
        results.push({ item: p.item, score: 55, matchType: 'keywords', matchedField: 'name' });
        if (results.length >= MAX_RESULTS) break;
      }
      if (results.length >= MAX_RESULTS) break;
    }
    // Check parent groups
    if (results.length < MAX_RESULTS) {
      for (const [group, indices] of idx.parentGroups) {
        if (!hasTokenPrefix(group, qFirst)) continue;
        for (const i of indices) {
          if (!passesFilter(i, filterSet)) continue;
          const p = all[i];
          if (seen.has(p.item.id)) continue;
          seen.add(p.item.id);
          results.push({ item: p.item, score: 50, matchType: 'keywords', matchedField: 'name' });
          if (results.length >= MAX_RESULTS) break;
        }
        if (results.length >= MAX_RESULTS) break;
      }
    }
  }

  if (results.length >= MAX_RESULTS) {
    return results.sort((a, b) => b.score - a.score).slice(0, MAX_RESULTS);
  }

  // ------ Phase 3: fuzzy & phonetic fallback (layer 7 & 8) ------
  // Trigram-narrowed: instead of scanning all 12,470 items, use trigram index
  // to get a small candidate set, then run Levenshtein only on those

  if (!isCodeLike && results.length < FUZZY_FALLBACK_THRESHOLD) {
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
        } else if (qw.length >= 3 && (p.nameLower.includes(qw) || p.aliasLower.includes(qw))) {
          overlap++;
        }
      }
      r.score += Math.min(overlap * 2, wordCount * 2);
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, MAX_RESULTS);
}
