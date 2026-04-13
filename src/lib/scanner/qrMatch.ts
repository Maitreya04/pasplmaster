import { firstAvailableCode } from '../../utils/itemCodes';

export interface QrMatchInput {
  rawValue: string;
  name: string;
  alias1?: string | null;
  alias?: string | null;
  itemAlias?: string | null;
}

export interface QrMatchResult {
  isMatch: boolean;
  confidence: number;
  extractedCode: string | null;
  extractedDescription: string | null;
  matchedAgainst: string;
  matchStrategy: 'qr_exact' | 'qr_payload' | 'qr_partial' | 'qr_mismatch';
  reason: string;
}

function normalizeCode(value: string | null | undefined): string {
  return (value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function extractJsonCode(value: string): string | null {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const candidateKeys = ['code', 'itemCode', 'alias', 'alias1', 'sku'];
    for (const key of candidateKeys) {
      const raw = parsed[key];
      if (typeof raw === 'string' && raw.trim()) return raw.trim();
    }
  } catch {
    return null;
  }
  return null;
}

function extractUrlCodes(value: string): string[] {
  try {
    const url = new URL(value);
    return ['code', 'item', 'sku', 'alias', 'alias1']
      .map((key) => url.searchParams.get(key)?.trim() ?? '')
      .filter(Boolean);
  } catch {
    return [];
  }
}

function extractPrefixedCode(value: string): string | null {
  const separators = [':', '|', '='];
  for (const separator of separators) {
    const parts = value.split(separator);
    if (parts.length !== 2) continue;
    const [prefix, code] = parts;
    if (!prefix || !code) continue;
    if (['PASPL', 'SKU', 'ITEM', 'CODE'].includes(prefix.trim().toUpperCase())) {
      return code.trim();
    }
  }
  return null;
}

function collectDecodedCandidates(rawValue: string): string[] {
  const trimmed = rawValue.trim();
  const candidates = new Set<string>();
  const add = (value: string | null | undefined) => {
    const normalized = normalizeCode(value);
    if (normalized) candidates.add(normalized);
  };

  add(trimmed);
  add(extractJsonCode(trimmed));
  add(extractPrefixedCode(trimmed));
  for (const candidate of extractUrlCodes(trimmed)) add(candidate);

  return [...candidates];
}

export function matchQrPayload({
  rawValue,
  name,
  alias1,
  alias,
  itemAlias,
}: QrMatchInput): QrMatchResult {
  const decodedCandidates = collectDecodedCandidates(rawValue);
  const expectedCodes = [
    { label: 'Alias 1', value: alias1 },
    { label: 'Alias', value: alias },
    { label: 'Item Alias', value: itemAlias },
  ]
    .map(({ label, value }) => ({
      label,
      raw: value?.trim() ?? '',
      normalized: normalizeCode(value),
    }))
    .filter((entry) => entry.normalized);

  const primaryCode = firstAvailableCode(alias1, alias, itemAlias);

  for (const expected of expectedCodes) {
    if (decodedCandidates.includes(expected.normalized)) {
      return {
        isMatch: true,
        confidence: 100,
        extractedCode: expected.raw,
        extractedDescription: name,
        matchedAgainst: expected.label,
        matchStrategy: 'qr_exact',
        reason: `Matched ${expected.label}`,
      };
    }
  }

  for (const candidate of decodedCandidates) {
    for (const expected of expectedCodes) {
      if (!candidate || !expected.normalized) continue;
      if (candidate.includes(expected.normalized) || expected.normalized.includes(candidate)) {
        return {
          isMatch: false,
          confidence: 45,
          extractedCode: candidate,
          extractedDescription: name,
          matchedAgainst: expected.label,
          matchStrategy: 'qr_partial',
          reason: `Scanned code is close to ${expected.label}, but not exact`,
        };
      }
    }
  }

  return {
    isMatch: false,
    confidence: 0,
    extractedCode: normalizeCode(rawValue) || primaryCode || null,
    extractedDescription: name,
    matchedAgainst: primaryCode || name,
    matchStrategy: 'qr_mismatch',
    reason: 'Scanned QR does not match Alias 1 or Alias',
  };
}

export function qrExpectedCodes(input: Pick<QrMatchInput, 'alias1' | 'alias' | 'itemAlias'>): string[] {
  return [input.alias1, input.alias, input.itemAlias]
    .map((value) => value?.trim() ?? '')
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index);
}
