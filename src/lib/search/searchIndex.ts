/**
 * Pre-computed search index for instant item lookup.
 *
 * Built ONCE when items load (~50ms for 12,470 items).
 * Every search is then O(1) hash lookups + set intersections
 * instead of scanning all items linearly.
 */

import type { Item } from '../../types';
import { ABBREVIATIONS } from '../abbreviations';

// ---------------------------------------------------------------------------
// PrepItem — pre-processed per-item data
// ---------------------------------------------------------------------------

export interface PrepItem {
  item: Item;
  nameLower: string;
  aliasLower: string;
  alias1Lower: string;
  nameNorm: string;   // strip(nameLower)
  aliasNorm: string;   // strip(aliasLower)
  alias1Norm: string;  // strip(alias1Lower)
  nameWords: string[];
  /** Concatenated searchable text (pasplv1 buildProductText) for substring includes. */
  fullTextLower: string;
  /** All tokens from name, alias, alias1, parent_group, main_group (pasplv1-style) */
  allWords: Set<string>;
  allPhonetics: Set<string>;
}

// ---------------------------------------------------------------------------
// SearchIndex — the full pre-computed index
// ---------------------------------------------------------------------------

export interface SearchIndex {
  // PrepItem array
  all: PrepItem[];

  // item.id → index in `all` for O(1) reverse lookup
  idToIndex: Map<number, number>;

  // Layer 1: Exact lookup maps — O(1)
  byName: Map<string, number[]>;
  byAlias: Map<string, number[]>;
  byAlias1: Map<string, number[]>;
  byNormAlias: Map<string, number[]>;
  byNormAlias1: Map<string, number[]>;

  // Layer 2: Inverted word index — word → set of item indices
  wordToItems: Map<string, Set<number>>;

  /** first character of index key → keys (len ≥ 3) for fuzzy index-key fallback (pasplv1). */
  firstCharToKeys: Map<string, string[]>;

  // Layer 3: Prefix index — all prefixes (3-10 chars) of nameLower, aliasLower, alias1Lower, nameNorm, aliasNorm, alias1Norm
  prefixToItems: Map<string, Set<number>>;

  // Layer 4: Trigram index — 3-char subsequences of nameNorm → item indices
  trigramToItems: Map<string, Set<number>>;

  // Layer 5: Brand / parent group indexes for instant filtering
  brandGroups: Map<string, Set<number>>;   // main_group → item indices
  parentGroups: Map<string, Set<number>>;  // parent_group → item indices
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function strip(s: string): string {
  return s.replace(/[\s.\-/\\]/g, '');
}

export function toTokens(s: string): string[] {
  return String(s)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function soundex(input: string): string {
  if (!input) return '';
  const s = input.toUpperCase().replace(/[^A-Z]/g, '');
  if (!s) return '';
  const first = s[0];
  const map: Record<string, string> = {
    B: '1', F: '1', P: '1', V: '1',
    C: '2', G: '2', J: '2', K: '2', Q: '2', S: '2', X: '2', Z: '2',
    D: '3', T: '3',
    L: '4',
    M: '5', N: '5',
    R: '6',
  };
  let out = first;
  let prev = map[first] || '';
  for (let i = 1; i < s.length; i++) {
    const ch = s[i];
    if ('AEIOUYHW'.includes(ch)) {
      prev = '';
      continue;
    }
    const code = map[ch] || '';
    if (code && code !== prev) {
      out += code;
      prev = code;
    }
    if (out.length === 4) break;
  }
  while (out.length < 4) out += '0';
  return out;
}

function indexPush(map: Map<string, number[]>, key: string, i: number) {
  if (!key) return;
  const arr = map.get(key);
  if (arr) arr.push(i);
  else map.set(key, [i]);
}

function indexSetAdd(map: Map<string, Set<number>>, key: string, i: number) {
  if (!key) return;
  let set = map.get(key);
  if (!set) {
    set = new Set();
    map.set(key, set);
  }
  set.add(i);
}

// ---------------------------------------------------------------------------
// buildSearchIndex — runs ONCE on items load
// ---------------------------------------------------------------------------

let _ref: Item[] | null = null;
let _idx: SearchIndex | null = null;

export function buildSearchIndex(items: Item[]): SearchIndex {
  // Memoize: same array reference → same index
  if (_ref === items && _idx) return _idx;
  _ref = items;

  const len = items.length;
  const all: PrepItem[] = new Array(len);
  const idToIndex = new Map<number, number>();

  // Exact lookup maps
  const byName = new Map<string, number[]>();
  const byAlias = new Map<string, number[]>();
  const byAlias1 = new Map<string, number[]>();
  const byNormAlias = new Map<string, number[]>();
  const byNormAlias1 = new Map<string, number[]>();

  // New index structures
  const wordToItems = new Map<string, Set<number>>();
  const prefixToItems = new Map<string, Set<number>>();
  const trigramToItems = new Map<string, Set<number>>();
  const brandGroups = new Map<string, Set<number>>();
  const parentGroups = new Map<string, Set<number>>();

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
      ...toTokens(nameLower),
      ...toTokens(aliasLower),
      ...toTokens(alias1Lower),
      ...toTokens(it.parent_group ?? ''),
      ...toTokens(it.main_group ?? ''),
      ...toTokens(it.item_category ?? ''),
    ].filter(Boolean));

    // Expand model concatenations like "dio 05" -> "dio05" in index words too
    const allWordsArr = Array.from(allWords);
    for (const w of allWordsArr) {
      const m = w.match(/^([a-z0-9]{2,})[-_/. ]?0?([0-9]{1,2})$/);
      if (m) {
        allWords.add(`${m[1]}${m[2]}`);
        allWords.add(`${m[1]}0${m[2]}`);
        allWords.add(m[1]); // base word
      }
      // Expand catalog abbreviations (e.g. "bshoe" → "brake", "shoe")
      const expanded = ABBREVIATIONS[w];
      if (expanded) {
        for (const part of expanded.split(/\s+/)) {
          if (part) allWords.add(part);
        }
      }
    }

    const ctBlob = `${nameLower} ${aliasLower} ${alias1Lower}`;
    if (/\b(ct\s*-?\s*100|c\s*100|ct100)\b/i.test(ctBlob)) {
      allWords.add('ct100');
      allWords.add('c100');
      allWords.add('100');
    }

    const allPhonetics = new Set<string>();
    for (const w of allWords) {
      if (w.length >= 4) {
        const sx = soundex(w);
        if (sx) allPhonetics.add(sx);
      }
    }

    const fullTextLower = [
      nameLower,
      aliasLower,
      alias1Lower,
      it.parent_group ?? '',
      it.main_group ?? '',
      it.item_category ?? '',
    ]
      .join(' ')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();

    all[i] = {
      item: it,
      nameLower,
      aliasLower,
      alias1Lower,
      nameNorm,
      aliasNorm,
      alias1Norm,
      nameWords,
      fullTextLower,
      allWords,
      allPhonetics,
    };

    idToIndex.set(it.id, i);

    // --- Exact lookup maps ---
    indexPush(byName, nameLower, i);
    indexPush(byAlias, aliasLower, i);
    indexPush(byAlias1, alias1Lower, i);
    indexPush(byNormAlias, aliasNorm, i);
    indexPush(byNormAlias1, alias1Norm, i);

    // --- Inverted word index ---
    // Index all words from name + alias1 + alias
    for (const w of allWords) {
      if (w.length >= 2) {
        indexSetAdd(wordToItems, w, i);
      }
    }

    // --- Prefix index ---
    // Generate prefixes (3-10 chars) for name, alias, alias1 (both raw and normalized)
    const prefixSources = [nameLower, aliasLower, alias1Lower, nameNorm, aliasNorm, alias1Norm];
    for (const src of prefixSources) {
      if (!src) continue;
      const maxPfx = Math.min(src.length, 10);
      for (let pLen = 3; pLen <= maxPfx; pLen++) {
        indexSetAdd(prefixToItems, src.substring(0, pLen), i);
      }
      // Also index word-boundary prefixes from nameWords
    }
    for (const word of nameWords) {
      if (word.length < 3) continue;
      const maxPfx = Math.min(word.length, 10);
      for (let pLen = 3; pLen <= maxPfx; pLen++) {
        indexSetAdd(prefixToItems, 'w:' + word.substring(0, pLen), i);
      }
    }

    // --- Trigram index ---
    // Generate trigrams from nameNorm and alias1Norm
    for (let j = 0; j <= nameNorm.length - 3; j++) {
      indexSetAdd(trigramToItems, nameNorm.substring(j, j + 3), i);
    }
    if (alias1Norm.length >= 3) {
      for (let j = 0; j <= alias1Norm.length - 3; j++) {
        indexSetAdd(trigramToItems, alias1Norm.substring(j, j + 3), i);
      }
    }

    // --- Brand / parent group indexes ---
    if (it.main_group) {
      indexSetAdd(brandGroups, it.main_group, i);
    }
    if (it.parent_group) {
      indexSetAdd(parentGroups, it.parent_group, i);
    }
  }

  const firstCharToKeys = new Map<string, string[]>();
  for (const key of wordToItems.keys()) {
    if (key.length < 3) continue;
    const ch = key[0];
    let arr = firstCharToKeys.get(ch);
    if (!arr) {
      arr = [];
      firstCharToKeys.set(ch, arr);
    }
    arr.push(key);
  }

  _idx = {
    all,
    idToIndex,
    byName, byAlias, byAlias1, byNormAlias, byNormAlias1,
    wordToItems,
    firstCharToKeys,
    prefixToItems,
    trigramToItems,
    brandGroups,
    parentGroups,
  };

  return _idx;
}

// Re-export strip for use in itemSearch.ts
export { strip, soundex };
