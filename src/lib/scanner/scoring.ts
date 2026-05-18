/** Shared barcode candidate scoring for native BarcodeDetector (web format strings). */
export function isLikelyPartNumber(raw: string): boolean {
  const value = raw.trim().toUpperCase();
  if (!value) return false;
  if (value.length < 4 || value.length > 36) return false;
  if (/\n/.test(value)) return false;
  if (/\b(?:MRP|QTY|COMMODITY|NUMBER OF|PACKED)\b/.test(value)) return false;
  if (/^[A-Z0-9][A-Z0-9.\-/]{3,}$/.test(value) && /[A-Z]/.test(value) && /\d/.test(value)) {
    return true;
  }
  if (/^\d{6,18}$/.test(value)) return true;
  return false;
}

export function scoreDetectedValue(raw: string, format: string | undefined, collectMode: boolean): number {
  let score = 0;
  const normalizedFormat = (format ?? '').toLowerCase();
  const trimmed = raw.trim();

  if (!trimmed) return -1000;
  if (collectMode && normalizedFormat === 'qr_code') score -= 8;
  if (normalizedFormat === 'code_128') score += 12;
  if (normalizedFormat === 'code_39' || normalizedFormat === 'code_93') score += 8;
  if (
    normalizedFormat === 'ean_13' ||
    normalizedFormat === 'ean_8' ||
    normalizedFormat === 'upc_a' ||
    normalizedFormat === 'upc_e'
  ) {
    score += 6;
  }
  if (isLikelyPartNumber(trimmed)) score += 20;
  if (trimmed.length > 26) score -= 4;
  if (/\s{2,}/.test(trimmed)) score -= 3;
  if (/\n/.test(trimmed)) score -= 6;
  return score;
}
