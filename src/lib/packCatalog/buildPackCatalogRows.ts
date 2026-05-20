import type { Item, ItemPackDefinition } from '../../types';
import { itemGroupLabel, itemPickCode } from '../../utils/itemCodes';
import { derivePackFromCatalog } from './derivePackHint';
import { packCatalogStatus, type PackCatalogStatus } from './operatorLabels';

export interface PackCatalogRow {
  item: Item;
  busyCode: number | null;
  alias1Display: string;
  pickCode: string;
  brand: string;
  packDef: ItemPackDefinition | undefined;
  structure: string | null;
  status: PackCatalogStatus;
  outerQty: number | null;
  innerQty: number | null;
  sellUnit: ItemPackDefinition['sell_unit'];
  sourceFile: string | null;
}

export function buildPackCatalogRows(
  items: Item[],
  packDefs: ItemPackDefinition[],
): PackCatalogRow[] {
  const byBusy = new Map<number, ItemPackDefinition>();
  for (const def of packDefs) {
    byBusy.set(Number(def.busy_code), def);
  }

  return items
    .filter((item) => item.is_active !== false)
    .map((item) => {
      const busyCode = item.busy_code != null ? Number(item.busy_code) : null;
      const packDef = busyCode != null ? byBusy.get(busyCode) : undefined;
      const hint = derivePackFromCatalog(packDef);
      const alias1 = item.alias1?.trim() ?? '';
      const pickCode = itemPickCode(item);

      return {
        item,
        busyCode,
        alias1Display: alias1 || pickCode || '—',
        pickCode,
        brand: itemGroupLabel(item),
        packDef,
        structure: hint.label,
        status: packCatalogStatus(packDef, item.rack_no),
        outerQty: packDef?.outer_pack_qty ?? null,
        innerQty: packDef?.inner_pack_qty ?? null,
        sellUnit: packDef?.sell_unit ?? 'EACH',
        sourceFile: packDef?.source_file ?? null,
      };
    });
}

export function uniqueBrands(rows: PackCatalogRow[]): string[] {
  const set = new Set<string>();
  for (const row of rows) set.add(row.brand);
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}
