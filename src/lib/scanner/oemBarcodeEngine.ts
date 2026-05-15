import type { SaveBarcodeMappingInput } from '../barcodeMapping';
import { parseManufacturerBarcode, type MatchStrategy, type ParsedBarcode } from './barcodeParser';

/** Row shape from Varroc challan / SAP CSV exports (e.g. `Varroc Mapping part 1.csv`). */
export interface VarrocChallanCsvRow {
  line_no?: string;
  varroc_part_code?: string;
  sap_item_code?: string;
  hsn_code?: string;
  description?: string;
  confidence?: string;
  handwritten_mrp?: string;
}

/** Single canonical mapping row for one challan line (K/SAP preferred over printed). */
export interface VarrocChallanMappingSuggestion {
  barcodeKey: string;
  matchStrategy: MatchStrategy;
  barcodeRaw: string;
}

export interface VarrocChallanNormalization {
  printedCode: string | null;
  sapCodeRaw: string;
  /** Length of digit run after `K`, when well-formed */
  sapDigitLen: number | null;
  /** Must fix or acknowledge before bulk save */
  issues: string[];
  /** Heuristic fixes — always verify against the physical label / PDF */
  sapFixSuggestions: string[];
  /** At most one canonical `item_barcodes` row per challan line */
  mappingSuggestions: VarrocChallanMappingSuggestion[];
}

/** Issues that require per-row acknowledgement before save (see Process Challan UI). */
export const VARROC_CHALLAN_BLOCKING_ISSUES = [
  'sap_invalid_non_digits_after_K',
  'source_row_confidence_low',
  'mrp_missing_on_row',
] as const;

export function rowHasBlockingChallanIssues(issues: string[]): boolean {
  const set = new Set<string>(VARROC_CHALLAN_BLOCKING_ISSUES);
  return issues.some((i) => set.has(i));
}

function sapBodyIsAllDigits(sap: string): boolean {
  const u = sap.trim().toUpperCase();
  if (!u.startsWith('K')) return false;
  const body = u.slice(1);
  return body.length > 0 && /^\d+$/.test(body);
}

function suggestVarrocSapFixes(sapUpper: string): string[] {
  const out: string[] = [];
  if (/^K353A10400$/i.test(sapUpper)) out.push('K353110400');
  if (/^K353A10300$/i.test(sapUpper)) out.push('K353110300');
  if (/^K3420106MK$/i.test(sapUpper)) {
    out.push('K342010600');
    out.push('K342010660');
  }
  return out;
}

/**
 * Validate one Varroc challan line and produce at most one canonical mapping (SAP/K preferred).
 */
export function normalizeVarrocChallanRow(row: VarrocChallanCsvRow): VarrocChallanNormalization {
  const printedRaw = (row.varroc_part_code ?? '').trim();
  const printedCode = printedRaw ? printedRaw.toUpperCase() : null;
  const sapCodeRaw = (row.sap_item_code ?? '').trim().toUpperCase();

  const issues: string[] = [];
  const sapFixSuggestions = suggestVarrocSapFixes(sapCodeRaw);

  if (!printedCode && !sapCodeRaw) {
    issues.push('missing_printed_and_sap');
    return {
      printedCode: null,
      sapCodeRaw,
      sapDigitLen: null,
      issues,
      sapFixSuggestions,
      mappingSuggestions: [],
    };
  }

  if (sapCodeRaw && !sapBodyIsAllDigits(sapCodeRaw)) {
    issues.push('sap_invalid_non_digits_after_K');
  }

  let sapDigitLen: number | null = null;
  if (sapCodeRaw.startsWith('K') && /^\d+$/.test(sapCodeRaw.slice(1))) {
    sapDigitLen = sapCodeRaw.length - 1;
  }

  const conf = (row.confidence ?? '').trim().toUpperCase();
  if (conf === 'LOW') issues.push('source_row_confidence_low');

  const mrp = (row.handwritten_mrp ?? '').trim();
  if (!mrp || mrp.toUpperCase() === 'MISSING') issues.push('mrp_missing_on_row');

  let mappingSuggestion: VarrocChallanMappingSuggestion | null = null;
  if (sapCodeRaw && sapBodyIsAllDigits(sapCodeRaw)) {
    const matchStrategy: MatchStrategy = sapDigitLen === 9 ? 'varroc_sap_compact' : 'varroc_k';
    mappingSuggestion = {
      barcodeKey: sapCodeRaw,
      matchStrategy,
      barcodeRaw: `varroc_challan_sap:${sapCodeRaw}`,
    };
  } else if (printedCode) {
    mappingSuggestion = {
      barcodeKey: printedCode,
      matchStrategy: 'varroc_printed',
      barcodeRaw: `varroc_challan_printed:${printedCode}`,
    };
  }

  return {
    printedCode,
    sapCodeRaw,
    sapDigitLen,
    issues: [...new Set(issues)],
    sapFixSuggestions,
    mappingSuggestions: mappingSuggestion ? [mappingSuggestion] : [],
  };
}

/** Payload for `saveBarcodeMapping` after a floor scan / manual preview. */
export function buildSaveInputForScan(
  parsed: ParsedBarcode,
  params: {
    skuBusyCode: number;
    binId?: string | null;
    manufacturer: string | null;
    mappedByUserId: number | null;
    mappedByName: string | null;
  },
): SaveBarcodeMappingInput {
  return {
    barcodeRaw: parsed.raw,
    barcodeKey: parsed.key,
    matchStrategy: parsed.strategy,
    skuBusyCode: params.skuBusyCode,
    binId: params.binId ?? null,
    manufacturer: params.manufacturer,
    mappedByUserId: params.mappedByUserId,
    mappedByName: params.mappedByName,
  };
}

export function buildSaveInputFromVarrocChallan(
  suggestion: VarrocChallanMappingSuggestion,
  params: {
    skuBusyCode: number;
    mappedByUserId: number | null;
    mappedByName: string | null;
  },
): SaveBarcodeMappingInput {
  return {
    barcodeRaw: suggestion.barcodeRaw,
    barcodeKey: suggestion.barcodeKey,
    matchStrategy: suggestion.matchStrategy,
    skuBusyCode: params.skuBusyCode,
    binId: null,
    manufacturer: 'VARROC',
    mappedByUserId: params.mappedByUserId,
    mappedByName: params.mappedByName,
  };
}

/** Single entry point: scan / paste / challan cell → parsed key + lookup candidates. */
export function parseOemBarcodePayload(raw: string): ParsedBarcode {
  return parseManufacturerBarcode(raw);
}
