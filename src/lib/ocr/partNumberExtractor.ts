import {
  BATCH_CODE_RE,
  BRANDS,
  LABELED_PART_PATTERNS,
  NOISE_LINE_PATTERNS,
  NOISE_PHRASES,
  type BrandConfig,
} from './brandPatterns';

export interface PartNumberCandidate {
  value: string;
  source: 'labeled' | 'brand' | 'generic';
  brandId?: string;
}

export function normalizeForPartMatch(s: string): string {
  return s
    .trim()
    .toUpperCase()
    .replace(/[\s]+/g, ' ')
    .replace(/[.]/g, '')
    .replace(/[()'"`]/g, '')
    .replace(/[\\]+/g, '/')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, '');
}

function stripNoise(text: string): string {
  const lines = text.split(/\r?\n/);
  const kept: string[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (NOISE_LINE_PATTERNS.some((re) => re.test(line))) continue;
    if (NOISE_PHRASES.some((re) => re.test(line))) continue;
    if (BATCH_CODE_RE.test(normalizeForPartMatch(line))) continue;
    kept.push(line);
  }
  return kept.join('\n');
}

function detectBrands(text: string): BrandConfig[] {
  return BRANDS.filter((b) => b.detect.some((re) => re.test(text)));
}

function clampCandidate(s: string): string | null {
  const v = s.trim().split(/\n/)[0].trim();
  const norm = normalizeForPartMatch(v);
  if (norm.length < 3) return null;
  if (norm.length > 40) return null;
  return v;
}

/**
 * Extracts part-number-like candidates from OCR text. The output is **not**
 * guaranteed to be a real part number; it is designed to feed matching logic.
 */
export function extractPartNumberCandidates(ocrTextRaw: string): PartNumberCandidate[] {
  const ocrText = stripNoise(ocrTextRaw);
  const out: PartNumberCandidate[] = [];

  // 1) Generic labeled patterns: "PART NO: XYZ"
  for (const re of LABELED_PART_PATTERNS) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(ocrText)) !== null) {
      const cand = clampCandidate(m[1] ?? '');
      if (cand) out.push({ value: cand, source: 'labeled' });
    }
  }

  // 2) Brand-specific patterns, if we can detect the brand
  const brands = detectBrands(ocrText);
  for (const b of brands) {
    for (const re of b.partNumberPatterns) {
      let m: RegExpExecArray | null;
      while ((m = re.exec(ocrText)) !== null) {
        const cand = clampCandidate(m[0] ?? '');
        if (cand) out.push({ value: cand, source: 'brand', brandId: b.id });
      }
    }
  }

  // 3) Generic “code-ish” patterns (kept permissive because aliases sometimes
  // include model/variant separators like PRO/13S/SPLP/DLX).
  const genericRes: RegExp[] = [
    // Slash-separated codes: ASK/NA/DBP/0538, PRO/13S/SPLP/DLX
    /\b[A-Z0-9]{2,10}\/[A-Z0-9]{1,10}(?:\/[A-Z0-9]{1,10}){1,6}\b/gi,
    // Hyphenated codes: ABC-1234, ABCD-EFGH-1234
    /\b[A-Z0-9]{2,8}(?:-[A-Z0-9]{2,10}){1,4}\b/gi,
    // Numeric 4-8 digit codes (avoid years)
    /\b(\d{4,8})\b/g,
    // Short alphanumeric with trailing letters: S75NC, S75 NC
    /\b([A-Z]\d{2,3}\s?[A-Z]{1,4})\b/gi,
    // Bare piston-size / oversize codes: L30, STD, B40 — letter(s) + 2-3 digits
    // (no trailing letters required, min 3 chars after normalisation)
    /\b([A-Z]{1,3}\d{2,3})\b/gi,
  ];

  for (const re of genericRes) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(ocrText)) !== null) {
      const raw = (m[1] ?? m[0] ?? '').toString();
      const cand = clampCandidate(raw);
      if (!cand) continue;
      const n = normalizeForPartMatch(cand);
      if (/^\d+$/.test(n)) {
        const num = parseInt(n, 10);
        if (num >= 2020 && num <= 2035) continue;
      }
      out.push({ value: cand, source: 'generic' });
    }
  }

  // De-dup by normalized value, prefer labeled > brand > generic
  const rank: Record<PartNumberCandidate['source'], number> = {
    labeled: 3,
    brand: 2,
    generic: 1,
  };
  const best = new Map<string, PartNumberCandidate>();
  for (const c of out) {
    const key = normalizeForPartMatch(c.value);
    const existing = best.get(key);
    if (!existing || rank[c.source] > rank[existing.source]) best.set(key, c);
  }
  return [...best.values()];
}

