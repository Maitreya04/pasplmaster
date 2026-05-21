import type { ScanCatalogItem, ScanMatchSource } from '../../stores/itemScanIndex';
import type { UomTier } from './uomMapper';

export interface LiveQrScannerPickItem {
  itemId: number;
  name: string;
  alias1?: string | null;
  alias?: string | null;
  itemCode?: string | null;
  busyCode?: number | null;
  /** Busy catalog groups — used for OEM label hints (e.g. TAFE). */
  mainGroup?: string | null;
  parentGroup?: string | null;
}

export interface LiveQrScannerResolved {
  rawValue: string;
  matchedItem: ScanCatalogItem | null;
  matchedBy: ScanMatchSource | null;
  matchesPickItem: boolean;
  reason: string;
  lookupCode: string | null;
  codeType: 'rack' | 'pack' | 'lpn' | 'sku' | 'unknown';
  suggestedQty: number;
  requiresBreakConfirmation: boolean;
  lpnCode?: string | null;
  uomTier: UomTier | null;
  baseQtyEa: number | null;
  packetQtyEa: number | null;
  packetsPerBox: number | null;
  uomSource: string | null;
}
