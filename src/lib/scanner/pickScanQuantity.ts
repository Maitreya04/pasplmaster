import type { ItemPackDefinition, LicensePlatePackType } from '../../types';
import { parsePackPickPayload } from './qrPayload';

export interface PickScanQuantityResult {
  scanKind: 'sku' | 'pack' | 'unknown';
  packType: LicensePlatePackType | null;
  /** Pieces per carton from catalog (outer/inner) or 1 for piece scan */
  packQty: number | null;
  tierLabel: string | null;
  qtyAdded: number;
  targetQty: number;
  totalBefore: number;
  totalAfter: number;
  remainingBefore: number;
  remainingAfter: number;
  requiresBreakConfirmation: boolean;
}

function packQtyForType(
  definition: ItemPackDefinition | null | undefined,
  packType: LicensePlatePackType,
): number | null {
  return packType === 'inner'
    ? definition?.inner_pack_qty ?? null
    : definition?.outer_pack_qty ?? null;
}

function tierLabelForPackType(packType: LicensePlatePackType): string {
  return packType === 'inner' ? 'Inner box' : 'Outer box';
}

export function computePickScanQuantity(args: {
  rawValue: string;
  isMatch: boolean;
  busyCode: number | null;
  targetQty: number;
  totalBefore: number;
  packDefinition: ItemPackDefinition | null | undefined;
  resolvedEa?: number | null;
}): PickScanQuantityResult {
  const { rawValue, isMatch, busyCode, targetQty, totalBefore, packDefinition, resolvedEa } = args;
  const remainingBefore = Math.max(0, targetQty - totalBefore);
  const pack = parsePackPickPayload(rawValue);

  if (pack) {
    const catalogPackQty = packQtyForType(packDefinition, pack.packType);
    const effectivePackQty =
      resolvedEa != null && resolvedEa >= 1
        ? Math.floor(resolvedEa)
        : catalogPackQty;
    const packMatchesItem = busyCode != null && busyCode === pack.busyCode;
    const canAddPack =
      isMatch &&
      packMatchesItem &&
      effectivePackQty != null &&
      effectivePackQty >= 1 &&
      remainingBefore > 0;
    const requiresBreakConfirmation = Boolean(
      canAddPack && effectivePackQty != null && effectivePackQty > remainingBefore,
    );
    const qtyAdded =
      canAddPack && effectivePackQty != null && !requiresBreakConfirmation ? effectivePackQty : 0;
    const totalAfter = totalBefore + qtyAdded;

    return {
      scanKind: 'pack',
      packType: pack.packType,
      packQty: effectivePackQty,
      tierLabel: tierLabelForPackType(pack.packType),
      qtyAdded,
      targetQty,
      totalBefore,
      totalAfter,
      remainingBefore,
      remainingAfter: Math.max(0, targetQty - totalAfter),
      requiresBreakConfirmation,
    };
  }

  const qtyAdded = isMatch && remainingBefore > 0 ? 1 : 0;
  const totalAfter = totalBefore + qtyAdded;

  return {
    scanKind: isMatch ? 'sku' : 'unknown',
    packType: null,
    packQty: isMatch ? 1 : null,
    tierLabel: isMatch ? 'Individual' : null,
    qtyAdded,
    targetQty,
    totalBefore,
    totalAfter,
    remainingBefore,
    remainingAfter: Math.max(0, targetQty - totalAfter),
    requiresBreakConfirmation: false,
  };
}

export function partNoFromPickItem(item: {
  alias1?: string | null;
  alias?: string | null;
  pickCode?: string | null;
}): string {
  const a1 = item.alias1?.trim();
  if (a1) return a1;
  const alias = item.alias?.trim();
  if (alias) return alias;
  return item.pickCode?.trim() ?? '—';
}
