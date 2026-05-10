export function normalizeScanCode(value: string | null | undefined): string {
  return (value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

export function parseLpnPayload(rawValue: string | null | undefined): string | null {
  const trimmed = rawValue?.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const type = typeof parsed.type === 'string' ? parsed.type.trim().toUpperCase() : '';
    const lpn = typeof parsed.lpn === 'string' ? parsed.lpn.trim().toUpperCase() : '';
    if (type === 'PASPL_LPN' && lpn) return lpn;
  } catch {
    // Plain QR payloads are expected for most labels.
  }

  const prefixed = trimmed.match(/^(?:PASPL-LPN|LPN)\s*:\s*(.+)$/i);
  if (!prefixed?.[1]) return null;

  const lpn = prefixed[1].trim().toUpperCase();
  return /^LP-[A-Z0-9]+$/.test(lpn) ? lpn : null;
}

export interface PackPickPayload {
  busyCode: number;
  packType: 'inner' | 'outer';
}

export interface LpnPickPayload {
  lpnCode: string;
  busyCode: number | null;
  remainingQty: number | null;
}

export interface RackPayload {
  /** Normalized rack code as printed on the shelf, preserving dashes (e.g. "A-12"). */
  rackCode: string;
}

export type ScanPayloadKind = 'rack' | 'pack' | 'lpn' | 'sku' | 'unknown';

export interface ClassifiedScanPayload {
  kind: ScanPayloadKind;
  rawValue: string;
  normalizedCandidates: string[];
  packPayload?: PackPickPayload;
  lpnPayload?: LpnPickPayload;
  rackPayload?: RackPayload;
}

/** Normalise a rack code: uppercase, single dash, no whitespace. */
function normalizeRackCode(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9-]/g, '');
}

/**
 * Detect a rack/bin "license plate" QR. Two payload conventions are supported:
 *   - JSON: `{ "type": "PASPL_RACK", "rack": "A-12" }`
 *   - Prefixed string: `RACK:A-12`, `RACK-A-12`, `R:A-12`, `BIN:A-12`
 * Returns null for everything else so this can sit alongside SKU/pack/LPN payloads
 * without false-positive matches.
 */
export function parseRackPayload(rawValue: string | null | undefined): RackPayload | null {
  const trimmed = rawValue?.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const type = typeof parsed.type === 'string' ? parsed.type.trim().toUpperCase() : '';
    const rack = typeof parsed.rack === 'string'
      ? parsed.rack
      : typeof parsed.rack_no === 'string'
        ? parsed.rack_no
        : typeof parsed.location === 'string'
          ? parsed.location
          : '';
    if ((type === 'PASPL_RACK' || type === 'RACK' || type === 'BIN') && rack) {
      const code = normalizeRackCode(rack);
      if (code) return { rackCode: code };
    }
  } catch {
    // Plain QR payloads are expected for printed rack labels.
  }

  const prefixed = trimmed.match(/^(?:RACK|BIN|R)[\s:-]+([A-Z0-9][A-Z0-9-]*)$/i);
  if (prefixed?.[1]) {
    const code = normalizeRackCode(prefixed[1]);
    if (code) return { rackCode: code };
  }

  return null;
}

export function parsePackPickPayload(rawValue: string | null | undefined): PackPickPayload | null {
  const trimmed = rawValue?.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const type = typeof parsed.type === 'string' ? parsed.type.trim().toUpperCase() : '';
    const rawBusyCode = parsed.busy_code ?? parsed.busyCode;
    const busyCode =
      typeof rawBusyCode === 'number'
        ? rawBusyCode
        : typeof rawBusyCode === 'string'
          ? Number(rawBusyCode.trim())
          : NaN;
    const packType = typeof parsed.pack_type === 'string'
      ? parsed.pack_type.trim().toLowerCase()
      : typeof parsed.packType === 'string'
        ? parsed.packType.trim().toLowerCase()
        : '';

    if ((type === 'PASPL_PACK' || type === 'PACK_PICK') && Number.isFinite(busyCode)) {
      if (packType === 'inner' || packType === 'outer') return { busyCode, packType };
    }
  } catch {
    // Plain QR payloads are expected for reusable pack labels.
  }

  const prefixed = trimmed.match(/^(?:PASPL-PACK|PACK)\s*:\s*([0-9]+(?:\.[0-9]+)?)\s*:\s*(inner|outer)$/i);
  if (!prefixed?.[1] || !prefixed[2]) return null;

  return {
    busyCode: Number(prefixed[1]),
    packType: prefixed[2].toLowerCase() as 'inner' | 'outer',
  };
}

export function parseLpnPickPayload(rawValue: string | null | undefined): LpnPickPayload | null {
  const trimmed = rawValue?.trim();
  if (!trimmed) return null;

  const prefixedLpn = parseLpnPayload(trimmed);

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const type = typeof parsed.type === 'string' ? parsed.type.trim().toUpperCase() : '';
    const rawLpn = typeof parsed.lpn === 'string' ? parsed.lpn.trim().toUpperCase() : prefixedLpn;
    const rawBusyCode = parsed.busy_code ?? parsed.busyCode ?? null;
    const rawRemainingQty = parsed.remaining_qty ?? parsed.remainingQty ?? null;
    const busyCode =
      typeof rawBusyCode === 'number'
        ? rawBusyCode
        : typeof rawBusyCode === 'string'
          ? Number(rawBusyCode.trim())
          : NaN;
    const remainingQty =
      typeof rawRemainingQty === 'number'
        ? rawRemainingQty
        : typeof rawRemainingQty === 'string'
          ? Number(rawRemainingQty.trim())
          : NaN;

    if ((type === 'PASPL_LPN' || type === 'LPN') && rawLpn) {
      return {
        lpnCode: rawLpn,
        busyCode: Number.isFinite(busyCode) ? busyCode : null,
        remainingQty: Number.isFinite(remainingQty) ? remainingQty : null,
      };
    }
  } catch {
    // Non-JSON payloads are expected.
  }

  if (!prefixedLpn) return null;
  return {
    lpnCode: prefixedLpn,
    busyCode: null,
    remainingQty: null,
  };
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

export function classifyScanPayload(rawValue: string): ClassifiedScanPayload {
  const rackPayload = parseRackPayload(rawValue);
  const packPayload = parsePackPickPayload(rawValue);
  const lpnPayload = parseLpnPickPayload(rawValue);
  const normalizedCandidates = collectQrLookupCandidates(rawValue);

  // Rack wins: the prefix is unambiguous and shouldn't be mis-classified as SKU.
  if (rackPayload) {
    return {
      kind: 'rack',
      rawValue,
      normalizedCandidates,
      rackPayload,
    };
  }
  if (packPayload) {
    return {
      kind: 'pack',
      rawValue,
      normalizedCandidates,
      packPayload,
    };
  }
  if (lpnPayload) {
    return {
      kind: 'lpn',
      rawValue,
      normalizedCandidates,
      lpnPayload,
    };
  }
  if (normalizedCandidates.length > 0) {
    return {
      kind: 'sku',
      rawValue,
      normalizedCandidates,
    };
  }
  return {
    kind: 'unknown',
    rawValue,
    normalizedCandidates: [],
  };
}

/**
 * Compare a scanned rack code to the rack stored on an order item.
 * Both are normalised to uppercase alphanumerics + dashes, so "a 12" matches "A-12"
 * the same way "A12" does.
 */
export function rackCodesMatch(
  scanned: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  if (!scanned || !expected) return false;
  const a = normalizeRackCode(scanned);
  const b = normalizeRackCode(expected);
  if (!a || !b) return false;
  if (a === b) return true;
  // Tolerate dash-omitted variants: "A12" vs "A-12".
  return a.replace(/-/g, '') === b.replace(/-/g, '');
}
