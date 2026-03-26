import { VEHICLE_TOKENS } from './brandPatterns';

// ─── Interfaces ───────────────────────────────────────────────────────────

export interface GeminiExtraction {
  part_numbers: string[];
  product_type: string;
  brand: string;
  vehicle_models: string[];
  mrp: number | null;
  size_variant: string;
  emission_standard: string;
  other_variants: string[];
  raw_text: string;
}

export interface MatchableItem {
  item_name: string;
  item_alias: string | null;
}

export interface SignalDetail {
  signal: string;
  score: number;
  maxScore: number;
  detail: string;
}

export interface OcrMatchResult {
  isMatch: boolean;
  confidence: number;
  matchedFields: string[];
  signals: SignalDetail[];
  ocrExtracted: {
    partNumber: string | null;
    description: string | null;
    mrp: number | null;
    brand: string | null;
    vehicleModel: string | null;
  };
  matchStrategy: string;
}

// ─── Normalization Helpers ────────────────────────────────────────────────

function normalizeCode(code: string): string {
  return code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

const PREFIXES_TO_STRIP = /^(P|R|UK|UB|UF|G|U2|UP|UR|INEL|TIDC|ASK|LC|EV|KV|SJ|TP|LV|BG|BA|SW|SC)/i;

function stripPrefix(code: string): string {
  let result = code;
  result = result.replace(PREFIXES_TO_STRIP, '');
  result = result.replace(PREFIXES_TO_STRIP, '');
  return result;
}

function normalizeFuzzy(str: string): string {
  return str
    .replace(/[G]/g, '6')
    .replace(/[S]/g, '5')
    .replace(/[Z]/g, '2')
    .replace(/[OQ]/g, '0')
    .replace(/[B]/g, '8')
    .replace(/[I]/g, '1');
}

// ─── Product Type Extraction ──────────────────────────────────────────────

interface ProductTypeInfo {
  canonical: string;
  tokens: string[];
}

const PRODUCT_TYPE_CANONICAL: [RegExp, ProductTypeInfo][] = [
  [/\bBRAKE\s*SHOE/i, { canonical: 'BRAKE_SHOE', tokens: ['brake', 'shoe'] }],
  [/\bDISC\s*(?:BRAKE\s*)?PAD/i, { canonical: 'DISC_PAD', tokens: ['disc', 'pad'] }],
  [/\bBRAKE\s*PAD/i, { canonical: 'BRAKE_PAD', tokens: ['brake', 'pad'] }],
  [/\bCLUTCH\s*SHOE/i, { canonical: 'CLUTCH_SHOE', tokens: ['clutch', 'shoe'] }],
  [/\bCLUTCH\s*CABLE/i, { canonical: 'CLUTCH_CABLE', tokens: ['clutch', 'cable'] }],
  [/\bACCEL(?:ERATOR)?\s*CABLE/i, { canonical: 'ACC_CABLE', tokens: ['acc', 'cable'] }],
  [/\bSPEEDO/i, { canonical: 'SPEEDO', tokens: ['speedo'] }],
  [/\bSTARTER\s*(?:MOTOR)?/i, { canonical: 'STARTER', tokens: ['starter'] }],
  [/\bENGINE\s*VALVE/i, { canonical: 'ENGINE_VALVE', tokens: ['engine', 'valve'] }],
  [/\bPISTON\s*(?:ASSEMBLY|ASSY|SET)/i, { canonical: 'PISTON_ASSY', tokens: ['piston'] }],
  [/\bPISTON\s*RING/i, { canonical: 'PISTON_RING', tokens: ['ring'] }],
  [/\bCAM\s*CHAIN/i, { canonical: 'CAM_CHAIN', tokens: ['cam', 'chain'] }],
  [/\bCHAIN\s*(?:KIT|SET|SPROCKET)/i, { canonical: 'CHAIN_KIT', tokens: ['chain'] }],
  [/\bCAM\s*BUSH/i, { canonical: 'CAM_BUSH', tokens: ['cam', 'bush'] }],
  [/\bBEARING/i, { canonical: 'BEARING', tokens: ['bearing'] }],
  [/\bSTATOR/i, { canonical: 'STATOR', tokens: ['stator'] }],
  [/\bSHOCK/i, { canonical: 'SHOCK', tokens: ['shock'] }],
  [/\bB\.?DRUM/i, { canonical: 'BRAKE_DRUM', tokens: ['drum'] }],
  [/\bRING\b/i, { canonical: 'PISTON_RING', tokens: ['ring'] }],
  [/\bPISTON\b/i, { canonical: 'PISTON_ASSY', tokens: ['piston'] }],
  [/\bVALVE\b/i, { canonical: 'VALVE', tokens: ['valve'] }],
];

const CONFLICTING_PRODUCT_TYPES: [string, string][] = [
  ['BRAKE_SHOE', 'CLUTCH_SHOE'],
  ['BRAKE_SHOE', 'DISC_PAD'],
  ['CLUTCH_SHOE', 'DISC_PAD'],
  ['CLUTCH_CABLE', 'ACC_CABLE'],
  ['PISTON_ASSY', 'PISTON_RING'],
  ['STARTER', 'STATOR'],
  ['BRAKE_DRUM', 'BRAKE_SHOE'],
  ['ENGINE_VALVE', 'PISTON_ASSY'],
];

function detectProductType(text: string): ProductTypeInfo | null {
  const normalized = text.replace(/_/g, ' ');
  for (const [re, info] of PRODUCT_TYPE_CANONICAL) {
    re.lastIndex = 0;
    if (re.test(normalized)) return info;
  }
  return null;
}

function areProductTypesConflicting(a: string, b: string): boolean {
  if (a === b) return false;
  return CONFLICTING_PRODUCT_TYPES.some(
    ([x, y]) => (a === x && b === y) || (a === y && b === x)
  );
}

// ─── Vehicle Model Extraction ─────────────────────────────────────────────

const VEHICLE_FAMILIES: [RegExp, string][] = [
  [/\bHONDA\b/i, 'HONDA'],
  [/\bHERO\b/i, 'HERO'],
  [/\bTVS\b/i, 'TVS'],
  [/\bBAJAJ\b/i, 'BAJAJ'],
  [/\bYAMAHA\b/i, 'YAMAHA'],
  [/\bSUZUKI\b/i, 'SUZUKI'],
  [/\bROYAL\s*ENFIELD\b/i, 'ROYAL_ENFIELD'],
  [/\bEICHER\b/i, 'EICHER'],
  [/\bMARUTI\b/i, 'MARUTI'],
  [/\bTATA\b/i, 'TATA'],
  [/\bMAHINDRA\b/i, 'MAHINDRA'],
  [/\bLEYLAND|LEYL?\b/i, 'LEYLAND'],
  [/\bHINO\b/i, 'HINO'],
  [/\bPIAGGIO\b/i, 'PIAGGIO'],
];

function extractVehicleFamilies(text: string): string[] {
  const families: string[] = [];
  for (const [re, family] of VEHICLE_FAMILIES) {
    re.lastIndex = 0;
    if (re.test(text)) families.push(family);
  }
  // Also infer family from VEHICLE_TOKENS abbreviations (HN ACT → honda → HONDA)
  const tokens = extractVehicleTokens(text);
  const tokenToFamily: Record<string, string> = {
    honda: 'HONDA', hero: 'HERO', tvs: 'TVS', bajaj: 'BAJAJ',
    yamaha: 'YAMAHA', suzuki: 'SUZUKI', eicher: 'EICHER',
    tata: 'TATA', mahindra: 'MAHINDRA', maruti: 'MARUTI',
    royal: 'ROYAL_ENFIELD', enfield: 'ROYAL_ENFIELD',
  };
  for (const t of tokens) {
    const family = tokenToFamily[t];
    if (family) families.push(family);
  }
  return [...new Set(families)];
}

function extractVehicleTokens(text: string): string[] {
  const tokens: string[] = [];
  for (const [re, toks] of VEHICLE_TOKENS) {
    re.lastIndex = 0;
    if (re.test(text)) tokens.push(...toks);
  }
  return [...new Set(tokens)];
}

// ─── Variant / Size Extraction ────────────────────────────────────────────

interface VariantInfo {
  sizes: string[];
  sides: string[];
  emissions: string[];
  specials: string[];
}

function extractVariants(text: string): VariantInfo {
  const upper = text.toUpperCase();

  const sizes: string[] = [];
  const sizeRe = /\b(STD|0\.25|0\.50|0\.75|1\.00|O\/S\s*[\d.]+|[\d]+\.[\d]+\s*mm)\b/gi;
  let m;
  while ((m = sizeRe.exec(upper)) !== null) {
    sizes.push(m[1].replace(/\s+/g, '').toUpperCase());
  }

  const sides: string[] = [];
  const sideRe = /\b(RH|LH|RIGHT|LEFT|FRONT|REAR|F&R|F\s*&\s*R)\b/gi;
  while ((m = sideRe.exec(upper)) !== null) {
    const v = m[1].toUpperCase();
    if (v === 'RIGHT' || v === 'RH') sides.push('RH');
    else if (v === 'LEFT' || v === 'LH') sides.push('LH');
    else if (v === 'FRONT') sides.push('FRONT');
    else if (v === 'REAR') sides.push('REAR');
    else if (v.includes('F') && v.includes('R')) sides.push('F&R');
  }

  const emissions: string[] = [];
  const emRe = /\b(BS3A?|BS4|BS6|BSVI|BSIV|BSIII|BS\s*III|BS\s*IV|BS\s*VI)\b/gi;
  while ((m = emRe.exec(upper)) !== null) {
    const v = m[1].replace(/\s+/g, '').toUpperCase();
    if (v === 'BSVI' || v === 'BS6') emissions.push('BS6');
    else if (v === 'BSIV' || v === 'BS4') emissions.push('BS4');
    else if (v === 'BSIII' || v === 'BS3') emissions.push('BS3');
    else if (v === 'BS3A') emissions.push('BS3A');
    else emissions.push(v);
  }

  const specials: string[] = [];
  if (/\bNC\b/.test(upper)) specials.push('NC');
  if (/\bDURO\b/.test(upper)) specials.push('DURO');
  if (/\bHET\b/.test(upper)) specials.push('HET');
  if (/\bTUFF?\b/.test(upper)) specials.push('TUFF');
  if (/\bN\/?M\b/.test(upper)) specials.push('NM');
  if (/\bO\/?M\b/.test(upper)) specials.push('OM');

  return {
    sizes: [...new Set(sizes)],
    sides: [...new Set(sides)],
    emissions: [...new Set(emissions)],
    specials: [...new Set(specials)],
  };
}

// ─── Brand Matching ───────────────────────────────────────────────────────

const BRAND_ALIASES: Record<string, string[]> = {
  ASK: ['ASK'],
  USHA: ['USHA', 'SHRIRAM', 'USHA2', 'SPR'],
  TIDC: ['TIDC', 'DIAMOND'],
  LUCAS: ['LUCAS', 'LUCAS TVS'],
  SUPRAJIT: ['SUPRAJIT', 'SJ'],
  KSPG: ['KSPG'],
  SCHEAFFLER: ['FAG', 'SCHEAFFLER'],
  RANE: ['RANE'],
  'Tiger Power': ['TIGER POWER', 'TP'],
  FRIENDS: ['FRIENDS'],
};

function matchBrand(ocrBrand: string, itemMainGroup: string | null): boolean {
  if (!ocrBrand || !itemMainGroup) return false;
  const ocrUpper = ocrBrand.toUpperCase();
  const groupUpper = itemMainGroup.toUpperCase();

  if (groupUpper.includes(ocrUpper) || ocrUpper.includes(groupUpper)) return true;

  for (const [group, aliases] of Object.entries(BRAND_ALIASES)) {
    const groupMatch = groupUpper === group.toUpperCase() ||
      aliases.some(a => groupUpper.includes(a));
    const ocrMatch = aliases.some(a =>
      ocrUpper.includes(a) || a.includes(ocrUpper)
    );
    if (groupMatch && ocrMatch) return true;
  }

  return false;
}

// ─── Part Number Scoring ──────────────────────────────────────────────────

interface PartNumberMatch {
  score: number;
  matchedCode: string;
  matchedAgainst: string;
  detail: string;
}

function scorePartNumber(
  extractedCodes: string[],
  alias: string | null,
  alias1: string | null,
): PartNumberMatch {
  if (extractedCodes.length === 0) {
    return { score: 0, matchedCode: '', matchedAgainst: '', detail: 'No part numbers extracted' };
  }

  const targets: { label: string; raw: string; norm: string; stripped: string }[] = [];
  if (alias) {
    const norm = normalizeCode(alias);
    targets.push({ label: 'alias', raw: alias, norm, stripped: stripPrefix(norm) });
  }
  if (alias1) {
    const norm = normalizeCode(alias1);
    targets.push({ label: 'alias1', raw: alias1, norm, stripped: stripPrefix(norm) });
  }

  if (targets.length === 0) {
    return { score: 0, matchedCode: '', matchedAgainst: '', detail: 'No alias/alias1 to match against' };
  }

  let best: PartNumberMatch = { score: 0, matchedCode: '', matchedAgainst: '', detail: 'No part number matched' };

  for (const rawCode of extractedCodes) {
    const codeNorm = normalizeCode(rawCode);
    if (!codeNorm || codeNorm.length < 2) continue;
    const codeStripped = stripPrefix(codeNorm);
    const codeFuzzy = normalizeFuzzy(codeNorm);

    for (const target of targets) {
      // Exact normalized match: ASK/NA/BS/00002 → ASKNABS00002 === ASKNABS00002
      if (codeNorm === target.norm) {
        return { score: 40, matchedCode: rawCode, matchedAgainst: target.raw, detail: `Exact match on ${target.label}` };
      }

      // Prefix-stripped exact: 26046091 → 26046091 === LC26046091 stripped to 26046091
      if (codeStripped.length >= 3 && codeStripped === target.stripped) {
        const s = { score: 35, matchedCode: rawCode, matchedAgainst: target.raw, detail: `Prefix-stripped match on ${target.label}` };
        if (s.score > best.score) best = s;
        continue;
      }

      // Code is the tail of target: K6N matches TIDCK6N
      if (codeNorm.length >= 3 && target.norm.endsWith(codeNorm)) {
        const s = { score: 33, matchedCode: rawCode, matchedAgainst: target.raw, detail: `Suffix match on ${target.label} (${codeNorm} in ${target.norm})` };
        if (s.score > best.score) best = s;
        continue;
      }

      // Target ends with code after prefix strip
      if (codeStripped.length >= 3 && target.stripped.endsWith(codeStripped)) {
        const s = { score: 30, matchedCode: rawCode, matchedAgainst: target.raw, detail: `Stripped suffix match on ${target.label}` };
        if (s.score > best.score) best = s;
        continue;
      }

      // Fuzzy OCR confusion: K6N scanned as KGN, G→6 normalization
      const targetFuzzy = normalizeFuzzy(target.norm);
      if (codeFuzzy.length >= 3 && codeFuzzy === targetFuzzy) {
        const s = { score: 30, matchedCode: rawCode, matchedAgainst: target.raw, detail: `Fuzzy match on ${target.label} (OCR confusion corrected)` };
        if (s.score > best.score) best = s;
        continue;
      }

      const codeStrippedFuzzy = normalizeFuzzy(codeStripped);
      const targetStrippedFuzzy = normalizeFuzzy(target.stripped);
      if (codeStrippedFuzzy.length >= 3 && codeStrippedFuzzy === targetStrippedFuzzy) {
        const s = { score: 28, matchedCode: rawCode, matchedAgainst: target.raw, detail: `Fuzzy prefix-stripped match on ${target.label}` };
        if (s.score > best.score) best = s;
        continue;
      }

      // Substring containment (weaker)
      if (codeNorm.length >= 4 && target.norm.includes(codeNorm)) {
        const s = { score: 20, matchedCode: rawCode, matchedAgainst: target.raw, detail: `Substring of ${target.label}` };
        if (s.score > best.score) best = s;
      }
    }
  }

  return best;
}

// ─── Main Multi-Signal Matcher ────────────────────────────────────────────

export function matchOcrToItem(
  ocrInput: GeminiExtraction | string,
  expectedItem: MatchableItem,
  _itemMrp?: number,
  itemMainGroup?: string | null,
  itemAlias1?: string | null,
  itemParentGroup?: string | null,
): OcrMatchResult {
  const isStructured = typeof ocrInput !== 'string';

  const extraction: GeminiExtraction = isStructured
    ? ocrInput
    : parseRawTextFallback(ocrInput);

  console.log('--- MULTI-SIGNAL OCR MATCHER v2 ---');
  console.log('Expected:', expectedItem.item_name, '| alias:', expectedItem.item_alias, '| alias1:', itemAlias1);
  console.log('Extracted:', JSON.stringify(extraction, null, 2));

  const signals: SignalDetail[] = [];
  let totalScore = 0;
  let fatalReason: string | null = null;

  // ── Signal 1: Part Number (max 40) ──────────────────────────────────

  const partMatch = scorePartNumber(
    extraction.part_numbers,
    expectedItem.item_alias,
    itemAlias1 ?? null,
  );
  signals.push({
    signal: 'part_number',
    score: partMatch.score,
    maxScore: 40,
    detail: partMatch.detail,
  });
  totalScore += partMatch.score;

  // ── Signal 2: Product Type (max 15, fatal on conflict) ──────────────

  const ocrProductType = detectProductType(extraction.product_type || extraction.raw_text);
  // Check item name first, then parent_group as fallback (e.g. "U2 PISTON ASSY")
  const expectedProductType = detectProductType(expectedItem.item_name)
    || (itemParentGroup ? detectProductType(itemParentGroup) : null);

  let productTypeScore = 0;
  let productTypeDetail = '';

  if (ocrProductType && expectedProductType) {
    if (ocrProductType.canonical === expectedProductType.canonical) {
      productTypeScore = 15;
      productTypeDetail = `Match: ${ocrProductType.canonical}`;
    } else if (areProductTypesConflicting(ocrProductType.canonical, expectedProductType.canonical)) {
      fatalReason = `Product type conflict: scanned "${ocrProductType.canonical}" but expected "${expectedProductType.canonical}"`;
      productTypeDetail = fatalReason;
    } else {
      productTypeScore = 5;
      productTypeDetail = `Partial: scanned ${ocrProductType.canonical}, expected ${expectedProductType.canonical} (not conflicting)`;
    }
  } else if (ocrProductType && !expectedProductType) {
    productTypeScore = 3;
    productTypeDetail = `OCR found ${ocrProductType.canonical}, no type in expected name`;
  } else {
    productTypeDetail = 'Product type not detected';
  }

  signals.push({ signal: 'product_type', score: productTypeScore, maxScore: 15, detail: productTypeDetail });
  totalScore += productTypeScore;

  // ── Signal 3: Vehicle Model (max 15) ────────────────────────────────

  const ocrVehicleText = extraction.vehicle_models.join(' ') + ' ' + extraction.raw_text;
  const ocrVehicleFamilies = extractVehicleFamilies(ocrVehicleText);
  const expectedVehicleFamilies = extractVehicleFamilies(expectedItem.item_name);
  const ocrVehicleTokens = extractVehicleTokens(ocrVehicleText);
  const expectedVehicleTokens = extractVehicleTokens(expectedItem.item_name);

  let vehicleScore = 0;
  let vehicleDetail = '';

  if (ocrVehicleFamilies.length > 0 && expectedVehicleFamilies.length > 0) {
    const familyOverlap = ocrVehicleFamilies.some(f => expectedVehicleFamilies.includes(f));
    if (familyOverlap) {
      vehicleScore = 10;
      vehicleDetail = `Vehicle family match: ${ocrVehicleFamilies.filter(f => expectedVehicleFamilies.includes(f)).join(', ')}`;

      const tokenOverlap = ocrVehicleTokens.filter(t => expectedVehicleTokens.includes(t));
      if (tokenOverlap.length > 0) {
        vehicleScore = 15;
        vehicleDetail += ` + model tokens: ${tokenOverlap.join(', ')}`;
      }
    } else {
      vehicleScore = -5;
      vehicleDetail = `Vehicle mismatch: scanned [${ocrVehicleFamilies.join(',')}] vs expected [${expectedVehicleFamilies.join(',')}]`;
    }
  } else if (expectedVehicleFamilies.length === 0) {
    vehicleDetail = 'No vehicle info in expected item';
  } else {
    vehicleDetail = 'No vehicle info extracted from label';
  }

  signals.push({ signal: 'vehicle_model', score: Math.max(0, vehicleScore), maxScore: 15, detail: vehicleDetail });
  totalScore += Math.max(0, vehicleScore);

  // ── Signal 4: Size Variant (max 10, fatal on contradiction) ─────────

  const ocrVariants = extractVariants(
    extraction.size_variant + ' ' + extraction.other_variants.join(' ') + ' ' + extraction.raw_text
  );
  const expectedVariants = extractVariants(expectedItem.item_name);

  let sizeScore = 0;
  let sizeDetail = '';

  if (expectedVariants.sizes.length > 0 && ocrVariants.sizes.length > 0) {
    const sizeMatch = expectedVariants.sizes.some(es =>
      ocrVariants.sizes.some(os => os === es || os.replace(/\s/g, '') === es.replace(/\s/g, ''))
    );
    if (sizeMatch) {
      sizeScore = 10;
      sizeDetail = `Size match: ${ocrVariants.sizes.join(', ')}`;
    } else {
      fatalReason = fatalReason || `Size mismatch: scanned [${ocrVariants.sizes.join(',')}] vs expected [${expectedVariants.sizes.join(',')}]`;
      sizeDetail = fatalReason;
    }
  } else if (expectedVariants.sizes.length > 0) {
    sizeDetail = `Expected size ${expectedVariants.sizes.join(',')} not found on label`;
  } else {
    sizeDetail = 'No size info to compare';
  }

  signals.push({ signal: 'size_variant', score: sizeScore, maxScore: 10, detail: sizeDetail });
  totalScore += sizeScore;

  // ── Signal 5: Emission Standard (max 10, fatal on mismatch) ─────────

  const ocrEmissions = ocrVariants.emissions.length > 0
    ? ocrVariants.emissions
    : extractVariants(extraction.emission_standard).emissions;
  const expectedEmissions = expectedVariants.emissions;

  let emissionScore = 0;
  let emissionDetail = '';

  if (expectedEmissions.length > 0 && ocrEmissions.length > 0) {
    const emMatch = expectedEmissions.some(ee => ocrEmissions.includes(ee));
    if (emMatch) {
      emissionScore = 10;
      emissionDetail = `Emission match: ${ocrEmissions.join(', ')}`;
    } else {
      fatalReason = fatalReason || `Emission mismatch: scanned [${ocrEmissions.join(',')}] vs expected [${expectedEmissions.join(',')}]`;
      emissionDetail = fatalReason;
    }
  } else {
    emissionDetail = 'No emission standard to compare';
  }

  signals.push({ signal: 'emission', score: emissionScore, maxScore: 10, detail: emissionDetail });
  totalScore += emissionScore;

  // ── Signal 6: Other Variants - NC, DURO, HET, side (max 5) ─────────

  let variantScore = 0;
  let variantDetail = '';
  const variantDetails: string[] = [];

  // Side check (fatal on mismatch)
  if (expectedVariants.sides.length > 0 && ocrVariants.sides.length > 0) {
    const sideMatch = expectedVariants.sides.some(es => ocrVariants.sides.includes(es));
    if (!sideMatch) {
      fatalReason = fatalReason || `Side mismatch: scanned [${ocrVariants.sides.join(',')}] vs expected [${expectedVariants.sides.join(',')}]`;
      variantDetails.push(fatalReason);
    } else {
      variantScore += 2;
      variantDetails.push(`Side: ${ocrVariants.sides.join(',')}`);
    }
  }

  // Special variants (NC, DURO, HET, NM, OM)
  for (const spec of expectedVariants.specials) {
    if (ocrVariants.specials.includes(spec)) {
      variantScore += 1;
      variantDetails.push(`${spec} confirmed`);
    } else {
      variantDetails.push(`Expected ${spec} not found`);
    }
  }

  variantScore = Math.min(5, variantScore);
  variantDetail = variantDetails.length > 0 ? variantDetails.join('; ') : 'No special variants to compare';
  signals.push({ signal: 'other_variants', score: variantScore, maxScore: 5, detail: variantDetail });
  totalScore += variantScore;

  // ── Signal 7: Brand (max 5) ─────────────────────────────────────────

  let brandScore = 0;
  let brandDetail = '';

  if (extraction.brand && itemMainGroup) {
    if (matchBrand(extraction.brand, itemMainGroup)) {
      brandScore = 5;
      brandDetail = `Brand match: "${extraction.brand}" → ${itemMainGroup}`;
    } else {
      brandDetail = `Brand mismatch: "${extraction.brand}" vs main_group "${itemMainGroup}"`;
    }
  } else {
    brandDetail = extraction.brand ? 'No main_group to compare' : 'No brand extracted';
  }

  signals.push({ signal: 'brand', score: brandScore, maxScore: 5, detail: brandDetail });
  totalScore += brandScore;

  // ── Final Decision ──────────────────────────────────────────────────

  if (fatalReason) {
    console.log(`FATAL: ${fatalReason}`);
    return buildResult(false, 0, 'multi_signal', signals, extraction, partMatch.matchedCode, fatalReason);
  }

  totalScore = Math.max(0, Math.min(100, totalScore));

  // Dual-threshold: strong code match needs less additional confirmation.
  // Code-primary path: exact/prefix code match (>=33) → threshold 40
  // Signal-primary path: no code match → threshold 55 (needs multiple signals)
  const hasStrongCode = partMatch.score >= 33;
  const threshold = hasStrongCode ? 40 : 55;
  const isMatch = totalScore >= threshold;

  let strategy = 'multi_signal';
  if (hasStrongCode) strategy = 'code_match+signals';
  else if (productTypeScore > 0 && vehicleScore >= 10) strategy = 'type+vehicle+signals';

  const positiveSignals = signals.filter(s => s.score > 0 && s.signal !== 'summary').map(s => s.signal);
  const failedSignals = signals.filter(s => s.score === 0 && s.maxScore > 0 && s.signal !== 'summary').map(s => s.signal);

  const reason = isMatch
    ? `Verified (${totalScore}/100): ${positiveSignals.join(', ')}`
    : totalScore >= 35
      ? `Possible match (${totalScore}/100) — verify manually. Matched: ${positiveSignals.join(', ')}`
      : `No match (${totalScore}/100): ${failedSignals.join(', ')} failed`;

  console.log(`Result: isMatch=${isMatch}, confidence=${totalScore}, strategy=${strategy}, threshold=${threshold}`);
  console.log(`Reason: ${reason}`);

  return buildResult(isMatch, totalScore, strategy, signals, extraction, partMatch.matchedCode, reason);
}

// ─── Raw Text Fallback Parser ─────────────────────────────────────────────
// Used when Gemini JSON parsing fails and we only have raw text

function parseRawTextFallback(rawText: string): GeminiExtraction {
  const partNumbers: string[] = [];

  const patterns: RegExp[] = [
    // Slashed codes: ASK/NA/BS/00002, ASK/CS/0411
    /\b([A-Z]{2,5}(?:\/[A-Z0-9]{1,5}){2,4})\b/g,
    // Labeled codes (stops at newline, not greedy across lines)
    /(?:Part\s*(?:No|Number|Code)|Control\s*No|Product\/Part\s*No)[:\.\s-]*([A-Z0-9][A-Z0-9\-\/. ]{1,25})/gim,
    // Long alphanumeric: SHH0120, INEL53064, 26046091
    /\b([A-Z]{2,4}\d{3,8}[A-Z]?)\b/g,
    // Hyphenated: FOIL-SHIN-1501
    /\b([A-Z]+-[A-Z]+-\d+)\b/gi,
    // 3-char codes: K6N, A71, D32, S75
    /\b([A-Z]\d[A-Z0-9])\b/g,
    // Short letter+digits: D32, S75, L30 (1-2 letters + 2-3 digits)
    /\b([A-Z]{1,2}\s?\d{2,3})\b/g,
    // Pure numeric codes (5+ digits, avoiding years and prices)
    /\b(\d{5,8})\b/g,
    // Dotted codes: PC.217.7.18.003
    /\b([A-Z]{1,3}[\d.]{5,20})\b/g,
  ];

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let m;
    while ((m = pattern.exec(rawText)) !== null) {
      const raw = (m[1] || '').trim();
      if (!raw) continue;
      // Skip if it looks like a year, price, or very short noise
      const norm = raw.replace(/\s+/g, '');
      if (/^\d{4}$/.test(norm) && parseInt(norm) >= 2020 && parseInt(norm) <= 2035) continue;
      partNumbers.push(raw);
    }
  }

  const productType = detectProductType(rawText);
  const vehicleFamilies = extractVehicleFamilies(rawText);
  const vehicleTokens = extractVehicleTokens(rawText);

  let mrp: number | null = null;
  const mrpRe = /(?:M\.?R\.?P\.?|Rs\.?|₹)\s*[:.]?\s*([\d,]+(?:\.\d{1,2})?)/gi;
  const mrpMatch = mrpRe.exec(rawText);
  if (mrpMatch) {
    mrp = parseFloat(mrpMatch[1].replace(/,/g, ''));
  }

  let brand = '';
  const brandPatterns: [RegExp, string][] = [
    [/\bASK\b/i, 'ASK'],
    [/\bUSHA\b/i, 'USHA'],
    [/\bShriram\b/i, 'USHA'],
    [/\bDIAMOND\b/i, 'DIAMOND'],
    [/\bLucas\s*TVS\b/i, 'Lucas TVS'],
    [/\bSuprajit\b/i, 'Suprajit'],
    [/\bKSPG\b/i, 'KSPG'],
    [/\bVarroc\b/i, 'Varroc'],
  ];
  for (const [re, name] of brandPatterns) {
    if (re.test(rawText)) { brand = name; break; }
  }

  const variants = extractVariants(rawText);

  return {
    part_numbers: [...new Set(partNumbers)],
    product_type: productType?.canonical || '',
    brand,
    vehicle_models: vehicleFamilies.length > 0
      ? vehicleFamilies.map(f => {
          const tokens = vehicleTokens.filter(t => t !== f.toLowerCase());
          return tokens.length > 0 ? `${f} ${tokens.join(' ')}` : f;
        })
      : [],
    mrp,
    size_variant: variants.sizes.join(', '),
    emission_standard: variants.emissions.join(', '),
    other_variants: [...variants.specials, ...variants.sides],
    raw_text: rawText,
  };
}

// ─── Result Builder ───────────────────────────────────────────────────────

function buildResult(
  isMatch: boolean,
  confidence: number,
  strategy: string,
  signals: SignalDetail[],
  extraction: GeminiExtraction,
  matchedCode: string,
  reason: string,
): OcrMatchResult {
  return {
    isMatch,
    confidence,
    matchedFields: signals.filter(s => s.score > 0).map(s => s.signal),
    signals: [...signals, { signal: 'summary', score: confidence, maxScore: 100, detail: reason }],
    ocrExtracted: {
      partNumber: matchedCode || extraction.part_numbers[0] || null,
      description: extraction.product_type || null,
      mrp: extraction.mrp,
      brand: extraction.brand || null,
      vehicleModel: extraction.vehicle_models[0] || null,
    },
    matchStrategy: strategy,
  };
}
