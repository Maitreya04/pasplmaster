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

const LAYER_1_PATTERNS = [
  // 1. Slashed codes
  /\b([A-Z]{2,5}(?:\/[A-Z0-9]{1,5}){2,4})\b/g,
  // 2. Labeled codes
  /(?:Part\s*(?:No|Number|Code)|Control\s*No|Model|Product)[:\.\s-]*([A-Z0-9\-\/\s]{2,20})/gi,
  // 3. Alphanumeric codes
  /\b([A-Z]{2,4}\d{3,8}[A-Z]?)\b/g,
  // 4. Hyphenated codes
  /\b([A-Z]+-[A-Z]+-\d+)\b/gi,
  // 5. Short codes
  /\b([A-Z]\d{1,3}\s?[A-Z]{0,3})\b/g,
  // 6. Pure numbers
  /\b(\d{4,8})\b/g,
];

function extractCodes(text: string): string[] {
  const codes: string[] = [];
  for (const pattern of LAYER_1_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      if (match[1]) codes.push(match[1].trim());
    }
  }
  return codes;
}

function normalizeCode(code: string): string {
  return code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

function stripPrefixes(normalizedCode: string): string {
  return normalizedCode.replace(/^(P|R|UK|UB|UF|G|U2|UP|UR)/i, '');
}

export function matchOcrToItem(
  ocrText: string,
  expectedItem: MatchableItem,
  _itemMrp?: number,
  _itemMainGroup?: string | null,
  itemAlias1?: string | null,
): OcrMatchResult {
  // Layer 1
  const extractedCodes = extractCodes(ocrText);
  const aliasNorm = expectedItem.item_alias ? normalizeCode(expectedItem.item_alias) : null;
  const alias1Norm = itemAlias1 ? normalizeCode(itemAlias1) : null;
  const nameNorm = normalizeCode(expectedItem.item_name);

  for (const rawCode of extractedCodes) {
    const codeNorm = normalizeCode(rawCode);
    if (!codeNorm) continue;

    const targets = [aliasNorm, alias1Norm].filter(Boolean) as string[];

    for (const target of targets) {
      // Check 1: Exact
      if (codeNorm === target) {
        return createMatchResult(true, 95, 'code_match', `Exact match: ${rawCode} with ${target}`, rawCode);
      }
      // Check 2: Code is substring of target
      if (target.includes(codeNorm) && codeNorm.length >= 3) {
        return createMatchResult(true, 95, 'code_match', `Substring (code in target): ${codeNorm} in ${target}`, rawCode);
      }
      // Check 3: Target is substring of code
      if (codeNorm.includes(target) && target.length >= 3) {
        return createMatchResult(true, 95, 'code_match', `Substring (target in code): ${target} in ${codeNorm}`, rawCode);
      }
      // Check 4: Prefix-stripped match
      const strippedCode = stripPrefixes(codeNorm);
      const strippedTarget = stripPrefixes(target);
      if (strippedCode === strippedTarget && strippedCode.length >= 3) {
        return createMatchResult(true, 95, 'code_match', `Prefix-stripped match: ${rawCode} vs ${target} -> ${strippedCode}`, rawCode);
      }
    }

    // Check 5: Code found anywhere in expectedItem.name
    if (nameNorm.includes(codeNorm) && codeNorm.length >= 3) {
      return createMatchResult(true, 95, 'code_match', `Code in name: ${codeNorm} in ${expectedItem.item_name}`, rawCode);
    }
  }

  // Layer 2: Keyword Description Match
  const NOISE_WORDS = ['USHA', 'USHA2', 'INEL', 'TIDC', 'ASK', 'SJ', 'VE', 'TE', 'SW', 'BG', 'BA', 'EV', 'KV', 'LC', 'THE', 'FOR', 'AND', 'WITH', 'NEW'];
  
  const extractWords = (text: string) => 
    text.toUpperCase().split(/[^A-Z0-9]+/).filter(w => w.length >= 2);

  const expectedWords = extractWords(expectedItem.item_name).filter(w => !NOISE_WORDS.includes(w));
  const ocrWords = extractWords(ocrText);

  if (expectedWords.length === 0) {
    return createMatchResult(false, 0, 'keyword_match', 'No valid words to match after noise filter', extractedCodes[0] || null);
  }

  let matchCount = 0;
  for (const expected of expectedWords) {
    if (ocrWords.some(ocrWord => ocrWord === expected || ocrWord.includes(expected) || expected.includes(ocrWord))) {
      matchCount++;
    }
  }

  const matchPercent = matchCount / expectedWords.length;
  let confidence = 0;
  let isMatch = false;
  let detail = `Mapped ${matchCount}/${expectedWords.length} words`;

  if (matchPercent >= 0.8) {
    confidence = 90;
    isMatch = true;
  } else if (matchPercent >= 0.6) {
    confidence = 75;
    isMatch = true;
  } else if (matchPercent >= 0.4) {
    confidence = 50;
    isMatch = false;
    detail = 'Possible match — verify manually';
  }

  return createMatchResult(isMatch, confidence, 'keyword_match', detail, extractedCodes[0] || null);
}

function createMatchResult(
  isMatch: boolean, 
  confidence: number, 
  strategy: string, 
  detail: string,
  partNumber: string | null = null
): OcrMatchResult {
  return {
    isMatch,
    confidence,
    matchedFields: [strategy],
    signals: [
      {
        signal: strategy,
        score: confidence,
        maxScore: 100,
        detail,
      }
    ],
    ocrExtracted: {
      partNumber,
      description: null,
      mrp: null,
      brand: null,
      vehicleModel: null
    },
    matchStrategy: strategy
  };
}
