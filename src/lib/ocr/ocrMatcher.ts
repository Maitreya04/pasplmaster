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

// === CODE EXTRACTION ===
const LAYER_1_PATTERNS = [
  // 1. Slashed codes: ASK/NA/BS/00002
  /\b([A-Z]{2,5}(?:\/[A-Z0-9]{1,5}){2,4})\b/g,
  // 2. Labeled codes
  /(?:Part\s*(?:No|Number|Code)|Control\s*No|Product\/Part\s*No|SAP\s*Code)[:\.\s-]*([A-Z0-9\-\/\s]{2,25})/gi,
  // 3. Alphanumeric: SHSP1501, INEL53064
  /\b([A-Z]{2,4}\d{3,8}[A-Z]?)\b/g,
  // 4. Hyphenated: FOIL-SHIN-1501
  /\b([A-Z]+-[A-Z]+-\d+)\b/gi,
  // 5. 3-char codes: K6N, A71, A9
  /\b([A-Z]\d[A-Z0-9])\b/g,
  // 6. Pure numbers: 53064, 7157
  /\b(\d{4,8})\b/g,
  // 7. Prefix codes: P-D32, R-D32, D32
  /\b([A-Z]\-?[A-Z]?\d{1,3})\b/g,
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

const PREFIXES_TO_STRIP = /^(P|R|UK|UB|UF|G|U2|UP|UR|INEL|TIDC|ASK)/i;
function stripPrefixes(normalizedCode: string): string {
  return normalizedCode.replace(PREFIXES_TO_STRIP, '').replace(PREFIXES_TO_STRIP, ''); // Replace twice in case of TIDCINEL
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

// === VARIANT VALIDATION ===
interface VariantTokens {
  size: string[];
  side: string[];
  position: string[];
  cover: string[];
  emission: string[];
  duro: string[];
}

function extractVariants(text: string): VariantTokens {
  const normText = ' ' + text.toUpperCase().replace(/[^A-Z0-9.]/g, ' ') + ' ';
  
  const extract = (regex: RegExp) => {
    const matches: string[] = [];
    regex.lastIndex = 0;
    let m;
    while ((m = regex.exec(normText)) !== null) {
      matches.push(m[1]);
    }
    return [...new Set(matches)]; // Deduplicate
  };

  return {
    size: extract(/\b(STD|0\.25|0\.50|0\.75|1\.00|25MM|47MM|50MM|65MM|010|020)\b/g),
    side: extract(/\b(RH|LH|RIGHT|LEFT)\b/g),
    position: extract(/\b(FRONT|REAR|FR|RR|F|R)\b/g),
    cover: extract(/\b(NC)\b/g),
    emission: extract(/\b(BS3|BS4|BS6|BSVI|BSIII|BSIV)\b/g),
    duro: extract(/\b(DURO)\b/g),
  };
}

function normalizeSide(side: string): string {
  if (side === 'RH' || side === 'RIGHT') return 'RH';
  if (side === 'LH' || side === 'LEFT') return 'LH';
  return side;
}

function normalizeEmission(em: string): string {
  if (em === 'BSVI' || em === 'BS6') return 'BS6';
  if (em === 'BSIV' || em === 'BS4') return 'BS4';
  if (em === 'BSIII' || em === 'BS3') return 'BS3';
  return em;
}

interface VariantCheckResult {
  confidencePenalty: number;
  isFatal: boolean;
  bonus: number;
  details: string[];
}

function validateVariants(expected: VariantTokens, found: VariantTokens): VariantCheckResult {
  let penalty = 0;
  let bonus = 0;
  let isFatal = false;
  const details: string[] = [];

  // Size Check: If expected contains a size, found MUST contain it
  if (expected.size.length > 0) {
    const hasMatch = expected.size.some(es => found.size.includes(es));
    if (!hasMatch) {
      penalty += 40;
      details.push(`Missing expected size (${expected.size.join(', ')})`);
    } else {
      bonus += 5;
    }
  }

  // Side Check: RH/LH mismatch is FATAL
  if (expected.side.length > 0) {
    const exSides = expected.side.map(normalizeSide);
    const foundSides = found.side.map(normalizeSide);
    const hasMatch = exSides.some(es => foundSides.includes(es));
    // If we have an explicit expected side, and a found side, but they don't match -> FATAL
    // Wait, the rule says "If expected item name contains RH or LH, OCR must match the SAME side. Wrong side = isMatch false."
    // What if OCR is missing the side entirely but the expected has it? This implies "Wrong side" = failure. 
    // And if it is missing? If missing, it might just be the camera didn't pick it up. Let's fail if it's explicitly the *wrong* side, or fail if missing.
    // "Wrong side = isMatch false"
    if (foundSides.length > 0 && !hasMatch) {
      isFatal = true;
      details.push(`Side mismatch: expected ${exSides.join(', ')} but found ${foundSides.join(', ')}`);
    } else if (foundSides.length === 0) {
      // Missing side is not explicitly fatal in prompt, but we can penalize or just let it pass
      penalty += 20;
      details.push(`Missing expected side (${expected.side.join(', ')})`);
    } else {
      bonus += 5;
    }
  }

  // Cover Check: NC
  if (expected.cover.includes('NC')) {
    if (!found.cover.includes('NC')) {
      penalty += 20;
      details.push('Missing NC cover variant');
    } else {
      bonus += 5;
    }
  }

  // Duro Check
  if (expected.duro.includes('DURO')) {
    if (!found.duro.includes('DURO')) {
      penalty += 30;
      details.push('Missing DURO variant');
    } else {
      bonus += 5;
    }
  }

  // Emission Check
  if (expected.emission.length > 0) {
    const exEms = expected.emission.map(normalizeEmission);
    const foundEms = found.emission.map(normalizeEmission);
    const hasMatch = exEms.some(es => foundEms.includes(es));
    if (foundEms.length > 0 && !hasMatch) {
      isFatal = true;
      details.push(`Emission mismatch: expected ${exEms.join(', ')} but found ${foundEms.join(', ')}`);
    } else if (!hasMatch) {
      penalty += 20;
      details.push('Missing expected emission variant');
    } else {
      bonus += 5;
    }
  }

  // If there are expected variants and they all matched beautifully:
  if (penalty === 0 && !isFatal && bonus > 0) {
    bonus = 20; // Overall bonus if all present variants matched perfectly
  }

  return { confidencePenalty: penalty, isFatal, bonus, details };
}

export function matchOcrToItem(
  ocrText: string,
  expectedItem: MatchableItem,
  _itemMrp?: number,
  _itemMainGroup?: string | null,
  itemAlias1?: string | null,
): OcrMatchResult {
  console.log('--- OCR MATCHING ENGINE ---');
  console.log('OCR text:', ocrText.replace(/\n/g, ' '));

  // Extract Codes
  const extractedCodes = extractCodes(ocrText);
  console.log('Extracted codes:', extractedCodes);

  const aliasNorm = expectedItem.item_alias ? normalizeCode(expectedItem.item_alias) : null;
  const alias1Norm = itemAlias1 ? normalizeCode(itemAlias1) : null;
  const nameNorm = normalizeCode(expectedItem.item_name);

  // Pre-calculate variants for both
  const expectedVariants = extractVariants(expectedItem.item_name);
  const foundVariants = extractVariants(ocrText);
  console.log('Variant check: expected', expectedVariants, 'vs found', foundVariants);

  const variantCheck = validateVariants(expectedVariants, foundVariants);
  console.log('Variant check result:', variantCheck);

  // === LAYER 1: CODE MATCH ===
  let bestLayer1Match: { code: string; type: string; baseConfidence: number; ambiguityWarning: boolean } | null = null;
  
  if (extractedCodes.length > 0) {
    for (const rawCode of extractedCodes) {
      const codeNorm = normalizeCode(rawCode);
      if (!codeNorm) continue;

      const targets = [
        { type: 'item_alias', val: aliasNorm },
        { type: 'alias1', val: alias1Norm }
      ].filter(t => t.val) as { type: string; val: string }[];

      for (const target of targets) {
        // a) Exact normalized match
        if (codeNorm === target.val) {
          console.log(`Layer 1: code '${codeNorm}' vs ${target.type} '${target.val}' -> exact -> match`);
          bestLayer1Match = { code: rawCode, type: `Exact match with ${target.type}`, baseConfidence: 95, ambiguityWarning: false };
          break; // Highest priority
        }
        
        // b) Code is substring of target (with Ambiguity rule)
        // E.g. rawCode "K6N". target "TIDCK6N" or "TIDCK6ND"
        // Prompt rule: boundaries or variants handle disambiguation.
        // Actually ambiguity checking would ideally look at the whole DB, but here we can only check if variant validates it.
        // We set ambiguityWarning if it's a substring match so Variant logic is strictly required to pass a high bar.
        if (target.val.includes(codeNorm) && codeNorm.length >= 3) {
          console.log(`Layer 1: code '${codeNorm}' vs ${target.type} '${target.val}' -> substring (code in target) -> match`);
          bestLayer1Match = bestLayer1Match || { code: rawCode, type: `Substring (code in target ${target.type})`, baseConfidence: 85, ambiguityWarning: true };
        }
        
        // c) Target is substring of code
        if (codeNorm.includes(target.val) && target.val.length >= 3) {
          console.log(`Layer 1: code '${codeNorm}' vs ${target.type} '${target.val}' -> substring (target in code) -> match`);
          bestLayer1Match = bestLayer1Match || { code: rawCode, type: `Substring (target ${target.type} in code)`, baseConfidence: 85, ambiguityWarning: true };
        }

        // d) Prefix-stripped match
        const strippedCode = stripPrefixes(codeNorm);
        const strippedTarget = stripPrefixes(target.val);
        if (strippedCode === strippedTarget && strippedCode.length >= 3 && strippedCode !== codeNorm) {
          console.log(`Layer 1: code '${codeNorm}' vs ${target.type} '${target.val}' -> prefix-stripped (${strippedCode}) -> match`);
          bestLayer1Match = bestLayer1Match || { code: rawCode, type: `Prefix-stripped match with ${target.type}`, baseConfidence: 90, ambiguityWarning: false };
        }
      }

      if (bestLayer1Match?.baseConfidence === 95) break;

      // e) Code found in expectedItem.name text
      if (nameNorm.includes(codeNorm) && codeNorm.length >= 3) {
        console.log(`Layer 1: code '${codeNorm}' vs name -> substring -> match`);
        bestLayer1Match = bestLayer1Match || { code: rawCode, type: `Code found in name`, baseConfidence: 80, ambiguityWarning: true };
      }
    }
  }

  // === LAYER 1.5: FUZZY TOKEN SCAN ===
  // If strict code extraction failed to yield a match, attempt looking at every alphanumeric token.
  // This catches cases where OCR reads K6N as KGN, or it has weird boundaries.
  if (!bestLayer1Match) {
    console.log('Layer 1 strict extraction failed, attempting fuzzy token scan...');
    const looseTokens = ocrText.replace(/[^A-Za-z0-9]/g, ' ').split(/\s+/).filter(t => t.length >= 3);
    
    for (const token of looseTokens) {
      const tokenNorm = token.toUpperCase();
      const tokenFuzzy = normalizeFuzzy(tokenNorm);

      const targets = [
        { type: 'item_alias', val: aliasNorm },
        { type: 'alias1', val: alias1Norm }
      ].filter(t => t.val) as { type: string; val: string }[];

      for (const target of targets) {
        const targetFuzzy = normalizeFuzzy(target.val);
        
        if (tokenFuzzy === targetFuzzy) {
          console.log(`Layer 1.5: fuzzy token '${tokenNorm}' vs ${target.type} '${target.val}' -> match`);
          bestLayer1Match = { code: token, type: `Fuzzy exact match with ${target.type}`, baseConfidence: 85, ambiguityWarning: false };
          break;
        }
        
        if (targetFuzzy.includes(tokenFuzzy) && tokenFuzzy.length >= 3) {
           console.log(`Layer 1.5: fuzzy token '${tokenNorm}' vs ${target.type} '${target.val}' -> substring match`);
           bestLayer1Match = bestLayer1Match || { code: token, type: `Fuzzy substring with ${target.type}`, baseConfidence: 75, ambiguityWarning: true };
        }
        
        if (tokenFuzzy.includes(targetFuzzy) && targetFuzzy.length >= 3) {
           console.log(`Layer 1.5: fuzzy target '${target.val}' in token '${tokenNorm}' -> substring match`);
           bestLayer1Match = bestLayer1Match || { code: token, type: `Fuzzy target in token with ${target.type}`, baseConfidence: 75, ambiguityWarning: true };
        }
      }
      if (bestLayer1Match?.baseConfidence === 85) break;
    }
  }

  // Evaluate Layer 1
  if (bestLayer1Match) {
    if (variantCheck.isFatal) {
      console.log('Final: isMatch=false, variant check fatal (Side/Emission mismatch)');
      return createMatchResult(false, 0, 'code_match', `Code matched but fatal variant mismatch: ${variantCheck.details.join(', ')}`, bestLayer1Match.code);
    }
    
    let finalConfidence = bestLayer1Match.baseConfidence - variantCheck.confidencePenalty + variantCheck.bonus;
    
    // If ambiguous substring, and we had significant penalties (e.g. missing Duro), it drops confidence.
    if (bestLayer1Match.ambiguityWarning && variantCheck.confidencePenalty > 0) {
      console.log('Ambiguous code match + variant mismatch -> reducing confidence.');
      finalConfidence -= 20; // Additional penalty for ambiguous matches without confirming variants
    }

    finalConfidence = Math.max(0, Math.min(100, finalConfidence));
    
    if (finalConfidence >= 70) {
      console.log(`Final: isMatch=true, confidence=${finalConfidence}, method=code_match+variant_verified: ${bestLayer1Match.type}`);
      return createMatchResult(true, finalConfidence, 'code_match', `Code match + variants: ${variantCheck.details.join(', ') || 'OK'}`, bestLayer1Match.code);
    } else {
      console.log(`Layer 1 code match confidence dropped to ${finalConfidence} due to variant penalties. Falling to Layer 2...`);
    }
  }

  // === LAYER 2: KEYWORD MATCH ===
  console.log('Falling back to Layer 2: Keyword Match');
  const NOISE_WORDS = ['USHA', 'USHA2', 'INEL', 'TIDC', 'ASK', 'SJ', 'VE', 'TE', 'SW', 'BG', 'BA', 'EV', 'KV', 'LC', 'THE', 'FOR', 'AND', 'WITH', 'NEW', 'PART', 'NO', 'NUMBER', 'CODE'];
  
  const extractWords = (text: string) => 
    text.toUpperCase().split(/[^A-Z0-9]+/).filter(w => w.length >= 2);

  const expectedWords = extractWords(expectedItem.item_name).filter(w => !NOISE_WORDS.includes(w));
  const ocrWords = extractWords(ocrText).filter(w => !NOISE_WORDS.includes(w));

  if (expectedWords.length === 0) {
    return createMatchResult(false, 0, 'keyword_match', 'No valid words to match after noise filter', extractedCodes[0] || null);
  }

  let matchCount = 0;
  for (const expected of expectedWords) {
    if (ocrWords.some(ocrWord => ocrWord === expected || ocrWord.includes(expected) || expected.includes(ocrWord))) {
      matchCount++;
    }
  }

  const keywordRatio = matchCount / expectedWords.length;
  console.log(`Layer 2: ${matchCount}/${expectedWords.length} keywords matched (${Math.round(keywordRatio * 100)}%)`);

  let keywordScore = (keywordRatio * 80) + variantCheck.bonus - variantCheck.confidencePenalty;
  
  if (variantCheck.isFatal) {
    console.log('Layer 2 rejected due to fatal variant mismatch.');
    keywordScore = 0;
  }

  keywordScore = Math.max(0, Math.min(100, keywordScore));
  
  let isMatch = false;
  let detail = `Matched ${matchCount}/${expectedWords.length} words. Variants: ${variantCheck.details.join(', ') || 'OK'}`;

  // Scoring:
  // >= 70 total confidence: isMatch true
  // 50-69: "Possible match — verify"
  // < 50: no match
  if (keywordScore >= 70) {
    isMatch = true;
  } else if (keywordScore >= 50) {
    isMatch = false;
    detail = `Possible match — verify. ${detail}`;
  } else {
    isMatch = false;
  }

  console.log(`Final: isMatch=${isMatch}, confidence=${Math.round(keywordScore)}, method=keyword_match`);
  return createMatchResult(isMatch, Math.round(keywordScore), 'keyword_match', detail, extractedCodes[0] || null);
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
