import type { OrderItem } from '../../types';

export interface OcrMatchResult {
  isMatch: boolean;
  confidence: number;
  matchedFields: string[];
  ocrExtracted: {
    partNumber: string | null;
    description: string | null;
    mrp: number | null;
  };
  matchStrategy: string;
}

interface ExtractedFields {
  partNumbers: string[];
  description: string | null;
  mrp: number | null;
  allText: string;
}

/* ─── Normalization ──────────────────────────────────────────── */

function normalize(s: string): string {
  return s.replace(/[\s.\-/\\(),:;'"]+/g, '').toLowerCase();
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[\s.\-/\\(),:;'"]+/)
    .filter((t) => t.length > 0);
}

/* ─── Levenshtein Distance ───────────────────────────────────── */

function levenshtein(a: string, b: string): number {
  const la = a.length;
  const lb = b.length;
  if (la === 0) return lb;
  if (lb === 0) return la;

  const prev = new Uint16Array(lb + 1);
  const curr = new Uint16Array(lb + 1);

  for (let j = 0; j <= lb; j++) prev[j] = j;

  for (let i = 1; i <= la; i++) {
    curr[0] = i;
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    prev.set(curr);
  }

  return prev[lb];
}

/**
 * Proportional fuzzy threshold: short codes need exact/near-exact,
 * longer strings allow more tolerance to avoid matching S75 -> S73.
 */
function maxAllowedDistance(length: number): number {
  if (length <= 3) return 0;
  if (length <= 6) return 1;
  if (length <= 10) return 2;
  return 3;
}

/* ─── Field Extraction ───────────────────────────────────────── */

function extractPartNumbers(text: string): string[] {
  const results: string[] = [];

  // Labeled "PART NUMBER:" or "PART NO.:" values
  const labeledRe = /PART\s*(?:NUMBER|NO\.?)\s*[:.]?\s*([A-Z0-9/\-\s]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = labeledRe.exec(text)) !== null) {
    const val = m[1].trim().split(/\n/)[0].trim();
    if (val.length >= 2) results.push(val);
  }

  // Slash-separated codes: ASK/NA/DBP/0538
  const slashRe = /\b[A-Z]{2,5}\/[A-Z0-9]+(?:\/[A-Z0-9]+)+\b/gi;
  while ((m = slashRe.exec(text)) !== null) {
    results.push(m[0]);
  }

  // Pure numeric 4-6 digit codes (but not years like 2025, 2026 or phone fragments)
  const numericRe = /\b(\d{4,6})\b/g;
  while ((m = numericRe.exec(text)) !== null) {
    const val = m[1];
    const num = parseInt(val, 10);
    if (num >= 2020 && num <= 2035) continue;
    if (val.length >= 4) results.push(val);
  }

  // Short alphanumeric codes: S75 NC, S75NC
  const shortRe = /\b([A-Z]\d{2,3}\s?[A-Z]{1,3})\b/gi;
  while ((m = shortRe.exec(text)) !== null) {
    results.push(m[1]);
  }

  // Deduplicate
  const seen = new Set<string>();
  return results.filter((r) => {
    const key = normalize(r);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractMRP(text: string): number | null {
  const mrpRe = /M\.?R\.?P\.?\s*[:.]?\s*(?:Rs\.?|₹)\s*([\d,]+(?:\.\d{1,2})?)/gi;
  const m = mrpRe.exec(text);
  if (!m) return null;
  const val = parseFloat(m[1].replace(/,/g, ''));
  return isNaN(val) ? null : val;
}

function extractDescription(text: string): string | null {
  const descRe = /DESCRIPTION\s*[:.]?\s*(.+)/i;
  const m = descRe.exec(text);
  if (!m) return null;
  return m[1].trim().split(/\n/)[0].trim() || null;
}

function extractFields(ocrText: string): ExtractedFields {
  return {
    partNumbers: extractPartNumbers(ocrText),
    description: extractDescription(ocrText),
    mrp: extractMRP(ocrText),
    allText: ocrText,
  };
}

/* ─── Matching Strategies ────────────────────────────────────── */

function getCandidates(item: OrderItem): string[] {
  return [item.item_alias, item.item_name]
    .filter((s): s is string => !!s && s.length > 0);
}

function tryExactPartNumber(
  extracted: ExtractedFields,
  candidates: string[],
): { score: number; matched: string; field: string } | null {
  for (const partNum of extracted.partNumbers) {
    const normPart = normalize(partNum);
    for (const cand of candidates) {
      if (normalize(cand) === normPart) {
        return { score: 100, matched: cand, field: 'partNumber' };
      }
    }
  }
  return null;
}

function tryNormalizedContainment(
  extracted: ExtractedFields,
  candidates: string[],
): { score: number; matched: string; field: string } | null {
  const normOcr = normalize(extracted.allText);
  for (const cand of candidates) {
    const normCand = normalize(cand);
    if (normCand.length >= 3 && normOcr.includes(normCand)) {
      return { score: 90, matched: cand, field: 'containment' };
    }
  }

  // Also check if extracted part numbers are contained in candidates
  for (const partNum of extracted.partNumbers) {
    const normPart = normalize(partNum);
    for (const cand of candidates) {
      const normCand = normalize(cand);
      if (normCand.includes(normPart) && normPart.length >= 3) {
        return { score: 85, matched: cand, field: 'partNumber' };
      }
    }
  }

  return null;
}

function tryTokenOverlap(
  extracted: ExtractedFields,
  candidates: string[],
): { score: number; matched: string; field: string } | null {
  const ocrTokens = new Set(tokenize(extracted.allText));

  let bestScore = 0;
  let bestMatched = '';

  for (const cand of candidates) {
    const candTokens = tokenize(cand);
    if (candTokens.length === 0) continue;
    let matchCount = 0;
    for (const token of candTokens) {
      if (ocrTokens.has(token)) matchCount++;
    }
    const overlap = matchCount / candTokens.length;
    if (overlap > bestScore) {
      bestScore = overlap;
      bestMatched = cand;
    }
  }

  if (bestScore >= 0.8) {
    return { score: 75, matched: bestMatched, field: 'tokenOverlap' };
  }
  if (bestScore >= 0.6) {
    return { score: 55, matched: bestMatched, field: 'tokenOverlap' };
  }

  return null;
}

function tryFuzzyPartNumber(
  extracted: ExtractedFields,
  candidates: string[],
): { score: number; matched: string; field: string } | null {
  for (const partNum of extracted.partNumbers) {
    const normPart = normalize(partNum);
    for (const cand of candidates) {
      const normCand = normalize(cand);
      const dist = levenshtein(normPart, normCand);
      const maxDist = maxAllowedDistance(Math.min(normPart.length, normCand.length));
      if (dist <= maxDist && dist > 0) {
        return { score: 60, matched: cand, field: 'fuzzy' };
      }
    }
  }
  return null;
}

/* ─── Main Matcher ───────────────────────────────────────────── */

const STRATEGY_MAP: Record<string, string> = {
  partNumber: 'exact_alias',
  containment: 'normalized_containment',
  tokenOverlap: 'token_overlap',
  fuzzy: 'fuzzy',
};

export function matchOcrToItem(
  ocrText: string,
  expectedItem: OrderItem,
  itemMrp?: number,
): OcrMatchResult {
  const extracted = extractFields(ocrText);
  const candidates = getCandidates(expectedItem);

  const strategies = [
    tryExactPartNumber,
    tryNormalizedContainment,
    tryTokenOverlap,
    tryFuzzyPartNumber,
  ];

  let bestResult: { score: number; matched: string; field: string } | null = null;

  for (const strategy of strategies) {
    const result = strategy(extracted, candidates);
    if (result && (!bestResult || result.score > bestResult.score)) {
      bestResult = result;
      if (result.score >= 90) break;
    }
  }

  let score = bestResult?.score ?? 0;
  const matchedFields: string[] = bestResult ? [bestResult.field] : [];

  // MRP bonus: if extracted MRP matches item MRP within 1%
  if (extracted.mrp !== null && itemMrp && itemMrp > 0) {
    const tolerance = itemMrp * 0.01;
    if (Math.abs(extracted.mrp - itemMrp) <= tolerance) {
      score = Math.min(100, score + 15);
      matchedFields.push('mrp');
    }
  }

  return {
    isMatch: score >= 60,
    confidence: score,
    matchedFields,
    ocrExtracted: {
      partNumber: extracted.partNumbers[0] ?? null,
      description: extracted.description,
      mrp: extracted.mrp,
    },
    matchStrategy: bestResult ? (STRATEGY_MAP[bestResult.field] ?? bestResult.field) : 'none',
  };
}
