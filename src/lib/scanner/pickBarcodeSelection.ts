import { parseManufacturerBarcode } from './barcodeParser';
import { normalizeScanCode } from './qrPayload';
import { isLikelyPartNumber } from './scoring';

export interface PickBarcodeContext {
  /** Normalized alias / product codes for the line being picked. */
  expectedCodes: string[];
  /**
   * OEM labels (e.g. TAFE) often carry multiple 1D codes plus a 2D QR.
   * Prefer part-bearing symbols and ignore serial stamps.
   */
  oemMultiBarcodeMode?: boolean;
}

export type BarcodeHit = {
  rawValue: string;
  format?: string;
  boundingBox?: { x: number; y: number; width: number; height: number };
};

/**
 * Bottom serial stamps on TAFE / similar OEM bags (e.g. `YMCWUCAR8`).
 * These are not part numbers and should lose when a part QR or top 1D is present.
 */
export function isLikelyOemSerialStamp(raw: string): boolean {
  const value = raw.trim().toUpperCase();
  if (!value || value.includes('-') || value.includes('/') || /\s/.test(value)) return false;
  if (value.length < 7 || value.length > 12) return false;
  const letters = (value.match(/[A-Z]/g) ?? []).length;
  const digits = (value.match(/\d/g) ?? []).length;
  if (letters >= 5 && digits <= 2 && !/^\d{4,}/.test(value)) return true;
  return false;
}

export function barcodeMatchesExpected(raw: string, expectedCodes: string[]): boolean {
  if (expectedCodes.length === 0) return false;
  const normalizedExpected = new Set(
    expectedCodes.map((c) => normalizeScanCode(c)).filter((c) => c.length > 0),
  );
  if (normalizedExpected.size === 0) return false;

  const rawNorm = normalizeScanCode(raw);
  if (rawNorm && normalizedExpected.has(rawNorm)) return true;

  const parsed = parseManufacturerBarcode(raw);
  if (normalizedExpected.has(normalizeScanCode(parsed.key))) return true;
  for (const candidate of parsed.candidates) {
    if (normalizedExpected.has(normalizeScanCode(candidate))) return true;
  }
  return false;
}

function formatScore(raw: string, format: string | undefined, collectMode: boolean, oemMode: boolean): number {
  let score = 0;
  const normalizedFormat = (format ?? '').toLowerCase();
  const trimmed = raw.trim();
  if (!trimmed) return -1000;

  const isQr =
    normalizedFormat === 'qr_code' ||
    normalizedFormat === 'qrcode' ||
    normalizedFormat === 'microqrcode' ||
    normalizedFormat === 'datamatrix';

  if (oemMode && !collectMode) {
    if (isQr) score += 22;
    else if (normalizedFormat === 'code_128' || normalizedFormat === 'code128') score += 10;
    else if (
      normalizedFormat === 'code_39' ||
      normalizedFormat === 'code39' ||
      normalizedFormat === 'code_93' ||
      normalizedFormat === 'code93'
    ) {
      score += 6;
    }
  } else {
    if (collectMode && isQr) score -= 8;
    if (normalizedFormat === 'code_128' || normalizedFormat === 'code128') score += 12;
    if (
      normalizedFormat === 'code_39' ||
      normalizedFormat === 'code39' ||
      normalizedFormat === 'code_93' ||
      normalizedFormat === 'code93'
    ) {
      score += 8;
    }
    if (
      normalizedFormat === 'ean_13' ||
      normalizedFormat === 'ean_8' ||
      normalizedFormat === 'upc_a' ||
      normalizedFormat === 'upc_e' ||
      normalizedFormat === 'ean13' ||
      normalizedFormat === 'ean8' ||
      normalizedFormat === 'upca' ||
      normalizedFormat === 'upce'
    ) {
      score += 6;
    }
    if (isQr && !collectMode) score -= 4;
  }

  if (isLikelyPartNumber(trimmed)) score += 20;
  if (trimmed.length > 26) score -= 4;
  if (/\s{2,}/.test(trimmed)) score -= 3;
  if (/\n/.test(trimmed)) score += 8;
  return score;
}

function spatialScore(
  hit: BarcodeHit,
  frameHeight: number | undefined,
  oemMode: boolean,
): number {
  const bbox = hit.boundingBox;
  if (!bbox || !frameHeight || frameHeight <= 0) return 0;

  const frameArea = frameHeight * (bbox.width > 0 ? bbox.width * 10 : frameHeight);
  const area = bbox.width * bbox.height;
  const areaRatio = frameArea > 0 ? Math.min(1, Math.max(0, area / frameArea)) : 0;
  const sizeScore = (1 - areaRatio) * 18;

  const centerY = bbox.y + bbox.height / 2;
  const upperRatio = 1 - centerY / frameHeight;
  const upperScore = oemMode ? upperRatio * 28 : 0;

  return sizeScore + upperScore;
}

export function scoreBarcodeForPick(
  raw: string,
  format: string | undefined,
  collectMode: boolean,
  pickContext: PickBarcodeContext | undefined,
  spatialBoost = 0,
): number {
  const oemMode = Boolean(pickContext?.oemMultiBarcodeMode && pickContext.expectedCodes.length > 0);
  let score = formatScore(raw, format, collectMode, oemMode) + spatialBoost;

  if (pickContext && pickContext.expectedCodes.length > 0) {
    if (barcodeMatchesExpected(raw, pickContext.expectedCodes)) {
      score += 200;
    } else if (oemMode && isLikelyOemSerialStamp(raw)) {
      score -= 90;
    } else if (oemMode) {
      const parsed = parseManufacturerBarcode(raw);
      if (parsed.looksSerialised && !barcodeMatchesExpected(parsed.key, pickContext.expectedCodes)) {
        score -= 40;
      }
    }
  }

  return score;
}

export function pickBestBarcodeCandidate(
  hits: BarcodeHit[],
  options: {
    collectMode: boolean;
    pickContext?: PickBarcodeContext;
    frameHeight?: number;
  },
): BarcodeHit | null {
  const usable = hits.filter((h) => h.rawValue.trim().length > 0);
  if (usable.length === 0) return null;

  const oemMode = Boolean(
    options.pickContext?.oemMultiBarcodeMode && options.pickContext.expectedCodes.length > 0,
  );

  let best = usable[0];
  let bestScore = scoreBarcodeForPick(
    best.rawValue,
    best.format,
    options.collectMode,
    options.pickContext,
    spatialScore(best, options.frameHeight, oemMode),
  );

  for (let i = 1; i < usable.length; i += 1) {
    const candidate = usable[i];
    const score =
      scoreBarcodeForPick(
        candidate.rawValue,
        candidate.format,
        options.collectMode,
        options.pickContext,
        spatialScore(candidate, options.frameHeight, oemMode),
      );
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return best;
}
