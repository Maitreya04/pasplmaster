import type { ScanResult } from '../../types';

interface MatchableItem {
  item_name: string;
  item_alias: string | null;
}

export function buildScanResultFromMatch({
  rawText,
  matchResult,
  expectedItem,
}: {
  rawText: string;
  matchResult: {
    isMatch: boolean;
    confidence: number;
    matchedFields: string[];
    matchStrategy: string;
    ocrExtracted: {
      partNumber: string | null;
      mrp: number | null;
      brand?: string | null;
      vehicleModel?: string | null;
    };
    signals?: { signal: string; score: number; maxScore: number; detail: string }[];
  };
  expectedItem: MatchableItem;
}): ScanResult {
  return {
    scannedText: rawText,
    confidence: matchResult.confidence,
    isMatch: matchResult.isMatch,
    matchedAgainst:
      matchResult.matchedFields.join(', ') || expectedItem.item_alias || expectedItem.item_name,
    matchStrategy: matchResult.matchStrategy,
    ocrExtracted: {
      partNumber: matchResult.ocrExtracted.partNumber,
      mrp: matchResult.ocrExtracted.mrp,
      brand: matchResult.ocrExtracted.brand ?? null,
      vehicleModel: matchResult.ocrExtracted.vehicleModel ?? null,
    },
    signals: matchResult.signals,
    timestamp: new Date().toISOString(),
  };
}

