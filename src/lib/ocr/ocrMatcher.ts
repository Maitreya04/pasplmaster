import type { OrderItem } from '../../types';
import {
  BRANDS,
  VEHICLE_TOKENS,
  PRODUCT_TYPE_TOKENS,
  NOISE_LINE_PATTERNS,
  NOISE_PHRASES,
  BATCH_CODE_RE,
  MRP_PATTERNS,
  PER_NUMBER_RE,
  QUANTITY_PATTERNS,
  type BrandConfig,
} from './brandPatterns';
import {
  extractPartNumberCandidates,
  normalizeForPartMatch,
} from './partNumberExtractor';

/* ═══════════════════════════════════════════════════════════════════════════
 *  Public types
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface SignalDetail {
  signal: string;
  score: number;
  maxScore: number;
  detail: string;
  /**
   * True when this signal result came from a direct comparison against a
   * part-code style candidate (alias/alias1), rather than the item name.
   * Used to allow a fast-path "code match = verified" rule.
   */
  directCodeMatch?: boolean;
}

export interface OcrMatchResult {
  isMatch: boolean;
  confidence: number;
  matchedFields: string[];
  signals: SignalDetail[];
  ocrExtracted: {
    partNumber: string | null;
    description: string | null;
    mrp: number | null;
    brand: string | null;
    vehicleModel: string | null;
  };
  matchStrategy: string;
}

/* ─── Internal extracted fields ───────────────────────────────────────── */

interface ExtractedFields {
  brand: BrandConfig | null;
  partNumbers: string[];
  vehicleTokens: string[];
  productTypeTokens: string[];
  unitMrp: number | null;
  rawMrp: number | null;
  quantity: number | null;
  perNumberPrice: number | null;
  cleanedText: string;
  allText: string;
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  Layer 1 — Noise removal
 * ═══════════════════════════════════════════════════════════════════════════ */

function removeNoise(text: string): string {
  let cleaned = text;

  const lines = cleaned.split('\n');
  const kept: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (BATCH_CODE_RE.test(trimmed)) continue;
    if (NOISE_LINE_PATTERNS.some((re) => re.test(trimmed))) continue;
    kept.push(trimmed);
  }
  cleaned = kept.join('\n');

  for (const re of NOISE_PHRASES) {
    cleaned = cleaned.replace(re, ' ');
  }

  return cleaned.replace(/\s{2,}/g, ' ').trim();
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  Layer 2 — Brand-aware field extraction
 * ═══════════════════════════════════════════════════════════════════════════ */

function detectBrand(text: string): BrandConfig | null {
  for (const brand of BRANDS) {
    for (const re of brand.detect) {
      if (re.test(text)) return brand;
    }
  }
  return null;
}

function extractPartNumbers(
  text: string,
  brand: BrandConfig | null,
): string[] {
  const results: string[] = extractPartNumberCandidates(text).map((c) => c.value);

  // Ensure brand patterns are still applied even if brand detection fails inside
  // the extractor due to partial OCR.
  if (brand) {
    for (const re of brand.partNumberPatterns) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        results.push((m[0] ?? '').trim());
      }
    }
  }

  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const r of results) {
    const key = normalizeForPartMatch(r);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    ordered.push(r);
  }
  return ordered;
}

function extractMrp(text: string): number | null {
  for (const re of MRP_PATTERNS) {
    re.lastIndex = 0;
    const m = re.exec(text);
    if (m) {
      const val = parseFloat(m[1].replace(/,/g, ''));
      if (!isNaN(val) && val > 0) return val;
    }
  }
  return null;
}

function extractPerNumberPrice(text: string): number | null {
  PER_NUMBER_RE.lastIndex = 0;
  const m = PER_NUMBER_RE.exec(text);
  if (!m) return null;
  const val = parseFloat(m[1].replace(/,/g, ''));
  return isNaN(val) ? null : val;
}

function extractQuantity(text: string): number | null {
  for (const re of QUANTITY_PATTERNS) {
    re.lastIndex = 0;
    const m = re.exec(text);
    if (m) {
      const val = parseInt(m[1], 10);
      if (val > 0 && val <= 10000) return val;
    }
  }
  return null;
}

function extractVehicleTokens(text: string): string[] {
  const tokens: string[] = [];
  for (const [re, toks] of VEHICLE_TOKENS) {
    re.lastIndex = 0;
    if (re.test(text)) {
      tokens.push(...toks);
    }
  }
  return [...new Set(tokens)];
}

function extractProductTypeTokens(text: string): string[] {
  const tokens: string[] = [];
  for (const [re, toks] of PRODUCT_TYPE_TOKENS) {
    re.lastIndex = 0;
    if (re.test(text)) {
      tokens.push(...toks);
    }
  }
  return [...new Set(tokens)];
}

function extractFields(ocrText: string): ExtractedFields {
  const cleanedText = removeNoise(ocrText);
  const brand = detectBrand(ocrText);
  const partNumbers = extractPartNumbers(ocrText, brand);
  const vehicleTokens = extractVehicleTokens(ocrText);
  const productTypeTokens = extractProductTypeTokens(ocrText);
  const rawMrp = extractMrp(ocrText);
  const quantity = extractQuantity(ocrText);
  const perNumberPrice = extractPerNumberPrice(ocrText);

  let unitMrp: number | null = null;
  if (perNumberPrice !== null) {
    unitMrp = perNumberPrice;
  } else if (rawMrp !== null && quantity !== null && quantity > 1) {
    unitMrp = Math.round((rawMrp / quantity) * 100) / 100;
  } else {
    unitMrp = rawMrp;
  }

  return {
    brand,
    partNumbers,
    vehicleTokens,
    productTypeTokens,
    unitMrp,
    rawMrp,
    quantity,
    perNumberPrice,
    cleanedText,
    allText: ocrText,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  Utility helpers
 * ═══════════════════════════════════════════════════════════════════════════ */

function normalize(s: string): string {
  return s.replace(/[\s.\-/\\(),:;'"]+/g, '').toLowerCase();
}

/**
 * Generates alternate normalised forms of a string by substituting characters
 * that Tesseract commonly confuses on auto-part labels:
 *   L ↔ 1,  O ↔ 0,  I ↔ 1,  S ↔ 5,  B ↔ 8,  Z ↔ 2
 * This lets "130" match "L30" and "P0L30" match "POL30", etc.
 */
function ocrVariants(norm: string): string[] {
  const base = norm.toLowerCase();
  const variants = new Set<string>([base]);

  const swaps: [RegExp, string][] = [
    [/l/g, '1'], [/1/g, 'l'],
    [/o/g, '0'], [/0/g, 'o'],
    [/i/g, '1'], [/s/g, '5'], [/5/g, 's'],
    [/b/g, '8'], [/8/g, 'b'],
    [/z/g, '2'], [/2/g, 'z'],
  ];

  for (const [re, replacement] of swaps) {
    const v = base.replace(re, replacement);
    if (v !== base) variants.add(v);
  }

  // Two-pass: apply swaps to each already-generated variant once
  const firstPass = [...variants];
  for (const v of firstPass) {
    for (const [re, replacement] of swaps) {
      const v2 = v.replace(re, replacement);
      if (v2 !== v) variants.add(v2);
    }
  }

  return [...variants];
}

/** True if any variant of `a` equals, contains, or is contained by any variant of `b`. */
function fuzzyOcrContains(a: string, b: string): boolean {
  for (const va of ocrVariants(a)) {
    for (const vb of ocrVariants(b)) {
      if (
        (vb.length >= 3 && va.includes(vb)) ||
        (va.length >= 3 && vb.includes(va))
      ) {
        return true;
      }
    }
  }
  return false;
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[\s.\-/\\(),:;'"]+/)
    .filter((t) => t.length > 0);
}

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

function maxAllowedDistance(length: number): number {
  if (length <= 3) return 0;
  if (length <= 6) return 1;
  if (length <= 10) return 2;
  return 3;
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  Layer 3 — Multi-signal matching
 * ═══════════════════════════════════════════════════════════════════════════ */

function getCodeCandidates(
  item: OrderItem,
  itemAlias1?: string | null,
): string[] {
  return [item.item_alias, itemAlias1].filter(
    (s): s is string => !!s && s.length > 0,
  );
}

function getNameCandidates(item: OrderItem): string[] {
  return [item.item_name].filter(
    (s): s is string => !!s && s.length > 0,
  );
}

/* Signal 1: Part number (max 40) ─────────────────────────────────────── */

function scorePartNumber(
  extracted: ExtractedFields,
  codeCandidates: string[],
  nameCandidates: string[],
): SignalDetail {
  const MAX = 40;

  // 1) Strong matches against known part codes (alias / alias1)
  for (const partNum of extracted.partNumbers) {
    const normPart = normalize(partNum);
    for (const cand of codeCandidates) {
      if (normalize(cand) === normPart) {
        return {
          signal: 'partNumber',
          score: MAX,
          maxScore: MAX,
          detail: `exact(code): "${partNum}" = "${cand}"`,
          directCodeMatch: true,
        };
      }
    }
  }

  for (const partNum of extracted.partNumbers) {
    const normPart = normalize(partNum);
    for (const cand of codeCandidates) {
      const normCand = normalize(cand);
      if (
        (normCand.length >= 3 && normPart.includes(normCand)) ||
        (normPart.length >= 3 && normCand.includes(normPart))
      ) {
        return {
          signal: 'partNumber',
          score: 35,
          maxScore: MAX,
          detail: `contained(code): "${partNum}" ~ "${cand}"`,
          directCodeMatch: true,
        };
      }
      // Retry with OCR character-confusion variants (L↔1, O↔0, etc.)
      if (normPart !== normCand && fuzzyOcrContains(normPart, normCand)) {
        return {
          signal: 'partNumber',
          score: 30,
          maxScore: MAX,
          detail: `contained-ocr-variant(code): "${partNum}" ~ "${cand}"`,
          directCodeMatch: true,
        };
      }
    }
  }

  const normOcr = normalize(extracted.cleanedText);
  for (const cand of codeCandidates) {
    const normCand = normalize(cand);
    if (normCand.length >= 4 && normOcr.includes(normCand)) {
      return {
        signal: 'partNumber',
        score: 30,
        maxScore: MAX,
        detail: `text-contains(code): "${cand}" in cleaned OCR`,
        directCodeMatch: true,
      };
    }
    // Try OCR confusion variants on the full cleaned text too
    if (normCand.length >= 3) {
      for (const variantOcr of ocrVariants(normOcr)) {
        for (const variantCand of ocrVariants(normCand)) {
          if (variantCand.length >= 3 && variantOcr.includes(variantCand)) {
            return {
              signal: 'partNumber',
              score: 28,
              maxScore: MAX,
              detail: `text-contains-ocr-variant(code): "${cand}" in cleaned OCR`,
              directCodeMatch: true,
            };
          }
        }
      }
    }
  }

  for (const partNum of extracted.partNumbers) {
    const normPart = normalize(partNum);
    for (const cand of codeCandidates) {
      const normCand = normalize(cand);
      const dist = levenshtein(normPart, normCand);
      const maxDist = maxAllowedDistance(
        Math.min(normPart.length, normCand.length),
      );
      if (dist > 0 && dist <= maxDist) {
        return {
          signal: 'partNumber',
          score: 25,
          maxScore: MAX,
          detail: `fuzzy(code,d=${dist}): "${partNum}" ~ "${cand}"`,
          directCodeMatch: true,
        };
      }
    }
  }

  // 2) Softer matches against the item name only. These never count as a
  // direct code match and use lower scores so other signals must agree.

  for (const partNum of extracted.partNumbers) {
    const normPart = normalize(partNum);
    for (const cand of nameCandidates) {
      if (normalize(cand) === normPart) {
        return {
          signal: 'partNumber',
          score: 25,
          maxScore: MAX,
          detail: `exact(name): "${partNum}" = "${cand}"`,
          directCodeMatch: false,
        };
      }
    }
  }

  for (const partNum of extracted.partNumbers) {
    const normPart = normalize(partNum);
    for (const cand of nameCandidates) {
      const normCand = normalize(cand);
      if (
        (normCand.length >= 3 && normPart.includes(normCand)) ||
        (normPart.length >= 3 && normCand.includes(normPart))
      ) {
        return {
          signal: 'partNumber',
          score: 20,
          maxScore: MAX,
          detail: `contained(name): "${partNum}" ~ "${cand}"`,
          directCodeMatch: false,
        };
      }
    }
  }

  for (const cand of nameCandidates) {
    const normCand = normalize(cand);
    if (normCand.length >= 4 && normOcr.includes(normCand)) {
      return {
        signal: 'partNumber',
        score: 15,
        maxScore: MAX,
        detail: `text-contains(name): "${cand}" in cleaned OCR`,
        directCodeMatch: false,
      };
    }
  }

  for (const partNum of extracted.partNumbers) {
    const normPart = normalize(partNum);
    for (const cand of nameCandidates) {
      const normCand = normalize(cand);
      const dist = levenshtein(normPart, normCand);
      const maxDist = maxAllowedDistance(
        Math.min(normPart.length, normCand.length),
      );
      if (dist > 0 && dist <= maxDist) {
        return {
          signal: 'partNumber',
          score: 10,
          maxScore: MAX,
          detail: `fuzzy(name,d=${dist}): "${partNum}" ~ "${cand}"`,
          directCodeMatch: false,
        };
      }
    }
  }

  return {
    signal: 'partNumber',
    score: 0,
    maxScore: MAX,
    detail: 'no match',
    directCodeMatch: false,
  };
}

/* Signal 2: Brand (max 15) ───────────────────────────────────────────── */

function scoreBrand(
  extracted: ExtractedFields,
  itemName: string,
  mainGroup: string | null,
): SignalDetail {
  const MAX = 15;
  if (!extracted.brand) {
    return { signal: 'brand', score: 0, maxScore: MAX, detail: 'no brand detected' };
  }

  const nameLower = itemName.toLowerCase();
  const groupLower = (mainGroup ?? '').toLowerCase();

  for (const token of extracted.brand.nameTokens) {
    if (nameLower.includes(token) || groupLower.includes(token)) {
      return {
        signal: 'brand',
        score: MAX,
        maxScore: MAX,
        detail: `${extracted.brand.id} matches item`,
      };
    }
  }

  return {
    signal: 'brand',
    score: 0,
    maxScore: MAX,
    detail: `${extracted.brand.id} not in item name/group`,
  };
}

/* Signal 3: Vehicle model (max 20) ───────────────────────────────────── */

function scoreVehicleModel(
  extracted: ExtractedFields,
  itemName: string,
): SignalDetail {
  const MAX = 20;
  if (extracted.vehicleTokens.length === 0) {
    return { signal: 'vehicle', score: 0, maxScore: MAX, detail: 'no vehicle detected' };
  }

  const nameTokens = new Set(tokenize(itemName));
  let hits = 0;
  const matched: string[] = [];

  for (const vt of extracted.vehicleTokens) {
    if (nameTokens.has(vt)) {
      hits++;
      matched.push(vt);
    }
  }

  if (hits === 0) {
    return {
      signal: 'vehicle',
      score: 0,
      maxScore: MAX,
      detail: `OCR:[${extracted.vehicleTokens.join(',')}] none in item`,
    };
  }

  const ratio = hits / extracted.vehicleTokens.length;
  const score = Math.round(MAX * Math.min(1, ratio * 1.5));
  return {
    signal: 'vehicle',
    score: Math.min(score, MAX),
    maxScore: MAX,
    detail: `matched:[${matched.join(',')}] ${hits}/${extracted.vehicleTokens.length}`,
  };
}

/* Signal 4: MRP (max 15) ─────────────────────────────────────────────── */

function scoreMrp(
  extracted: ExtractedFields,
  itemMrp: number | undefined,
): SignalDetail {
  const MAX = 15;
  if (extracted.unitMrp === null || !itemMrp || itemMrp <= 0) {
    return { signal: 'mrp', score: 0, maxScore: MAX, detail: 'no MRP to compare' };
  }

  const tolerance = itemMrp * 0.02;
  if (Math.abs(extracted.unitMrp - itemMrp) <= tolerance) {
    return {
      signal: 'mrp',
      score: MAX,
      maxScore: MAX,
      detail: `OCR:${extracted.unitMrp} ~ DB:${itemMrp} (within 2%)`,
    };
  }

  const looseTolerance = itemMrp * 0.05;
  if (Math.abs(extracted.unitMrp - itemMrp) <= looseTolerance) {
    return {
      signal: 'mrp',
      score: 10,
      maxScore: MAX,
      detail: `OCR:${extracted.unitMrp} ~ DB:${itemMrp} (within 5%)`,
    };
  }

  return {
    signal: 'mrp',
    score: 0,
    maxScore: MAX,
    detail: `OCR:${extracted.unitMrp} vs DB:${itemMrp} (mismatch)`,
  };
}

/* Signal 5: Product type (max 10) ────────────────────────────────────── */

function scoreProductType(
  extracted: ExtractedFields,
  itemName: string,
): SignalDetail {
  const MAX = 10;
  if (extracted.productTypeTokens.length === 0) {
    return { signal: 'productType', score: 0, maxScore: MAX, detail: 'no type detected' };
  }

  const nameTokens = new Set(tokenize(itemName));
  let hits = 0;
  const matched: string[] = [];

  for (const pt of extracted.productTypeTokens) {
    if (nameTokens.has(pt)) {
      hits++;
      matched.push(pt);
    }
  }

  if (hits === 0) {
    return {
      signal: 'productType',
      score: 0,
      maxScore: MAX,
      detail: `OCR:[${extracted.productTypeTokens.join(',')}] none in item`,
    };
  }

  const ratio = hits / extracted.productTypeTokens.length;
  const score = ratio >= 0.5 ? MAX : Math.round(MAX * ratio);
  return {
    signal: 'productType',
    score: Math.min(score, MAX),
    maxScore: MAX,
    detail: `matched:[${matched.join(',')}]`,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  Layer 4 — Confidence aggregation & public API
 * ═══════════════════════════════════════════════════════════════════════════ */

const MIN_SIGNALS_FOR_MATCH = 2;
const MATCH_THRESHOLD = 55;

export function matchOcrToItem(
  ocrText: string,
  expectedItem: OrderItem,
  itemMrp?: number,
  itemMainGroup?: string | null,
  itemAlias1?: string | null,
): OcrMatchResult {
  const extracted = extractFields(ocrText);
  const codeCandidates = getCodeCandidates(expectedItem, itemAlias1);
  const nameCandidates = getNameCandidates(expectedItem);

  const partSignal = scorePartNumber(extracted, codeCandidates, nameCandidates);

  const signals: SignalDetail[] = [
    partSignal,
    scoreBrand(extracted, expectedItem.item_name, itemMainGroup ?? null),
    scoreVehicleModel(extracted, expectedItem.item_name),
    scoreMrp(extracted, itemMrp),
    scoreProductType(extracted, expectedItem.item_name),
  ];

  const totalScore = signals.reduce((sum, s) => sum + s.score, 0);
  const firingSignals = signals.filter((s) => s.score > 0);
  const confidence = Math.min(100, totalScore);

  const hasDirectCodeMatch =
    partSignal.directCodeMatch === true && partSignal.score >= 30;

  const isMatch = hasDirectCodeMatch
    ? true
    : firingSignals.length >= MIN_SIGNALS_FOR_MATCH &&
      confidence >= MATCH_THRESHOLD;

  const bestSignal = signals.reduce((best, s) =>
    s.score > best.score ? s : best,
  );

  const matchedFields = firingSignals.map((s) => s.signal);

  const strategyMap: Record<string, string> = {
    partNumber: 'part_number',
    brand: 'brand',
    vehicle: 'vehicle_model',
    mrp: 'mrp',
    productType: 'product_type',
  };

  return {
    isMatch,
    confidence,
    matchedFields,
    signals,
    ocrExtracted: {
      partNumber: extracted.partNumbers[0] ?? null,
      description: null,
      mrp: extracted.unitMrp,
      brand: extracted.brand?.id ?? null,
      vehicleModel: extracted.vehicleTokens.length > 0
        ? extracted.vehicleTokens.join(' ')
        : null,
    },
    matchStrategy: bestSignal.score > 0
      ? (strategyMap[bestSignal.signal] ?? bestSignal.signal)
      : 'none',
  };
}
