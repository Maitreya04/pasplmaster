export function normalizeScanCode(value: string | null | undefined): string {
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

export function collectQrLookupCandidates(rawValue: string): string[] {
  const trimmed = rawValue.trim();
  const ordered = [trimmed, extractJsonCode(trimmed), extractPrefixedCode(trimmed), ...extractUrlCodes(trimmed)];
  const seen = new Set<string>();
  const candidates: string[] = [];

  for (const value of ordered) {
    const normalized = normalizeScanCode(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    candidates.push(normalized);
  }

  return candidates;
}
