# Learnings from pasplv1 — Product Search

This doc summarizes how **product search** works in [pasplv1](https://github.com/Maitreya04/pasplv1) and what we can reuse in pasplmaster.

---

## How product search is handled in pasplv1

### 1. **Pre-built search index (build time)**

- **Where:** `scripts/update-all-data.js` → `buildSearchIndex(items)`
- **What:** Builds a **token → product IDs** map from item name, alias, alias1, parentGroup, itemCat, itemMainGroup.
- **Output:** Shipped inside `products.json` as `searchIndex`. Client loads it once and uses it to narrow candidates before scoring.
- **Effect:** Avoids scanning all products for every keystroke; only products that have at least one of the query’s tokens are scored.

### 2. **intelligentSearch.ts — scoring and matching**

- **Query expansion (`expandQuery`):**
  - Tokenizes query (uppercase, split on non-alphanum).
  - **Misspellings:** Replaces known typos (e.g. ACITVA → ACTIVA, BREAK → BRAKE) using `MISSPELLINGS_MAP`.
  - **Abbreviations:** Expands shorthand (e.g. ACTV → ACTIVA, BRK → BRAKE, SPLD → SPLENDOR) using `ABBREVIATION_MAP` (vehicles, part_types, specifications).
  - **Model variants:** Expands patterns like `ABC-05` / `ABC 05` into `ABC`, `ABC05`, `ABC05` so “DIO 05” matches “DIO05” in product text.
- **Candidate narrowing:**
  - If `searchIndex` exists: `getCandidatesFromIndex(tokens, index)` returns product IDs that contain any of the expanded tokens.
  - Fallback: fuzzy match on **index keys** (same first letter, length within 2, Levenshtein similarity ≥ 0.8) so e.g. ACTVA still finds ACTIVA.
- **Product text:** `buildProductText(product)` concatenates name, alias, alias1, parentGroup, itemCat, itemMainGroup and builds a **word set** (including model variants like DIO05 from “DIO 05”).
- **Scoring (per product):**
  - Token in **word set** → +100.
  - Token in **full text** (substring) → +60.
  - Else: **Levenshtein** similarity ≥ 0.8 vs product words → +60.
  - Else: **Soundex** match (length ≥ 4) → +55.
  - If **all** tokens matched → +150 bonus.
- **Sort:** By score desc, then name, then id. Return top `limit` (e.g. 50).

### 3. **Data files**

- **`src/data/abbreviations.js`:** Vehicles (ACTV→ACTIVA, SPLD→SPLENDOR, …), part types (BRK→BRAKE, PSTN→PISTON, …), specs (FR→FRONT, RR→REAR, …).
- **`src/data/misspellings.js`:** Common typos and OCR-style confusions (0/O, 1/I, 8/B, etc.) for vehicle names, part names, brands.

### 4. **Customer autocomplete (separate from product search)**

- **Web Worker** (`app/lib/worker/search.worker.ts`) uses **Fuse.js** for fuzzy label search.
- **createIndexHandle()** in `intelligentSearch.ts` builds the worker, sends label/value items, and runs queries off the main thread.
- Used for customer name autocomplete, not for product search.

### 5. **Other ideas in pasplv1**

- **Dormant products:** Scripts analyze sales data and suggest “products this customer used to order” (e.g. `DormantProductsSuggestion.tsx`).
- **Customer intelligence:** Top products per customer, products by brand/group, used to show chips and quick-add suggestions.
- **OCR order scanner:** Matches scanned text to products (separate from the main search).

---

## Comparison with pasplmaster (current itemSearch.ts)

| Aspect | pasplv1 | pasplmaster |
|--------|---------|-------------|
| **Index** | Pre-built token→ids in JSON | In-memory maps: byName, byAlias, byAlias1, byNormAlias, byNormAlias1 |
| **Query normalization** | expandQuery: abbrev + misspell + model variants | normalizeQuery: lowercase, trim, small SHORTHAND_MAP (rr, fr, dlx, …) |
| **Candidate narrowing** | By token index first, then score only those | No token index; cascade over all items (with maps for exact/normalized) |
| **Matching layers** | Token in words / in text / fuzzy / soundex + “all matched” bonus | 9-layer cascade: exact name/alias → normalized → prefix → word-prefix → substring → keywords → partial → fuzzy |
| **Soundex** | Yes (phonetic typo) | No |
| **Abbreviation/misspelling data** | Full vehicles + parts + specs + OCR | Small inline map only |
| **Part-code detection** | — | detectCodeLike() for code-like queries |
| **Result type** | Product list | SearchResult with score, matchType, matchedField |

---

## What to apply in pasplmaster

1. **Query expansion (abbreviations + misspellings)**  
   Reuse pasplv1-style expansion (or a subset) in **normalizeQuery** or a dedicated expand step so that “actv brake”, “splndr”, “brek” etc. become “activa brake”, “splendor”, “brake”. Your existing cascade (prefix, substring, keyword, fuzzy) will then match more reliably.  
   **Done:** Abbreviation and misspelling maps added; `normalizeQuery` expanded to use them (see `src/lib/search/abbreviations.ts` and `itemSearch.ts`).

2. **Optional: token → ids index in buildIndex**  
   If the item list is large, add a `byToken: Map<string, number[]>` in `buildIndex` (each word from name/alias/alias1/parent_group/main_group/item_category), and in `searchItems` first collect candidate IDs from tokens, then run the existing cascade only on those candidates. This mirrors pasplv1’s “searchIndex” but computed in-memory.

3. **Optional: Soundex**  
   Add a phonetic step for longer tokens (e.g. ≥ 4 chars) as a fallback when Levenshtein doesn’t match, to catch typos like PISTN vs PISTON.

4. **Optional: model token variants**  
   For two-wheeler parts, expand “DIO 05” / “DIO-05” in both query and product text to DIO, DIO05, DIO 05 so prefix/substring layers match better.

5. **Customer/dormant suggestions**  
   If you have order history per customer, a “dormant products” or “frequently ordered” suggestion block (like pasplv1) can improve UX; that’s independent of the core product search.

---

## References in pasplv1 repo

- `app/lib/intelligentSearch.ts` — main search, expandQuery, getCandidatesFromIndex, buildProductText, scoring, createIndexHandle.
- `scripts/update-all-data.js` — buildSearchIndex, writing products.json with searchIndex.
- `src/data/abbreviations.js` — vehicle/part/spec mappings.
- `src/data/misspellings.js` — typos and OCR-style corrections.
- `app/lib/worker/search.worker.ts` — Fuse.js customer autocomplete (separate from product search).
- `app/page.tsx` — loads products.json/searchIndex, calls intelligentSearch(all, query, 50, searchIndex).
