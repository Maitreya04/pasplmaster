// Matches normalized OCR items against the live catalog using code lookups, prefixes, and search ranking.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Item } from '../../types';
import { buildSearchIndex, type SearchIndex } from '../search/searchIndex';
import { searchItems, type SearchResult } from '../search/itemSearch';
import type { ItemMatch, MatchedItem, MatchConfidence, NormalizedItem } from './types';

const ITEM_SELECT =
  'id,name,alias,alias1,parent_group,main_group,item_category,sales_price,mrp,stock_qty,rack_no';
const BATCH_SIZE = 1000;
const CATALOG_CACHE = new WeakMap<SupabaseClient, Promise<{ items: Item[]; index: SearchIndex }>>();

function normalizeCode(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? '';
}

function generateOcrConfusableCodes(code: string): string[] {
  const trimmed = code.trim();
  if (!trimmed) return [];

  const variants = new Set<string>([trimmed]);
  const chars = [...trimmed];
  const hasLetter = chars.some((char) => /[A-Za-z]/.test(char));
  const hasDigit = chars.some((char) => /\d/.test(char));

  chars.forEach((char, index) => {
    const previous = chars[index - 1] ?? '';
    const next = chars[index + 1] ?? '';
    const nearLetter = /[A-Za-z]/.test(previous) || /[A-Za-z]/.test(next);
    const nearDigit = /\d/.test(previous) || /\d/.test(next);

    if (char === '0' && (nearLetter || (hasLetter && index <= 2))) {
      const candidate = [...chars];
      candidate[index] = 'O';
      variants.add(candidate.join(''));
    }

    if ((char === 'O' || char === 'o') && (nearDigit || (hasDigit && index <= 2))) {
      const candidate = [...chars];
      candidate[index] = char === 'o' ? '0' : '0';
      variants.add(candidate.join(''));
    }
  });

  const leadingZeroRun = trimmed.match(/^[A-Za-z]+0{1,3}/);
  if (leadingZeroRun) {
    const prefixLength = trimmed.match(/^[A-Za-z]+/)?.[0].length ?? 0;
    const candidate = [...chars];
    candidate[prefixLength] = 'O';
    variants.add(candidate.join(''));
  }

  return Array.from(variants);
}

function compareConfidence(a: MatchConfidence, b: MatchConfidence): number {
  const order: MatchConfidence[] = ['none', 'low', 'medium', 'high'];
  return order.indexOf(a) - order.indexOf(b);
}

function promoteConfidence(value: MatchConfidence): MatchConfidence {
  if (value === 'low') return 'medium';
  if (value === 'medium') return 'high';
  return value;
}

function toItemMatch(item: Pick<Item, 'name' | 'alias' | 'alias1' | 'main_group' | 'parent_group'>): ItemMatch {
  return {
    item_code: item.alias1?.trim() || item.alias?.trim() || '',
    item_name: item.name,
    alias: item.alias,
    alias1: item.alias1,
    brand: item.main_group ?? '',
    group_name: item.parent_group ?? item.main_group ?? '',
  };
}

function dedupeMatches(items: Item[]): ItemMatch[] {
  const seen = new Set<string>();
  const matches: ItemMatch[] = [];
  for (const item of items) {
    const match = toItemMatch(item);
    const key = `${match.item_name}|${match.alias1 ?? ''}|${match.alias ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    matches.push(match);
  }
  return matches;
}

function rankByPrefixDistance(candidates: ItemMatch[], cleanCode: string): ItemMatch[] {
  return [...candidates].sort((a, b) => {
    const aLen = Math.min(
      Math.abs((a.alias1 ?? '').length - cleanCode.length),
      Math.abs((a.alias ?? '').length - cleanCode.length),
    );
    const bLen = Math.min(
      Math.abs((b.alias1 ?? '').length - cleanCode.length),
      Math.abs((b.alias ?? '').length - cleanCode.length),
    );
    return aLen - bLen;
  });
}

function applyHistoryBoost(candidates: ItemMatch[], customerHistory: Set<string>): ItemMatch[] {
  if (customerHistory.size === 0 || candidates.length <= 1) return candidates;
  return [...candidates].sort((a, b) => {
    const aScore = customerHistory.has(a.item_name.toLowerCase()) ? 1 : 0;
    const bScore = customerHistory.has(b.item_name.toLowerCase()) ? 1 : 0;
    return bScore - aScore;
  });
}

function boostCandidates(
  candidates: ItemMatch[],
  customerHistory: Set<string>,
): { candidates: ItemMatch[]; boosted: boolean } {
  const ranked = applyHistoryBoost(candidates, customerHistory);
  if (ranked.length !== candidates.length) {
    return { candidates: ranked, boosted: false };
  }
  const boosted =
    ranked.length > 1 &&
    ranked.some((candidate, index) => candidate.item_name !== candidates[index]?.item_name);
  return { candidates: ranked, boosted };
}

function applyVariantNarrowing(
  item: NormalizedItem,
  candidates: ItemMatch[],
  confidence: MatchConfidence,
): { candidates: ItemMatch[]; confidence: MatchConfidence } {
  if (item.variant_flags.length === 0 || candidates.length <= 1) {
    return { candidates, confidence };
  }

  const loweredFlags = item.variant_flags.map((flag) => flag.toLowerCase());
  const narrowed = candidates.filter((candidate) => {
    const haystack = `${candidate.item_name} ${candidate.alias ?? ''} ${candidate.alias1 ?? ''}`.toLowerCase();
    return loweredFlags.some((flag) => haystack.includes(flag));
  });

  if (narrowed.length === 0) {
    return { candidates, confidence };
  }

  return {
    candidates: narrowed,
    confidence: narrowed.length === 1 ? promoteConfidence(confidence) : confidence,
  };
}

async function fetchActiveItems(supabase: SupabaseClient): Promise<Item[]> {
  const { count, error: countError } = await supabase
    .from('items')
    .select('id', { count: 'exact', head: true })
    .eq('is_active', true);

  if (countError) throw countError;
  if (!count) return [];

  const batches = Math.ceil(count / BATCH_SIZE);
  const results = await Promise.all(
    Array.from({ length: batches }, (_, index) => {
      const from = index * BATCH_SIZE;
      return supabase
        .from('items')
        .select(ITEM_SELECT)
        .eq('is_active', true)
        .range(from, from + BATCH_SIZE - 1)
        .order('id');
    }),
  );

  const items: Item[] = [];
  for (const result of results) {
    if (result.error) throw result.error;
    items.push(...(result.data ?? []));
  }
  return items;
}

async function getCatalogCache(supabase: SupabaseClient): Promise<{ items: Item[]; index: SearchIndex }> {
  let cached = CATALOG_CACHE.get(supabase);
  if (!cached) {
    cached = fetchActiveItems(supabase).then((items) => ({
      items,
      index: buildSearchIndex(items),
    }));
    CATALOG_CACHE.set(supabase, cached);
  }
  return cached;
}

async function getCustomerHistory(supabase: SupabaseClient, customerId?: string): Promise<Set<string>> {
  if (!customerId) return new Set<string>();

  const { data: customer, error: customerError } = await supabase
    .from('customers')
    .select('name')
    .eq('id', customerId)
    .maybeSingle<{ name: string }>();

  if (customerError || !customer?.name) {
    return new Set<string>();
  }

  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('customer_top_items')
    .select('item_name')
    .eq('customer_name', customer.name)
    .gte('last_ordered', cutoff);

  if (error) return new Set<string>();
  return new Set((data ?? []).map((row) => String(row.item_name).toLowerCase()));
}

function getDescriptionConfidence(results: SearchResult[]): MatchConfidence {
  const top = results[0];
  if (!top) return 'none';
  if (results.length === 1 && ['exact-name', 'exact-alias', 'normalized', 'prefix', 'word-prefix'].includes(top.matchType)) {
    return 'medium';
  }
  if (top.score >= 180 && (results[1] ? top.score - results[1].score >= 40 : true)) {
    return 'medium';
  }
  return 'low';
}

export async function matchItems(
  normalizedItems: NormalizedItem[],
  supabase: SupabaseClient,
  customer_id?: string,
): Promise<MatchedItem[]> {
  const customerHistory = await getCustomerHistory(supabase, customer_id);
  const matches: MatchedItem[] = normalizedItems.map((item) => ({
    ...item,
    match_result: null,
    confidence: 'none',
    match_candidates: [],
    match_strategy: 'none',
    match_explanation: 'No catalog match found yet.',
    history_boosted: false,
  }));

  const codeItems = matches.filter((item) => item.clean_code);
  const exactCodes = Array.from(
    new Set(
      codeItems.flatMap((item) => {
        const code = item.clean_code ?? '';
        return generateOcrConfusableCodes(code).flatMap((variant) => [
          variant,
          variant.toUpperCase(),
          variant.toLowerCase(),
        ]);
      }).filter(Boolean),
    ),
  );

  if (exactCodes.length > 0) {
    const [aliasResult, alias1Result] = await Promise.all([
      supabase.from('items').select(ITEM_SELECT).eq('is_active', true).in('alias', exactCodes),
      supabase.from('items').select(ITEM_SELECT).eq('is_active', true).in('alias1', exactCodes),
    ]);
    if (aliasResult.error) throw aliasResult.error;
    if (alias1Result.error) throw alias1Result.error;

    const exactRows = [...(aliasResult.data ?? []), ...(alias1Result.data ?? [])];
    for (const item of codeItems) {
      const code = normalizeCode(item.clean_code);
      const codeVariants = new Set(generateOcrConfusableCodes(item.clean_code ?? '').map(normalizeCode));
      const candidates = dedupeMatches(
        exactRows.filter((row) =>
          [row.alias, row.alias1]
            .map((value) => normalizeCode(value))
            .some((value) => codeVariants.has(value)),
        ),
      );
      if (candidates.length > 0) {
        const recoveredByVariant = candidates.some((candidate) => {
          const candidateCodes = [candidate.alias, candidate.alias1].map((value) => normalizeCode(value));
          return candidateCodes.some((value) => value !== code && codeVariants.has(value));
        });
        item.match_candidates = candidates;
        item.match_result = candidates[0];
        item.confidence = candidates.length === 1 ? 'high' : 'medium';
        item.match_strategy = 'exact_code';
        item.match_explanation =
          candidates.length === 1
            ? recoveredByVariant
              ? 'Exact code hit after recovering a likely OCR 0/O confusion.'
              : 'Exact code hit against alias/alias1 in the catalog.'
            : recoveredByVariant
              ? 'Multiple exact code hits found after OCR 0/O recovery; review alternatives.'
              : 'Multiple exact code hits found; review alternatives.';
      }
    }
  }

  const prefixReady = matches.filter((item) =>
    compareConfidence(item.confidence, 'medium') < 0 && (item.clean_code?.length ?? 0) >= 6,
  );
  const prefixMap = new Map<MatchedItem, string[]>();
  const uniquePrefixes = new Set<string>();
  for (const item of prefixReady) {
    const code = item.clean_code ?? '';
    const prefixes = Array.from(
      new Set(
        generateOcrConfusableCodes(code)
          .flatMap((variant) => [variant.slice(0, -1), variant.slice(0, -2)])
          .map((value) => value.toLowerCase())
          .filter(Boolean),
      ),
    );
    prefixMap.set(item, prefixes);
    for (const prefix of prefixes) uniquePrefixes.add(prefix);
  }

  if (uniquePrefixes.size > 0) {
    const orFilters = Array.from(uniquePrefixes).flatMap((prefix) => [
      `alias.ilike.${prefix}%`,
      `alias1.ilike.${prefix}%`,
    ]);
    const prefixResult = await supabase
      .from('items')
      .select(ITEM_SELECT)
      .eq('is_active', true)
      .or(orFilters.join(','));

    if (prefixResult.error) throw prefixResult.error;
    const prefixRows = prefixResult.data ?? [];

    for (const item of prefixReady) {
      const prefixes = prefixMap.get(item) ?? [];
      const originalPrefixes = new Set(
        [item.clean_code?.slice(0, -1), item.clean_code?.slice(0, -2)]
          .map((value) => normalizeCode(value))
          .filter(Boolean),
      );
      let candidates = dedupeMatches(
        prefixRows.filter((row) =>
          prefixes.some((prefix) =>
            normalizeCode(row.alias).startsWith(prefix) || normalizeCode(row.alias1).startsWith(prefix),
          ),
        ),
      );
      const recoveredByVariant = candidates.some((candidate) => {
        const candidateCodes = [candidate.alias, candidate.alias1].map((value) => normalizeCode(value));
        return candidateCodes.some(
          (value) => value && !Array.from(originalPrefixes).some((prefix) => value.startsWith(prefix)),
        );
      });
      const boosted = boostCandidates(candidates, customerHistory);
      candidates = rankByPrefixDistance(boosted.candidates, item.clean_code ?? '');
      const narrowed = applyVariantNarrowing(item, candidates, 'medium');
      if (narrowed.candidates.length === 0) continue;
      if (narrowed.candidates.length > 3) {
        item.match_candidates = [];
        item.match_result = null;
        item.confidence = 'none';
        item.match_strategy = 'none';
        item.match_explanation = 'Code prefix matched too many catalog rows to choose safely.';
        continue;
      }
      item.match_candidates = narrowed.candidates;
      item.match_result = narrowed.candidates[0] ?? null;
      item.confidence = narrowed.confidence;
      item.match_strategy = 'prefix_code';
      item.match_explanation =
        narrowed.candidates.length === 1
          ? recoveredByVariant
            ? 'Prefix code match narrowed to a single catalog item after OCR 0/O recovery.'
            : 'Prefix code match narrowed to a single catalog item.'
          : recoveredByVariant
            ? 'Prefix code match found a small review set after OCR 0/O recovery.'
            : 'Prefix code match found a small review set.';
      item.history_boosted = boosted.boosted;
    }
  }

  const unresolved = matches.filter((item) => compareConfidence(item.confidence, 'medium') < 0);
  if (unresolved.length === 0) {
    return matches;
  }

  const { index } = await getCatalogCache(supabase);
  for (const item of unresolved) {
    const query = item.expanded_description || item.clean_code || item.raw_text;
    const searchResults = searchItems(query, index).slice(0, 3);
    const candidates = searchResults.map((result) => toItemMatch(result.item));
    const boosted = boostCandidates(candidates, customerHistory);
    const narrowed = applyVariantNarrowing(item, boosted.candidates, getDescriptionConfidence(searchResults));
    item.match_candidates = narrowed.candidates;
    item.match_result = narrowed.candidates[0] ?? null;
    item.confidence = narrowed.candidates.length > 0 ? narrowed.confidence : 'none';
    item.match_strategy = narrowed.candidates.length > 0 ? 'description_search' : 'none';
    item.match_explanation =
      narrowed.candidates.length > 0
        ? `Catalog search matched by description terms (${searchResults[0]?.matchType ?? 'search'}).`
        : 'No description search candidates were found in the catalog.';
    item.history_boosted = boosted.boosted;
  }

  return matches;
}
