# How search works (PASPL web app)

This document describes the **current** implementation: the **`SearchIndex`** (`src/lib/search/searchIndex.ts`), **`searchItems()`** (`src/lib/search/itemSearch.ts`), the **narrow-by** UI index (`src/lib/search/narrowSuggestions.ts`), and how **New Order** wires them (`src/pages/sales/NewOrderPage.tsx`).

---

## 1. Big picture

1. **Items load** → `buildSearchIndex(items)` runs once and builds hash maps + inverted lists (exact keys, words, `firstCharToKeys` for fuzzy key lookup, prefixes, trigrams, brand/parent groups), plus per-item **`fullTextLower`** (concatenated searchable text).
2. **User types** → the query is **normalized** (lowercase, shorthand expansion, optional model-code variants).
3. **`searchItems(query, index, brandFilter, groupFilter, detectedBrand?)`** runs **(A)** fast **exact / normalized / code-like** lookups (`collectFastPathResults`), **(B)** the **primary pasplv1-style path** (`v1UnionSearch`: union of word postings + fuzzy index-key fallback, per-token scoring, full-catalog fallback when the union is empty), then **`mergeResultsByMaxScore`**, then **`applyRankingBoosts`**, then **sort** and **slice** to `MAX_RESULTS`.
4. **UI** (`New Order`) uses **immediate** `query` for narrow chips and **`useDeferredValue`** for the heavy search so typing stays responsive.

---

## 2. Index (build time)

**File:** `src/lib/search/searchIndex.ts`

For each item, a **`PrepItem`** stores:

- Lowercase strings: `nameLower`, `aliasLower`, `alias1Lower`
- **Stripped** (no spaces/punctuation): `nameNorm`, `aliasNorm`, `alias1Norm` via `strip()`
- **`nameWords`** (split words)
- **`fullTextLower`**: concatenated lowercase text from name, aliases, `parent_group`, `main_group`, `item_category` (for substring scoring, pasplv1-style).
- **`allWords`**: tokens from name, aliases, `parent_group`, `main_group`, `item_category`, plus small expansions for model codes (e.g. `dio` + `05` → `dio05`)
- **`allPhonetics`**: Soundex codes for words with length ≥ 4

**Maps on `SearchIndex`:**

| Structure | Purpose |
|-----------|---------|
| `byName`, `byAlias`, `byAlias1` | Exact string → list of item indices |
| `byNormAlias`, `byNormAlias1` | Stripped alias → indices |
| `wordToItems` | Word (length ≥ 2) → **set** of item indices |
| `firstCharToKeys` | First character of each index key (len ≥ 3) → list of keys (for fuzzy index-key fallback) |
| `prefixToItems` | Prefixes **3–10 chars** from name/alias/alias1 (raw + norm); word-boundary keys use `w:` + prefix |
| `trigramToItems` | 3-char substrings of `nameNorm` and `alias1Norm` |
| `brandGroups` / `parentGroups` | `main_group` / `parent_group` → item indices |
| `idToIndex` | `item.id` → index in `all[]` |

The index is **memoized** on the same `items` array reference (see `_ref` / `_idx` in `buildSearchIndex`).

---

## 3. Query normalization

**Export:** `normalizeQuery(q)` in `itemSearch.ts`

- Split on whitespace, lowercase.
- Each token passes through **`expandToken()`**: `SHORTHAND_MAP` (e.g. `rr` → `rear`, `hh` → `hero honda`) then **`EXPAND_MAP`** from `abbreviations.ts`.
- Tokens with **both letters and digits** may get extra variants (base + numeric forms) for model-style codes.
- **Deduplicated** tokens are joined with spaces; this string is what most layers use as **`q`**.

**`detectCodeLike(q)`** (exported): true for long numeric codes, codes with separators, short alphanumeric **letter+digit** patterns, etc. Used to enable **raw / OEM-prefixed** alias and prefix lookups in the fast path (`collectFastPathResults`); the **union** scoring path still runs for all queries.

---

## 4. Brand / group filters

**`getFilteredSet()`** intersects `brandGroups.get(brandFilter)` and `parentGroups.get(groupFilter)` when set. Every layer checks **`passesFilter(index, filterSet)`** so filters are **hard** constraints.

**`detectedBrand`** (optional, from UI): **not** a filter; it is used only in **`applyRankingBoosts()`** (+20 when `item.main_group` matches).

---

## 5. `searchItems()` pipeline (runtime)

**File:** `src/lib/search/itemSearch.ts`  
**Constants:** `POOL_LIMIT = 320` (candidate cap for fast-path collection), `MAX_RESULTS = 72` (final slice), `STRONG_THRESHOLD = 72` (used elsewhere).

There is **no** cascade “first-match-wins” `seen` set. Fast path and union path are **merged by max score** per `item.id`.

### Phase A — Fast path (`collectFastPathResults`)

| Layer | Condition | Score | Field |
|-------|-----------|-------|--------|
| `exact-name` | `q` matches `byName` | 100 | name |
| `exact-alias` | `q` matches `byAlias` / `byAlias1` | 100 | alias / alias1 |
| `normalized` | stripped `q` matches `byNormAlias` / `byNormAlias1` | 95 | alias / alias1 |

**When `detectCodeLike`:** uses **raw** stripped query for norm/prefix lookups; **OEM brand prefix** resolution (`tidck`, `inel`, …) prepended to short codes; prefix hits via `prefixToItems` with scores **90 / 88 / 85** as implemented.

### Phase B — Primary pasplv1 path (`v1UnionSearch`)

1. **Significant tokens** = words with length ≥ 2.
2. **Union** of `wordToItems.get(w)` for each token (any item that appears for **any** token).
3. **Fuzzy index-key fallback** (pasplv1): for tokens with no posting list, scan **`firstCharToKeys`** for keys with same first letter, length within 2, Levenshtein **similarity ≥ 0.8**, and add their postings.
4. If the union is still **empty**, score the **filtered full catalog** (capped at **`MAX_UNION_SCORE_INDICES` (9000)**).
5. Otherwise cap union size at **9000** (sorted by index, truncate).
6. **`scorePrepItemBySalesTokens`:** per token **+100** (word in `allWords`), else **+60** substring on **`fullTextLower`** / stripped norms, else **+60** fuzzy (`tokenFuzzyMatches`), else **+55** Soundex (length ≥ 4) → + **+150** if **all** tokens matched.

### Phase C — Merge and boosts

1. **`mergeResultsByMaxScore(fast, union)`** — higher score per `item.id` wins.
2. **`applyRankingBoosts`:**  
   - `detectedBrand` match → **+20** on `main_group`  
   - `parent_group` token overlap with query (noise guard if too many groups) → **+15**

**Final:** sort by **score desc**, then **name**; **`slice(0, MAX_RESULTS)`**.

---

## 6. Narrow-by (UI chips, not the main search)

**File:** `src/lib/search/narrowSuggestions.ts`

- **`buildNarrowIndex(items)`** precomputes counts and `itemsByBrand`, `itemsByParentGroup`, `countsByBrandGroup`, etc.
- **`buildNarrowSuggestions(index, rawQuery, activeBrand, activeGroup)`** uses **`normalizeQuery`** and the **last token** (length ≥ 2) to suggest brands/groups whose **words** **prefix-match** that token, plus **focused-brand** behavior (same as before) to enrich group chips.

**New Order** may **hide** generic narrow chips when **search** is already strong (`STRONG_THRESHOLD`, min result count, etc.) while still showing brand/subcategory chips when a brand is selected or detected.

---

## 7. New Order page wiring

**File:** `src/pages/sales/NewOrderPage.tsx`

- **`buildSearchIndex(items)`** once per items array.
- **`SearchInput`** uses **`debounceMs={0}`** so **parent state** updates every keystroke; **`useDeferredValue(effectiveQuery)`** drives **`searchItems`** so expensive work can **lag** slightly behind typing.
- **Detected brand** for search boosts uses the same **`buildNarrowSuggestions`** heuristic as on the deferred query (single dominant brand chip).
- **Results:** “Best match” = top **3** of `searchResults` with score ≥ **80**; “More results” = **remaining** ids (no duplicate rows). **Show more** reveals **more** rows in chunks (`INITIAL_MORE_VISIBLE` / `MORE_RESULTS_PAGE`).
- **Highlighting** in the list uses **`normalizeQuery`** plus **raw** tokens for display (see `highlightText` in the same file).

---

## 8. Related docs

- `docs/PASPLV1_SEARCH_LEARNINGS.md` — historical parity notes with pasplv1  
- `docs/PRESSURE_TEST_SEARCH.md` — load / stress tests for search  

If behavior changes, update the **constants** and **layer comments** in `itemSearch.ts` (`searchIndex.ts` header comment block) and this file.
