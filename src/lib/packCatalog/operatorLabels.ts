import type { ItemPackDefinition } from '../../types';

export type SellUnit = 'EACH' | 'PACK' | 'BOTH';

export type PackCatalogStatus = 'ready' | 'incomplete' | 'no_rack';

export function parseIndividualColumn(raw: unknown): SellUnit {
  const s = String(raw ?? '').trim().toLowerCase();
  if (s === '1' || s === 'y' || s === 'yes') return 'BOTH';
  if (s === '0' || s === 'n' || s === 'no') return 'PACK';
  return 'EACH';
}

export function sellUnitDisplay(sellUnit: SellUnit | string | null | undefined): string {
  switch (sellUnit) {
    case 'PACK':
      return 'Cartons only';
    case 'BOTH':
      return 'Loose or carton';
    case 'EACH':
    default:
      return 'Loose OK';
  }
}

export function sellUnitFromRadio(label: string): SellUnit {
  if (label === 'Cartons only') return 'PACK';
  if (label === 'Loose or carton') return 'BOTH';
  return 'EACH';
}

export const INDIVIDUAL_RADIO_OPTIONS = [
  'Loose OK',
  'Cartons only',
  'Loose or carton',
] as const;

export function packCatalogStatus(
  def: ItemPackDefinition | undefined,
  rackNo: string | null | undefined,
): PackCatalogStatus {
  const outer = def?.outer_pack_qty;
  const inner = def?.inner_pack_qty;
  const hasPack = (outer != null && outer >= 1) || (inner != null && inner >= 1);
  if (!hasPack) return 'incomplete';
  if (!rackNo?.trim()) return 'no_rack';
  return 'ready';
}

export function statusBadgeLabel(status: PackCatalogStatus): string {
  switch (status) {
    case 'ready':
      return 'Ready';
    case 'incomplete':
      return 'Incomplete';
    case 'no_rack':
      return 'No rack';
  }
}
