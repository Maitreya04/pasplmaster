export type MatchStrategy =
  | 'exact'
  | 'prefix_hyphen'
  | 'prefix_space'
  | 'slash_separated'
  | 'structured_field'
  | 'manual'
  | 'varroc_url'
  | 'varroc_k'
  | 'varroc_printed'
  | 'varroc_sap_compact';

export interface ParsedBarcode {
  raw: string;
  key: string;
  strategy: MatchStrategy;
  looksSerialised: boolean;
  strippedSuffix: string | null;
  /** All part-number candidates extracted, best first. Used by auto-suggest. */
  candidates: string[];
  /** Optional quantity extracted from the barcode text (e.g., "1.000 N" -> 1). */
  extractedQuantity?: number;
}

/**
 * Known field labels used on manufacturer QR/barcode stickers.
 * Matched case-insensitively. The first capture group after the label is used.
 * Covers TAFE, Mahindra, TVS, Honda, Bajaj, and other OEM label formats.
 */
const PART_NUMBER_PATTERNS: RegExp[] = [
  /PART\s*(?:NUMBER|NO\.?|#)\s*[:\-–]?\s*([A-Z0-9][A-Z0-9.\-/]{3,})/i,
  /P\.?\s*NO?\.?\s*[:\-–]?\s*([A-Z0-9][A-Z0-9.\-/]{3,})/i,
  /ITEM\s*(?:CODE|NO\.?|#)\s*[:\-–]?\s*([A-Z0-9][A-Z0-9.\-/]{3,})/i,
  /MATERIAL\s*(?:CODE|NO\.?)\s*[:\-–]?\s*([A-Z0-9][A-Z0-9.\-/]{3,})/i,
  /SKU\s*[:\-–]?\s*([A-Z0-9][A-Z0-9.\-/]{3,})/i,
  /CAT\.?\s*(?:NO\.?|#)\s*[:\-–]?\s*([A-Z0-9][A-Z0-9.\-/]{3,})/i,
];

/**
 * Patterns for extracting quantity from structured text.
 * Covers "QTY: 10", "NUMBER OF COMMODITY: 1 N", etc.
 */
const QUANTITY_PATTERNS: RegExp[] = [
  /(?:QTY|QUANTITY|NO\.? OF COMMODITY|NUMBER OF COMMODITY)\s*[:\-–]?\s*([\d.]+)/i,
];

/**
 * Try to extract a part number from structured / multi-line QR text.
 * Returns the first matched group, trimmed, or null.
 */
function extractPartNumberFromStructured(text: string): string | null {
  for (const pattern of PART_NUMBER_PATTERNS) {
    const match = text.match(pattern);
    if (match?.[1]) {
      // Trim trailing dots or dashes that are label formatting artefacts
      return match[1].replace(/[.\-/]+$/, '').trim();
    }
  }
  return null;
}

function extractQuantityFromStructured(text: string): number | undefined {
  for (const pattern of QUANTITY_PATTERNS) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const qty = parseFloat(match[1]);
      if (!isNaN(qty) && qty > 0) return qty;
    }
  }
  return undefined;
}

/**
 * Detect whether a raw barcode value is multi-line / structured text
 * (as opposed to a simple code string).
 */
function isStructuredText(value: string): boolean {
  // Multi-line text
  if (/\n/.test(value)) return true;
  // Contains label-like patterns: "PART NUMBER:", "MRP:", "COMMODITY:" etc.
  if (/(?:PART|MRP|COMMODITY|PACKED|NUMBER|MATERIAL)\s*[:\-]/i.test(value)) return true;
  // Very long payloads (> 40 chars) with mixed content are likely structured
  if (value.length > 60 && /\s/.test(value)) return true;
  return false;
}

function ensureUrlScheme(rawValue: string): string | null {
  const v = rawValue.trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  if (/^www\./i.test(v)) return `https://${v}`;
  // Best-effort: allow bare hosts/shortlinks like "bit.ly/abc" or "example.com/xyz".
  if (!/\s/.test(v) && v.includes('/') && /^[a-z0-9.-]+\.[a-z]{2,}/i.test(v)) return `https://${v}`;
  if (!/\s/.test(v) && v.includes('/') && !v.includes(':')) return `https://${v}`;
  return null;
}

function looksLikePartKey(value: string): boolean {
  const key = value.trim().toUpperCase();
  if (!key) return false;
  if (key.length < 4 || key.length > 36) return false;
  if (/\n/.test(key)) return false;
  if (/\b(?:MRP|QTY|COMMODITY|NUMBER OF|PACKED)\b/.test(key)) return false;
  if (/^[A-Z0-9][A-Z0-9.\-]{3,}$/.test(key) && /[A-Z]/.test(key) && /\d/.test(key)) return true;
  if (/^\d{6,18}$/.test(key)) return true;
  return false;
}

function dedupeBarcodeCandidates(keys: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of keys) {
    const u = k.trim().toUpperCase();
    if (!u || seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}

/**
 * Varroc box QR URLs often end with `!{batch}!{K-code}`. Challan/SAP may list only `K` + first 9 digits
 * of a 13-digit body — when we have the full K from a scan, expose the compact key as an extra lookup.
 */
export function varrocKDerivedLookupKeys(normalizedK: string): string[] {
  const m = normalizedK.trim().toUpperCase().match(/^K(\d+)$/);
  if (!m) return [];
  const digits = m[1];
  if (digits.length !== 13) return [];
  return [`K${digits.slice(0, 9)}`];
}

/** Printed Varroc part number on label/challan (e.g. `BLKR-DSVR-JD07`). */
const VARROC_PRINTED_CODE = /^[A-Z]{3,5}-[A-Z0-9]+-[A-Z0-9]+$/i;

function tryParseVarrocVrstBang(raw: string): ParsedBarcode | null {
  if (!/vrst\.in\/bt\//i.test(raw)) return null;
  const m = raw.match(/!([A-Z0-9]{4,8})!(K\d{10,14})\s*$/i);
  if (!m) return null;
  const short = m[1].toUpperCase();
  const k = m[2].toUpperCase();
  const derived = varrocKDerivedLookupKeys(k);
  return {
    raw,
    key: k,
    strategy: 'varroc_url',
    looksSerialised: false,
    strippedSuffix: null,
    candidates: dedupeBarcodeCandidates([k, short, ...derived]),
  };
}

function tryParseBareVarrocK(raw: string): ParsedBarcode | null {
  const m = raw.match(/^K(\d{10,14})$/i);
  if (!m) return null;
  const k = `K${m[1]}`.toUpperCase();
  const derived = varrocKDerivedLookupKeys(k);
  return {
    raw,
    key: k,
    strategy: 'varroc_k',
    looksSerialised: false,
    strippedSuffix: null,
    candidates: dedupeBarcodeCandidates([k, ...derived]),
  };
}

/** Nine-digit body after K — common on Varroc SAP/challan extracts (differs from 13-digit scan payload). */
function tryParseVarrocSapCompact(raw: string): ParsedBarcode | null {
  const m = raw.match(/^K(\d{9})$/i);
  if (!m) return null;
  const k = `K${m[1]}`.toUpperCase();
  return {
    raw,
    key: k,
    strategy: 'varroc_sap_compact',
    looksSerialised: false,
    strippedSuffix: null,
    candidates: dedupeBarcodeCandidates([k]),
  };
}

function tryParseVarrocPrinted(raw: string): ParsedBarcode | null {
  if (/^https?:\/\//i.test(raw)) return null;
  if (!VARROC_PRINTED_CODE.test(raw)) return null;
  const key = raw.toUpperCase();
  return {
    raw,
    key,
    strategy: 'varroc_printed',
    looksSerialised: false,
    strippedSuffix: null,
    candidates: dedupeBarcodeCandidates([key]),
  };
}

function extractPartCandidatesFromUrl(rawValue: string): string[] {
  const urlStr = ensureUrlScheme(rawValue);
  if (!urlStr) return [];

  try {
    const url = new URL(urlStr);

    const queryKeys = [
      'code',
      'item',
      'sku',
      'alias',
      'alias1',
      // common vendor parameter names
      'part',
      'part_no',
      'partno',
      'pn',
      'product',
      'material',
      'model',
    ];

    const fromQuery = queryKeys
      .map((k) => url.searchParams.get(k)?.trim() ?? '')
      .filter(Boolean)
      .map((v) => v.toUpperCase());

    const fromPath = (url.pathname.match(/[A-Z0-9][A-Z0-9.\-]{3,}/gi) ?? []).map((v) => v.toUpperCase());
    const fromHash = (url.hash.match(/[A-Z0-9][A-Z0-9.\-]{3,}/gi) ?? []).map((v) => v.toUpperCase());

    const seen = new Set<string>();
    const out: string[] = [];

    for (const candidate of [...fromQuery, ...fromPath, ...fromHash]) {
      const maybe = candidate.trim().toUpperCase();
      if (!maybe) continue;
      if (!looksLikePartKey(maybe)) continue;
      if (seen.has(maybe)) continue;
      seen.add(maybe);
      out.push(maybe);
    }

    return out;
  } catch {
    // Fallback: many QR generators embed "URL-ish" strings that include unescaped
    // characters in the path (e.g. `]a$[@!E9...`). In that case, still attempt
    // to extract code-like tokens from the whole payload.
    const upper = rawValue.trim().toUpperCase();
    if (!upper) return [];

    // Remove leading scheme+host when present so we don't match domain fragments.
    const withoutHost = upper.replace(/^HTTPS?:\/\/[^/]+\/?/i, '');
    const tokens = withoutHost.match(/[A-Z0-9][A-Z0-9.\-]{3,}/g) ?? [];

    const seen = new Set<string>();
    const out: string[] = [];
    for (const token of tokens) {
      const maybe = token.trim().toUpperCase();
      if (!looksLikePartKey(maybe)) continue;
      if (seen.has(maybe)) continue;
      seen.add(maybe);
      out.push(maybe);
    }
    return out;
  }
}

export function parseManufacturerBarcode(raw: string): ParsedBarcode {
  const trimmed = raw.trim();
  const candidates: string[] = [];

  const varrocBang = tryParseVarrocVrstBang(trimmed);
  if (varrocBang) return varrocBang;

  const bareVarrocK = tryParseBareVarrocK(trimmed);
  if (bareVarrocK) return bareVarrocK;

  const varrocSapCompact = tryParseVarrocSapCompact(trimmed);
  if (varrocSapCompact) return varrocSapCompact;

  const varrocPrinted = tryParseVarrocPrinted(trimmed);
  if (varrocPrinted) return varrocPrinted;

  // If the QR payload is a URL/redirect, extract the part-number candidate from it
  // so admin mapping can proceed without treating the whole URL as "noisy QR data".
  const urlCandidates = extractPartCandidatesFromUrl(trimmed);
  if (urlCandidates.length > 0) {
    const cleaned: Array<ReturnType<typeof stripBarcodeSuffixes>> = urlCandidates.map((c) =>
      stripBarcodeSuffixes(c),
    );

    const best = cleaned[0];
    for (const c of urlCandidates) candidates.push(c);
    if (best.key !== urlCandidates[0]) candidates.push(best.key);

    return {
      raw: trimmed,
      key: best.key,
      strategy: best.strategy,
      looksSerialised: best.key !== urlCandidates[0],
      strippedSuffix: best.key !== urlCandidates[0] ? best.suffix : null,
      candidates,
    };
  }

  // ── Structured / multi-line payloads (TAFE, Mahindra, etc.) ──
  if (isStructuredText(trimmed)) {
    const extracted = extractPartNumberFromStructured(trimmed);
    const extractedQuantity = extractQuantityFromStructured(trimmed);

    if (extracted) {
      candidates.push(extracted);

      // Check if extracted part number itself has a serial suffix
      const cleaned = stripBarcodeSuffixes(extracted);
      if (cleaned.key !== extracted) {
        candidates.push(cleaned.key);
      }

      return {
        raw: trimmed,
        key: extracted,
        strategy: 'structured_field',
        looksSerialised: cleaned.key !== extracted,
        strippedSuffix: cleaned.key !== extracted ? cleaned.suffix : null,
        candidates,
        extractedQuantity,
      };
    }
    // Even if we couldn't find a labeled field, try the first "code-like" token
    // in the structured text (alphanumeric, 6+ chars with mixed letters+digits)
    const codeLikeMatch = trimmed.match(/\b([A-Z0-9]{2,}[A-Z][0-9][A-Z0-9]{2,})\b/i)
      ?? trimmed.match(/\b(\d{4,}[A-Z][A-Z0-9]{2,})\b/i)
      ?? trimmed.match(/\b([A-Z]{1,4}\d{4,}[A-Z0-9]*)\b/i);
    if (codeLikeMatch?.[1] && codeLikeMatch[1].length >= 6) {
      const codeCandidate = codeLikeMatch[1];
      candidates.push(codeCandidate);
      const cleaned = stripBarcodeSuffixes(codeCandidate);
      if (cleaned.key !== codeCandidate) candidates.push(cleaned.key);
      return {
        raw: trimmed,
        key: codeCandidate,
        strategy: 'structured_field',
        looksSerialised: false,
        strippedSuffix: null,
        candidates,
        extractedQuantity,
      };
    }
  }

  // ── Simple serial-suffix stripping (original logic) ──
  const serialResult = stripBarcodeSuffixes(trimmed);
  if (serialResult.key !== trimmed) {
    candidates.push(serialResult.key);
    candidates.push(trimmed);
    return {
      raw: trimmed,
      key: serialResult.key,
      strategy: serialResult.strategy,
      looksSerialised: true,
      strippedSuffix: serialResult.suffix,
      candidates,
      extractedQuantity: serialResult.extractedQuantity,
    };
  }

  // ── Plain barcode — no transformation needed ──
  candidates.push(trimmed);
  return {
    raw: trimmed,
    key: trimmed,
    strategy: 'exact',
    looksSerialised: false,
    strippedSuffix: null,
    candidates,
    extractedQuantity: serialResult.extractedQuantity,
  };
}

/**
 * Strip serial/batch suffixes and slash-separated metadata from a barcode value.
 * Handles patterns like:
 *   - "2125599K01/SEAL INNER/56.00/1.000 N/40169330" (slash-separated fields)
 *   - "1310C03801-17102231402"  (hyphen + 6+ digit serial)
 *   - "ABC123 987654"           (space + 6+ digit serial)
 */
function stripBarcodeSuffixes(value: string): {
  key: string;
  suffix: string | null;
  strategy: MatchStrategy;
  extractedQuantity?: number;
} {
  // Handle slash-separated records (PartNo/Desc/MRP/Qty...)
  const slashParts = value.split('/');
  if (slashParts.length >= 3) {
    const prefix = slashParts[0].trim();
    if (/^[A-Z0-9.\-]{4,}$/i.test(prefix)) {
      let extractedQuantity: number | undefined;
      // Qty is typically the 4th element (index 3) like "1.000 N" or "10 NOS"
      if (slashParts.length >= 4) {
        const qtyMatch = slashParts[3].match(/^([\d.]+)\s*(?:N|NOS|PCS)/i);
        if (qtyMatch) {
          const qty = parseFloat(qtyMatch[1]);
          if (!isNaN(qty) && qty > 0) extractedQuantity = qty;
        }
      }
      return { 
        key: prefix, 
        suffix: value.substring(prefix.length), 
        strategy: 'slash_separated',
        extractedQuantity
      };
    }
  }

  // Handle hyphen with serial
  const hyphenIdx = value.indexOf('-');
  if (hyphenIdx > 3 && hyphenIdx < value.length - 1) {
    const prefix = value.substring(0, hyphenIdx);
    const suffix = value.substring(hyphenIdx);
    if (/^-\d{6,}$/.test(suffix)) {
      return { key: prefix, suffix, strategy: 'prefix_hyphen' };
    }
  }

  // Handle space with serial
  const spaceIdx = value.indexOf(' ');
  if (spaceIdx > 3) {
    const afterSpace = value.substring(spaceIdx + 1);
    if (/^\d{6,}$/.test(afterSpace)) {
      return { key: value.substring(0, spaceIdx), suffix: ` ${afterSpace}`, strategy: 'prefix_space' };
    }
  }

  return { key: value, suffix: null, strategy: 'exact' };
}

export function normaliseBarcodeForLookup(raw: string): string {
  return parseManufacturerBarcode(raw).key;
}
