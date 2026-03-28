# How search works (PASPL web app)

This document describes the **current** implementation: the **`SearchIndex`** (`src/lib/search/searchIndex.ts`), **`searchItems()`** (`src/lib/search/itemSearch.ts`), the **narrow-by** UI index (`src/lib/search/narrowSuggestions.ts`), and how **New Order** wires them (`src/pages/sales/NewOrderPage.tsx`).

---

## 1. Big picture

1. **Items load** → `buildSearchIndex(items)` runs once and builds hash maps + inverted lists (exact keys, words, prefixes, trigrams, brand/parent groups).
2. **User types** → the query is **normalized** (lowercase, shorthand expansion, optional model-code variants).
3. **`searchItems(query, index, brandFilter, groupFilter, detectedBrand?)`** runs a **layered cascade** (exact → keywords → prefix → discovery → fuzzy/phonetic), then merges in a **union-token** pass for sparse sales shorthand, then applies **bonuses**, then **sorts** and **slices** to `MAX_RESULTS`.
4. **UI** (`New Order`) uses **immediate** `query` for narrow chips and **`useDeferredValue`** for the heavy search so typing stays responsive.

---

## 2. Index (build time)

**File:** `src/lib/search/searchIndex.ts`

For each item, a **`PrepItem`** stores:

- Lowercase strings: `nameLower`, `aliasLower`, `alias1Lower`
- **Stripped** (no spaces/punctuation): `nameNorm`, `aliasNorm`, `alias1Norm` via `strip()`
- **`nameWords`** (split words)
- **`allWords`**: tokens from name, aliases, `parent_group`, `main_group`, `item_category`, plus small expansions for model codes (e.g. `dio` + `05` → `dio05`)
- **`allPhonetics`**: Soundex codes for words with length ≥ 4

**Maps on `SearchIndex`:**

| Structure | Purpose |
|-----------|---------|
| `byName`, `byAlias`, `byAlias1` | Exact string → list of item indices |
| `byNormAlias`, `byNormAlias1` | Stripped alias → indices |
| `wordToItems` | Word (length ≥ 2) → **set** of item indices |
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

**`detectCodeLike(q)`** (exported): true for long numeric codes, codes with separators, short alphanumeric **letter+digit** patterns, etc. **Code-like** queries **skip** the union-token merge and fuzzy path in ways described below.

---

## 4. Brand / group filters

**`getFilteredSet()`** intersects `brandGroups.get(brandFilter)` and `parentGroups.get(groupFilter)` when set. Every layer checks **`passesFilter(index, filterSet)`** so filters are **hard** constraints.

**`detectedBrand`** (optional, from UI): **not** a filter; it is used only in **`applyRankingBoosts()`** (+20 when `item.main_group` matches).

---

## 5. `searchItems()` pipeline (runtime)

**File:** `src/lib/search/itemSearch.ts`  
**Constants:** `POOL_LIMIT = 320` (candidate cap during cascade), `MAX_RESULTS = 72` (final slice), `STRONG_THRESHOLD = 72` (used elsewhere).

Results accumulate in **`results`** with a **`seen`** set per **`item.id`**. Order of **layers** matters; **first** win per item is kept by **seen**, except the **union-token merge** later can **raise** scores via **`mergeResultsByMaxScore`**.

### Phase 1 — Exact lookups (O(1) maps)

| Layer | Condition | Score | Field |
|-------|-----------|-------|--------|
| `exact-name` | `q` matches `byName` | 100 | name |
| `exact-alias` | `q` matches `byAlias` / `byAlias1` | 100 | alias / alias1 |
| `normalized` | stripped `q` matches `byNormAlias` / `byNormAlias1` | 95 | alias / alias1 |

### Phase 1.5 — Code-like helpers (only when `detectCodeLike`)

- Uses **raw** stripped query for norm/prefix lookups (so expansion does not break codes).
- Prefix hits via `prefixToItems` for alias/name with scores **90 / 85** depending on field.
- **Brand prefix resolution**: short codes without spaces try known prefixes (`tidck`, `inel`, …) prepended to the raw token for exact + prefix matches.

### Phase 2 — Keywords + prefix + discovery

**Keyword posting lists** (`wordToItems` for each word in `qWords`):

- **Full intersect** (every word has a non-empty posting list): **intersect** all lists (smallest first), optional intersect with `filterSet`. Score **`KEYWORD_FULL_INTERSECT_SCORE` (92)**, **`matchType: 'keywords'`**.
- **Partial** (≥ 2 words, pool not full): items that **count** in at least **60%** of word postings get a **score proportional** to count (up to **80**), **`matchType: 'partial'`**.

**Prefix (`qNorm` length ≥ 3):** `prefixToItems.get(qNorm)` — verify alias/alias1/name start with `q` or `qNorm`; scores **88** (alias) / **85** (name).

**Word-prefix:** first word `qFirst` ≥ 3 chars → `prefixToItems.get('w:' + qFirst)` → score **75**, **`word-prefix`**.

**Brand / parent discovery** (non-code, pool not full): if `main_group` / `parent_group` **word** starts with `qFirst`, add items at **55** / **50** (keyword-style).

### Phase 3 — Fuzzy + phonetic (non-code only)

Runs only if **`results.length < FUZZY_PHASE_MAX_PRIOR_RESULTS` (100)**.

- **Trigram** lists from `qNorm` are **intersected** (up to 4 lists) to get a small candidate set.
- If query too short for trigrams, **all** indices are candidates (fallback).
- **Fuzzy:** `tokenFuzzyMatches` — substring in word set or Levenshtein **similarity ≥ 0.8** for tokens length ≥ 3. Multi-word: **all** tokens must fuzzy-match. Score **30**.
- **Phonetic:** Soundex on query words length ≥ 4 must all match `allPhonetics`. Score **25**.

### Phase 4 — Union-token pass (sales shorthand)

**When:** not code-like, **multi-word** (`qWords.length >= 2`).

**`pasplv1UnionTokenScore`:**

1. **Significant tokens** = words with length ≥ 2.
2. **Union** of `wordToItems.get(w)` for each token (any item that appears for **any** token).
3. Cap union size at **`MAX_UNION_SCORE_INDICES` (9000)** (sorted by index, truncate).
4. For each candidate, **`scorePrepItemBySalesTokens`** adds per-token points: exact word in `allWords` (+100), substring in a **search blob** (name+alias+groups+category) (+62), fuzzy (+58), phonetic (+55), + **+140** if **all** tokens matched.
5. **Merge** with cascade results: **`mergeResultsByMaxScore`** keeps the **higher score** per `item.id`.

This fixes queries where **no** row contains **all** tokens (empty keyword intersection) but many rows match **several** tokens strongly.

### Phase 5 — Post-processing (all surviving results)

1. **Multi-word overlap bonus:** for each result with score &lt; 100, add up to `min(overlap * 2, wordCount * 2)` where overlap counts **tokens** in `allWords` or substring in name/alias (length ≥ 3).
2. **`applyAllTokensMatchedBonus`:** if **all** tokens (length ≥ 2) are satisfied via `allWords` or substring in name/aliases → **+52**.
3. **`applyRankingBoosts`:**  
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
