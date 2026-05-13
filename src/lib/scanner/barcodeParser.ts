export type MatchStrategy = 'exact' | 'prefix_hyphen' | 'prefix_space' | 'structured_field' | 'manual';

export interface ParsedBarcode {
  raw: string;
  key: string;
  strategy: MatchStrategy;
  looksSerialised: boolean;
  strippedSuffix: string | null;
  /** All part-number candidates extracted, best first. Used by auto-suggest. */
  candidates: string[];
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

export function parseManufacturerBarcode(raw: string): ParsedBarcode {
  const trimmed = raw.trim();
  const candidates: string[] = [];

  // ── Structured / multi-line payloads (TAFE, Mahindra, etc.) ──
  if (isStructuredText(trimmed)) {
    const extracted = extractPartNumberFromStructured(trimmed);
    if (extracted) {
      candidates.push(extracted);

      // Check if extracted part number itself has a serial suffix
      const cleaned = stripSerialSuffix(extracted);
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
      const cleaned = stripSerialSuffix(codeCandidate);
      if (cleaned.key !== codeCandidate) candidates.push(cleaned.key);
      return {
        raw: trimmed,
        key: codeCandidate,
        strategy: 'structured_field',
        looksSerialised: false,
        strippedSuffix: null,
        candidates,
      };
    }
  }

  // ── Simple serial-suffix stripping (original logic) ──
  const serialResult = stripSerialSuffix(trimmed);
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
  };
}

/**
 * Strip serial/batch suffixes from a barcode value.
 * Handles patterns like:
 *   - "1310C03801-17102231402"  (hyphen + 6+ digit serial)
 *   - "ABC123 987654"           (space + 6+ digit serial)
 */
function stripSerialSuffix(value: string): {
  key: string;
  suffix: string | null;
  strategy: 'prefix_hyphen' | 'prefix_space' | 'exact';
} {
  const hyphenIdx = value.indexOf('-');
  if (hyphenIdx > 3 && hyphenIdx < value.length - 1) {
    const prefix = value.substring(0, hyphenIdx);
    const suffix = value.substring(hyphenIdx);
    if (/^-\d{6,}$/.test(suffix)) {
      return { key: prefix, suffix, strategy: 'prefix_hyphen' };
    }
  }

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
