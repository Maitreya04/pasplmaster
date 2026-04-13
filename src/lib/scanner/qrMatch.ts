import { firstAvailableCode } from '../../utils/itemCodes';
import { collectQrLookupCandidates, normalizeScanCode } from './qrPayload';

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

export function matchQrPayload({
  rawValue,
  name,
  alias1,
  alias,
  itemAlias,
}: QrMatchInput): QrMatchResult {
  const decodedCandidates = collectQrLookupCandidates(rawValue);
  const expectedCodes = [
    { label: 'Alias 1', value: alias1 },
    { label: 'Alias', value: alias },
    { label: 'Item Alias', value: itemAlias },
  ]
    .map(({ label, value }) => ({
      label,
      raw: value?.trim() ?? '',
      normalized: normalizeScanCode(value),
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
    extractedCode: normalizeScanCode(rawValue) || primaryCode || null,
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
