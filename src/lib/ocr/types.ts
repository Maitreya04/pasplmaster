// Shared OCR types for extraction, normalization, matching, and admin-lab display.
export type OCRQtyUnit = 'pcs' | 'set' | 'packet' | 'net' | 'box';

export interface GeminiRawItem {
  raw_text: string;
  qty: number;
  qty_unit: OCRQtyUnit;
  is_cancelled: boolean;
}

export interface GeminiRawOrder {
  customer_name: string | null;
  items: GeminiRawItem[];
}

export type OCRTokenType =
  | 'numeric_code'
  | 'brand_code'
  | 'dimension'
  | 'description'
  | 'hindi';

export interface NormalizedItem extends GeminiRawItem {
  token_type: OCRTokenType;
  clean_code: string | null;
  variant_flags: string[];
  expanded_description: string;
  vehicle_context: string | null;
  pricing_note: string | null;
}

export interface ItemMatch {
  item_code: string;
  item_name: string;
  alias: string | null;
  alias1: string | null;
  brand: string;
  group_name: string;
}

export type MatchConfidence = 'high' | 'medium' | 'low' | 'none';
export type MatchStrategy = 'exact_code' | 'prefix_code' | 'description_search' | 'none';

export interface MatchedItem extends NormalizedItem {
  match_result: ItemMatch | null;
  confidence: MatchConfidence;
  match_candidates: ItemMatch[];
  match_strategy: MatchStrategy;
  match_explanation: string;
  history_boosted: boolean;
}

export interface OCROrderResult {
  customer_name: string | null;
  items: MatchedItem[];
  customer_context: {
    input_customer_id: string | null;
    resolved_customer_id: string | null;
    resolved_customer_name: string | null;
    resolution_source: 'provided_id' | 'extracted_name' | 'none';
  };
  stats: {
    total: number;
    high: number;
    medium: number;
    low: number;
    none: number;
  };
}
