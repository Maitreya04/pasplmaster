/* ─── Brand-Aware Pattern Registry ────────────────────────────────────────
 *
 * Config-driven detection rules for brands commonly found on 2-wheeler
 * auto-part packaging. Each brand entry defines:
 *   - detect:              regexes to identify the brand from OCR text
 *   - partNumberPatterns:  brand-specific part-number formats
 *   - nameTokens:          tokens that appear in the DB `name` / `main_group`
 *   - productTypeAliases:  how this brand labels product categories
 * ──────────────────────────────────────────────────────────────────────── */

export interface BrandConfig {
  id: string;
  detect: RegExp[];
  partNumberPatterns: RegExp[];
  nameTokens: string[];
}

export const BRANDS: BrandConfig[] = [
  {
    id: 'ask',
    detect: [/\bASK\s*(?:Automotive|Brake)\b/i, /\bASK\b/],
    partNumberPatterns: [
      /\bASK\/[A-Z]{1,4}\/[A-Z0-9/]+\b/gi,
      /\bASK\/[A-Z]{1,4}\b/gi,
    ],
    nameTokens: ['ask'],
  },
  {
    id: 'suprajit',
    detect: [/\bSuprajit\b/i],
    partNumberPatterns: [
      /\bSH[A-Z]{1,3}\d{3,5}\b/gi,
    ],
    nameTokens: ['sj', 'suprajit'],
  },
  {
    id: 'lucas_tvs',
    detect: [/\bLucas\s*TVS\b/i],
    partNumberPatterns: [
      /\b\d{7,8}\b/g,
    ],
    nameTokens: ['lucas', 'tvs', 'lucas tvs'],
  },
  {
    id: 'varroc',
    detect: [/\bVarroc\b/i],
    partNumberPatterns: [
      /\b[A-Z]{3,5}-[A-Z]{3,5}-[A-Z]{2}\d{2,3}\b/gi,
      /\b[A-Z]{4}-[A-Z]{4}-[A-Z0-9]{4,6}\b/gi,
    ],
    nameTokens: ['ve', 'varroc'],
  },
  {
    id: 'usha',
    detect: [/\bUSHA\b/i, /\bShriram\b/i],
    partNumberPatterns: [
      /\b\d{4,5}\b/g,
    ],
    nameTokens: ['usha', 'shriram'],
  },
];

/* ─── Vehicle Model Tokens ────────────────────────────────────────────── *
 * Maps shorthand codes found on labels to canonical tokens that appear    *
 * in item names. Used by the vehicle-model signal.                        *
 * ──────────────────────────────────────────────────────────────────────── */

export const VEHICLE_TOKENS: [RegExp, string[]][] = [
  [/\bACT[\s-]*(?:N|IVA)\s*\d*/gi, ['activa']],
  [/\bHN\s+ACT/gi, ['honda', 'activa']],
  [/\bSHNE|SHINE\b/gi, ['shine']],
  [/\bHN\s+SHNE/gi, ['honda', 'shine']],
  [/\bSPL(?:ENDOR|DR|ENDER)\s*(?:PLUS|PRO|\+)?\b/gi, ['splendor']],
  [/\bSPLENDOR\s*PLUS\b/gi, ['splendor', 'plus']],
  [/\bPASSION|PASSN\b/gi, ['passion']],
  [/\bPASSION\s*PRO\b/gi, ['passion', 'pro']],
  [/\bCD\s*D(?:AWN|LX|ELUXE)\b/gi, ['cd', 'deluxe']],
  [/\bHF\s*(?:DELUXE|DLX|HFDL)\b/gi, ['hf', 'deluxe']],
  [/\bPULSAR\s*\d*/gi, ['pulsar']],
  [/\bCT\s*100\b/gi, ['ct100']],
  [/\bAPACHE\b/gi, ['apache']],
  [/\bMAESTRO\b/gi, ['maestro']],
  [/\bGLAMOU?R\b/gi, ['glamour']],
  [/\bXTREME\b/gi, ['xtreme']],
  [/\bUNICORN\b/gi, ['unicorn']],
  [/\bCB\s*SHINE\b/gi, ['cb', 'shine']],
  [/\bBS6\b/gi, ['bs6']],
  [/\bBS4\b/gi, ['bs4']],
  [/\bHERO\b/gi, ['hero']],
  [/\bHONDA\b/gi, ['honda']],
  [/\bTVS\b/gi, ['tvs']],
  [/\bBAJAJ\b/gi, ['bajaj']],
  [/\bYAMAHA\b/gi, ['yamaha']],
  [/\bSUZUKI\b/gi, ['suzuki']],
  [/\bROYAL\s*ENFIELD\b/gi, ['royal', 'enfield']],
];

/* ─── Product Type Tokens ─────────────────────────────────────────────── *
 * Maps label descriptions to canonical product-type tokens.               *
 * ──────────────────────────────────────────────────────────────────────── */

export const PRODUCT_TYPE_TOKENS: [RegExp, string[]][] = [
  [/\bBRAKE\s*SHOE/gi, ['brake', 'shoe']],
  [/\bDISC\s*(?:BRAKE\s*)?PAD/gi, ['disc', 'pad']],
  [/\bBRAKE\s*PAD/gi, ['brake', 'pad']],
  [/\bCLUTCH\s*SHOE/gi, ['clutch', 'shoe']],
  [/\bCLUTCH\s*CABLE/gi, ['clutch', 'cable']],
  [/\bACCEL(?:ERATOR)?\s*CABLE/gi, ['acc', 'cable']],
  [/\bSPEEDO(?:METER)?\s*(?:CABLE|ASSEMBLY)/gi, ['speedo']],
  [/\bSTARTER\b/gi, ['starter']],
  [/\bSTATOR\b/gi, ['stator']],
  [/\bFUEL\s*PUMP/gi, ['fuel', 'pump']],
  [/\bENGINE\s*VALVE/gi, ['engine', 'valve']],
  [/\bSHOCK(?:\s*ABSORBER)?/gi, ['shock']],
  [/\bHANDLE\s*BAR/gi, ['handle', 'bar']],
  [/\bHEAD\s*LIGHT/gi, ['head', 'light']],
  [/\bTAIL\s*LIGHT/gi, ['tail', 'light']],
  [/\bINDICATOR/gi, ['indicator']],
  [/\bCHAIN\s*(?:SPROCKET|KIT|SET)/gi, ['chain']],
  [/\bPISTON/gi, ['piston']],
  [/\bCYLINDER\s*KIT/gi, ['cylinder', 'kit']],
  [/\bCRANK\s*SHAFT/gi, ['crank']],
  [/\bBEARING/gi, ['bearing']],
  [/\bSEAL/gi, ['seal']],
  [/\bGASKET/gi, ['gasket']],
];

/* ─── Noise Patterns ──────────────────────────────────────────────────── *
 * Lines matching any of these are stripped before matching.                *
 * ──────────────────────────────────────────────────────────────────────── */

export const NOISE_LINE_PATTERNS: RegExp[] = [
  /(?:Plot\s*No|Flat\s*No|Address|Township|Sector|Phase)\s*[.:]/i,
  /(?:Phone|Tel|Fax|Mobile)\s*(?:No)?[.:]/i,
  /(?:E-?mail|Website|Web|www\.|http)/i,
  /Customer\s*Care/i,
  /\+91[\s-]?\d/,
  /\b\d{3,5}[\s-]\d{6,8}\b/,
  /Manufactured\s*(?:by|&\s*Marketed)/i,
  /Mfg\.?\s*&\s*Mrkt/i,
];

export const NOISE_PHRASES: RegExp[] = [
  /\bMade\s+in\s+India\b/gi,
  /\b(?:Inclusive|Incl\.?)\s+of\s+all\s+taxes\b/gi,
  /\bASBESTOS\s+FREE\b/gi,
  /\bISO\s*\d{4}[:\d]*/gi,
  /\bIATF[\s-]*\d+/gi,
  /\bAN\s+.*?COMPANY\b/gi,
  /\bOE\s+Quality\b/gi,
  /\bGENUINE\b/gi,
  /\bFRICTION\s+FREE\b/gi,
  /\bBETTER\s+EFFICIENCY\b/gi,
  /\bLONG\s+LIFE\b/gi,
  /\bTHINK\s+SAFETY\b/gi,
  /\bGLOBAL\s+LEADER\b/gi,
  /\bWHOLESALE\s+PACKAGE\b/gi,
];

/* Lines that are purely long alphanumeric batch/serial codes (15+ chars). */
export const BATCH_CODE_RE = /^[A-Z0-9]{15,}$/;

/* ─── MRP Extraction Patterns ─────────────────────────────────────────── *
 * Ordered by specificity — first match wins.                              *
 * ──────────────────────────────────────────────────────────────────────── */

export const MRP_PATTERNS: RegExp[] = [
  /(?:NEW\s+)?M\.?R\.?P\.?\s*[:.]?\s*(?:Rs\.?-?|₹)\s*([\d,]+(?:\.\d{1,2})?)/gi,
  /(?:Rs\.?-?|₹)\s*([\d,]+(?:\.\d{1,2})?)\s*(?:\(?\s*(?:Inclusive|Incl)\.?(?:\s+of\s+all\s+taxes)?\)?)?/gi,
  /(?:Rs\.?-?|₹)\s*([\d,]+(?:\.\d{1,2})?)/gi,
];

export const PER_NUMBER_RE =
  /(?:Rs\.?|₹)\s*([\d,]+(?:\.\d{1,2})?)\s*PER\s+NUMBER/gi;

export const QUANTITY_PATTERNS: RegExp[] = [
  /Qty\.?\s*[:.]?\s*(\d+)\s*(?:Unit|N(?:o|umber)?s?)\b/gi,
  /Quantity\s*[:.]?\s*(\d+)\s*(?:Unit|N(?:o|umber)?s?)\b/gi,
  /\b(\d+)\s*Unit\b/gi,
  /\b(\d+)\s*N\b/g,
];

/* ─── Labeled Part Number Patterns ────────────────────────────────────── *
 * Generic labeled patterns applied before brand-specific ones.            *
 * ──────────────────────────────────────────────────────────────────────── */

export const LABELED_PART_PATTERNS: RegExp[] = [
  /Part\s*No\.?\s*[:.]?\s*([A-Z0-9][A-Z0-9/\-\s]{1,30})/gi,
  /PART\s*(?:NUMBER|NO\.?)\s*[:.]?\s*([A-Z0-9][A-Z0-9/\-\s]{1,30})/gi,
];
