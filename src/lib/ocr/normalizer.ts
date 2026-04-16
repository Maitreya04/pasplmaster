// Normalizes raw OCR line items into searchable codes, descriptions, and review metadata.
import { ABBREVIATIONS } from '../abbreviations';
import { BRAND_PREFIXES } from '../search/itemSearch';
import type { GeminiRawItem, NormalizedItem } from './types';

const VARIANT_RULES: Array<{ flag: string; pattern: RegExp }> = [
  { flag: 'STD', pattern: /\bSTD\b/gi },
  { flag: 'OS', pattern: /\bOS\b/gi },
  { flag: 'NC', pattern: /\bNC\b/gi },
  { flag: 'BS6', pattern: /\bBS6\b/gi },
  { flag: 'RH', pattern: /\bRH\b/gi },
  { flag: 'LH', pattern: /\bLH\b/gi },
  { flag: '2P', pattern: /\b2P\b/gi },
  { flag: '4cyl', pattern: /\b4CYL\b/gi },
  { flag: '3cyl', pattern: /\b3CYL\b/gi },
  { flag: '0.25', pattern: /(?<!\d)0\.25(?!\d)/g },
  { flag: '0.50', pattern: /(?<!\d)0\.50(?!\d)/g },
  { flag: '0.75', pattern: /(?<!\d)0\.75(?!\d)/g },
  { flag: '1.00', pattern: /(?<!\d)1\.00(?!\d)/g },
];

const PRICING_PATTERNS = [
  /(?:^|\s)@\s*\d+(?:\.\d+)?/gi,
  /(?:^|\s)[a-z0-9+\- ]*\d+(?:\.\d+)?%/gi,
  /(?:^|\s)\S+\s*\/-/gi,
  /(?:^|\s)\+?\s*scheme\b[^,;]*/gi,
  /(?:^|\s)discount\b[^,;]*/gi,
] as const;

const VEHICLE_RULES: Array<{ pattern: RegExp; value: string }> = [
  { pattern: /\b(?:hero honda|hh)\b/i, value: 'Hero Honda' },
  { pattern: /\b(?:splendor|splndr|spl)\b/i, value: 'Splendor' },
  { pattern: /\b(?:activa|act n|actn)\b/i, value: 'Activa' },
  { pattern: /\b(?:shine|shne)\b/i, value: 'Shine' },
  { pattern: /\b(?:passion|pssn)\b/i, value: 'Passion' },
  { pattern: /\b(?:cd100|cd dawn)\b/i, value: 'CD100' },
  { pattern: /\b(?:pulsar|pul)\b/i, value: 'Pulsar' },
  { pattern: /\b(?:discover|dis)\b/i, value: 'Discover' },
  { pattern: /\bplatina\b/i, value: 'Platina' },
  { pattern: /\bglamour\b/i, value: 'Glamour' },
  { pattern: /\b(?:mhawk|m hawk)\b/i, value: 'Mahindra Scorpio' },
  { pattern: /\bblazon\b/i, value: 'Bajaj Discover Blazon' },
  { pattern: /\bquanto\b/i, value: 'Mahindra Quanto' },
  { pattern: /\bmaruti\b/i, value: 'Maruti' },
  { pattern: /\balto\b/i, value: 'Alto' },
  { pattern: /\bertiga\b/i, value: 'Ertiga' },
  { pattern: /\b(?:bolero|boleno)\b/i, value: 'Bolero' },
  { pattern: /\b(?:hindustani|hindustan)\b/i, value: 'Hindustan Motors' },
  { pattern: /\bra3\b/i, value: 'RA3 engine' },
  { pattern: /\bavl\b/i, value: 'AVL engine' },
  { pattern: /\b(?:psi|hut)\b/i, value: 'Hindustan Motors' },
  { pattern: /\bhonda\b/i, value: 'Honda' },
];

const BRAND_CODE_PATTERN = new RegExp(
  `\\b(?:${Array.from(BRAND_PREFIXES)
    .sort((a, b) => b.length - a.length)
    .map((prefix) => prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')})(?:[-/]*[A-Za-z0-9]+)+\\b`,
  'i',
);

function squeezeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function stripKnownQty(rawText: string, qty: number, qtyUnit: string): string {
  const unitPattern = qtyUnit === 'pcs' ? '(?:pcs|piece|pc|n-et|net)?' : `${qtyUnit}?`;
  const suffixPattern = new RegExp(
    `\\s*[-—]\\s*0*${qty}\\s*${unitPattern}\\s*$`,
    'i',
  );
  return squeezeWhitespace(rawText.replace(suffixPattern, ' '));
}

function extractVariantFlags(rawText: string): { flags: string[]; text: string } {
  const flags: string[] = [];
  let text = rawText;
  for (const { flag, pattern } of VARIANT_RULES) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) {
      flags.push(flag);
      pattern.lastIndex = 0;
      text = text.replace(pattern, ' ');
    }
  }
  return { flags, text: squeezeWhitespace(text) };
}

function extractPricingNote(rawText: string): { pricingNote: string | null; text: string } {
  const found = new Set<string>();
  let text = rawText;
  for (const pattern of PRICING_PATTERNS) {
    const matches = text.match(pattern) ?? [];
    for (const match of matches) {
      found.add(squeezeWhitespace(match));
    }
    text = text.replace(pattern, ' ');
  }
  return {
    pricingNote: found.size > 0 ? Array.from(found).join(' ').trim() : null,
    text: squeezeWhitespace(text),
  };
}

function detectVehicleContext(rawText: string): string | null {
  const match = VEHICLE_RULES.find((rule) => rule.pattern.test(rawText));
  return match?.value ?? null;
}

function findNumericCode(rawText: string): string | null {
  const tokens = rawText.match(/[A-Za-z0-9]+/g) ?? [];
  for (const token of tokens) {
    const digits = token.replace(/\D/g, '').length;
    const letters = token.replace(/[^A-Za-z]/g, '').length;
    if (digits >= 5 && letters <= 1 && /^\d|^\d+[A-Za-z]\d+$/.test(token)) {
      return token;
    }
  }
  return null;
}

function findBrandCode(rawText: string): string | null {
  return rawText.match(BRAND_CODE_PATTERN)?.[0] ?? null;
}

function expandCrToken(text: string): string {
  return text.replace(/\bcr(?=\s*\d)/gi, ABBREVIATIONS.cr ?? 'connecting rod');
}

function expandDescription(rawText: string): string {
  let expanded = squeezeWhitespace(rawText).toLowerCase();
  expanded = expandCrToken(expanded);

  const phraseEntries = Object.entries(ABBREVIATIONS)
    .filter(([key]) => key.includes(' ') || key.includes('-') || /[\u0900-\u097F]/.test(key))
    .sort((a, b) => b[0].length - a[0].length);

  for (const [key, value] of phraseEntries) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    expanded = expanded.replace(new RegExp(escaped, 'gi'), value);
  }

  const tokens = expanded
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => ABBREVIATIONS[token] ?? token);

  return squeezeWhitespace(tokens.join(' '));
}

function classifyTokenType(rawText: string): {
  tokenType: NormalizedItem['token_type'];
  cleanCode: string | null;
} {
  if (/[\u0900-\u097F]/.test(rawText)) {
    return { tokenType: 'hindi', cleanCode: null };
  }

  const brandCode = findBrandCode(rawText);
  if (brandCode) {
    return { tokenType: 'brand_code', cleanCode: brandCode };
  }

  const numericCode = findNumericCode(rawText);
  if (numericCode) {
    return { tokenType: 'numeric_code', cleanCode: numericCode };
  }

  if (/\b\d+(?:\.\d+)?x\d+(?:\.\d+)?(?:x\d+(?:\.\d+)?)?(?:\s*(?:hex|nut|bolt))?\b/i.test(rawText)) {
    return { tokenType: 'dimension', cleanCode: null };
  }

  return {
    tokenType: 'description',
    cleanCode: rawText.match(/\b[A-Za-z]{1,4}\d{2,}[A-Za-z0-9]*\b/)?.[0] ?? null,
  };
}

function normalizeSingleItem(item: GeminiRawItem): NormalizedItem {
  const qtyStripped = stripKnownQty(item.raw_text, item.qty, item.qty_unit);
  const { flags, text: variantStripped } = extractVariantFlags(qtyStripped);
  const { pricingNote, text: pricingStripped } = extractPricingNote(variantStripped);
  const vehicleContext = detectVehicleContext(item.raw_text);
  const { tokenType, cleanCode } = classifyTokenType(pricingStripped);
  const expandedDescription = expandDescription(pricingStripped);

  return {
    raw_text: item.raw_text,
    qty: item.qty,
    qty_unit: item.qty_unit,
    is_cancelled: item.is_cancelled,
    token_type: tokenType,
    clean_code: cleanCode,
    variant_flags: flags,
    expanded_description: expandedDescription,
    vehicle_context: vehicleContext,
    pricing_note: pricingNote,
  };
}

export function normalizeItems(rawItems: GeminiRawItem[]): NormalizedItem[] {
  return rawItems.map(normalizeSingleItem);
}
