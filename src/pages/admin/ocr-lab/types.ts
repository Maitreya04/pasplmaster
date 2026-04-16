import type { MatchedItem, MatchConfidence, OCROrderResult } from '../../../lib/ocr/types';

export type OcrStageScreen = 'home' | 'upload' | 'scanning' | 'review' | 'summary';
export type OcrStageStatus = 'pending' | 'confirmed' | 'edited';

export interface LoadedOcrImage {
  name: string;
  mimeType: string;
  base64: string;
  previewUrl: string;
  width: number;
  height: number;
}

export interface OcrStageProduct {
  id: string;
  name: string;
  sku: string;
  secondaryCode: string | null;
  price: number;
  brand: string | null;
}

export interface OcrStageItem {
  id: string;
  rawText: string;
  matchedProduct: OcrStageProduct | null;
  quantity: number;
  confidence: number;
  confidenceLabel: MatchConfidence;
  coordinates: {
    top: string;
    left: string;
  };
  status: OcrStageStatus;
  source: MatchedItem;
}

export interface OcrStageRun {
  customerName: string | null;
  customerContext: OCROrderResult['customer_context'];
  items: OcrStageItem[];
  stats: OCROrderResult['stats'];
  startedAt: string;
}

export interface OcrRunSummary {
  id: string;
  customer: string;
  itemCount: number;
  status: string;
  timeLabel: string;
}
