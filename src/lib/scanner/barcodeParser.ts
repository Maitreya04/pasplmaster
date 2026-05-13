export type MatchStrategy = 'exact' | 'prefix_hyphen' | 'prefix_space' | 'manual';

export interface ParsedBarcode {
  raw: string;
  key: string;
  strategy: MatchStrategy;
  looksSerialised: boolean;
  strippedSuffix: string | null;
}

export function parseManufacturerBarcode(raw: string): ParsedBarcode {
  const trimmed = raw.trim();

  const hyphenIdx = trimmed.indexOf('-');
  if (hyphenIdx > 3 && hyphenIdx < trimmed.length - 1) {
    const prefix = trimmed.substring(0, hyphenIdx);
    const suffix = trimmed.substring(hyphenIdx);
    if (/^-\d{6,}$/.test(suffix)) {
      return {
        raw: trimmed,
        key: prefix,
        strategy: 'prefix_hyphen',
        looksSerialised: true,
        strippedSuffix: suffix,
      };
    }
  }

  const spaceIdx = trimmed.indexOf(' ');
  if (spaceIdx > 3) {
    const afterSpace = trimmed.substring(spaceIdx + 1);
    if (/^\d{6,}$/.test(afterSpace)) {
      return {
        raw: trimmed,
        key: trimmed.substring(0, spaceIdx),
        strategy: 'prefix_space',
        looksSerialised: true,
        strippedSuffix: ` ${afterSpace}`,
      };
    }
  }

  return {
    raw: trimmed,
    key: trimmed,
    strategy: 'exact',
    looksSerialised: false,
    strippedSuffix: null,
  };
}

export function normaliseBarcodeForLookup(raw: string): string {
  return parseManufacturerBarcode(raw).key;
}
