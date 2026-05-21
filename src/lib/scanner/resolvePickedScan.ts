import {
  resolveScannedCatalogItem,
  getScanCatalogItemById,
  getScanCatalogItemByBusyCode,
} from '../../stores/itemScanIndex';
import { classifyScanPayload, normalizeScanCode } from './qrPayload';
import { resolveScanToUom, type ResolvedUom } from './uomMapper';
import type { LiveQrScannerPickItem, LiveQrScannerResolved } from './liveQrScannerTypes';

function uniqueCodes(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    output.push(trimmed);
  }
  return output;
}

function extractNumericCandidates(values: Array<string | null | undefined>): number[] {
  const out = new Set<number>();
  for (const value of values) {
    if (!value) continue;
    const digits = value.replace(/[^\d]/g, '');
    if (!digits) continue;
    const parsed = Number(digits);
    if (Number.isFinite(parsed) && parsed > 0) out.add(parsed);
  }
  return [...out];
}

export type BuildResolvedScanOptions = {
  /** When false, skip network UOM RPC (pick verify uses local catalog + PickPage qty logic). */
  resolveUom?: boolean;
};

function applyUomFields(
  base: Omit<
    LiveQrScannerResolved,
    'uomTier' | 'baseQtyEa' | 'packetQtyEa' | 'packetsPerBox' | 'uomSource' | 'suggestedQty'
  >,
  classified: ReturnType<typeof classifyScanPayload>,
  uomResolved: ResolvedUom,
): LiveQrScannerResolved {
  const uomTier = uomResolved.tier;
  const baseQtyEa = uomResolved.baseQtyEa;
  const packetQtyEa = uomResolved.packetQtyEa;
  const packetsPerBox = uomResolved.packetsPerBox;
  const uomSource = uomResolved.source;

  const suggestedQty =
    uomResolved.matched &&
    baseQtyEa != null &&
    Number.isFinite(baseQtyEa) &&
    baseQtyEa >= 1
      ? Math.floor(baseQtyEa)
      : classified.kind === 'pack'
        ? 1
        : classified.kind === 'lpn'
          ? Math.max(1, classified.lpnPayload?.remainingQty ?? 1)
          : 1;

  return {
    ...base,
    suggestedQty,
    uomTier,
    baseQtyEa,
    packetQtyEa,
    packetsPerBox,
    uomSource,
  };
}

/** In-memory resolve only — no network; safe to call on every stable decode. */
export function buildResolvedScanPayloadSync(
  rawValue: string,
  scannerPickItem: LiveQrScannerPickItem,
): LiveQrScannerResolved {
  const classified = classifyScanPayload(rawValue);
  const candidates = classified.normalizedCandidates;
  const packPayload = classified.packPayload;
  const lpnPayload = classified.lpnPayload;

  let matchesPickItem = false;
  let matchedBy: LiveQrScannerResolved['matchedBy'] = null;
  let lookupCode: string | null = null;

  const busyCodeCandidates = extractNumericCandidates([
    scannerPickItem.alias1,
    scannerPickItem.alias,
    scannerPickItem.itemCode,
    scannerPickItem.busyCode != null ? String(scannerPickItem.busyCode) : null,
  ]);

  const packCatalogItem = packPayload ? getScanCatalogItemByBusyCode(packPayload.busyCode) : null;
  const verifyingSpecificItem = scannerPickItem.itemId > 0;

  if (packPayload && packCatalogItem) {
    if (!verifyingSpecificItem || busyCodeCandidates.includes(packPayload.busyCode)) {
      matchesPickItem = verifyingSpecificItem;
      matchedBy = 'pack';
      lookupCode = String(packPayload.busyCode);
    }
  } else if (packPayload && busyCodeCandidates.includes(packPayload.busyCode)) {
    matchesPickItem = true;
    matchedBy = 'pack';
    lookupCode = String(packPayload.busyCode);
  } else {
    for (const code of candidates) {
      if (scannerPickItem.alias1 && normalizeScanCode(scannerPickItem.alias1) === code) {
        matchesPickItem = true;
        matchedBy = 'alias1';
        lookupCode = code;
        break;
      }
      if (scannerPickItem.alias && normalizeScanCode(scannerPickItem.alias) === code) {
        matchesPickItem = true;
        matchedBy = 'alias';
        lookupCode = code;
        break;
      }
      if (scannerPickItem.itemCode && normalizeScanCode(scannerPickItem.itemCode) === code) {
        matchesPickItem = true;
        matchedBy = 'item_code';
        lookupCode = code;
        break;
      }
    }
  }

  const lookup = resolveScannedCatalogItem(rawValue) ?? (packCatalogItem
    ? { code: String(packPayload!.busyCode), item: packCatalogItem, source: 'pack' as const }
    : null);

  if (!matchesPickItem && lookup?.item.id === scannerPickItem.itemId) {
    matchesPickItem = true;
    matchedBy = lookup.source;
    lookupCode = lookup.code;
  }

  const base = {
    rawValue,
    matchedItem: matchesPickItem
      ? (getScanCatalogItemById(scannerPickItem.itemId) ?? lookup?.item ?? packCatalogItem ?? null)
      : (lookup?.item ?? packCatalogItem ?? null),
    matchedBy: matchesPickItem ? matchedBy : (lookup?.source ?? null),
    matchesPickItem,
    lookupCode: matchesPickItem
      ? lookupCode
      : (packPayload
        ? String(packPayload.busyCode)
        : lpnPayload?.busyCode != null
          ? String(lpnPayload.busyCode)
          : (lookup?.code ?? candidates[0] ?? null)),
    codeType: classified.kind,
    requiresBreakConfirmation: false,
    lpnCode: lpnPayload?.lpnCode ?? null,
    reason: matchesPickItem
      ? matchedBy === 'pack'
        ? `Verified reusable ${packPayload?.packType} pack QR.`
        : `Verified against ${matchedBy}.`
      : !lookup && !packCatalogItem
        ? 'QR decoded, but no catalog item matched alias1, alias, busy code, or item code.'
        : lookup && verifyingSpecificItem
          ? `Scanned ${lookup.item.name}, but the picker is expected to verify ${scannerPickItem.name}.`
          : packPayload && packCatalogItem
            ? `Recognized ${packCatalogItem.name} via ${packPayload.packType} pack QR (Busy ${packPayload.busyCode}).`
            : lookup
              ? `Recognized ${lookup.item.name} via ${lookup.source}.`
              : 'QR decoded, but no catalog item matched.',
  };

  return applyUomFields(base, classified, {
    matched: false,
    busyCode: null,
    itemId: null,
    itemName: null,
    sellingUnit: 'piece',
    tier: null,
    baseQtyEa: null,
    packetQtyEa: null,
    packetsPerBox: null,
    source: null,
    reason: null,
  });
}

export async function buildResolvedScanPayload(
  rawValue: string,
  scannerPickItem: LiveQrScannerPickItem,
  options: BuildResolvedScanOptions = {},
): Promise<LiveQrScannerResolved> {
  const sync = buildResolvedScanPayloadSync(rawValue, scannerPickItem);
  if (options.resolveUom === false) return sync;

  const classified = classifyScanPayload(rawValue);
  const uomResolved = await resolveScanToUom(rawValue);
  const { suggestedQty: _s, uomTier: _t, baseQtyEa: _b, packetQtyEa: _p, packetsPerBox: _pb, uomSource: _us, ...base } =
    sync;
  return applyUomFields(base, classified, uomResolved);
}

export { uniqueCodes };
