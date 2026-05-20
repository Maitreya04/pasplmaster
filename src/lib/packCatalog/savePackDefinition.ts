import { supabase } from '../supabase/client';
import type { SellUnit } from './operatorLabels';

export interface SavePackDefinitionInput {
  busyCode: number;
  itemId: number;
  itemName: string;
  innerPackQty: number | null;
  outerPackQty: number | null;
  sellUnit: SellUnit;
}

export async function savePackDefinition(input: SavePackDefinitionInput): Promise<void> {
  const { error } = await supabase.rpc('upsert_item_pack_definitions', {
    p_rows: [
      {
        busy_code: input.busyCode,
        item_id: input.itemId,
        item_name: input.itemName,
        inner_pack_qty: input.innerPackQty,
        outer_pack_qty: input.outerPackQty,
        sell_unit: input.sellUnit,
      },
    ],
    p_source_file: 'pack_catalog',
  });
  if (error) throw error;
}

/** Update only outer/inner from table inline edit; keeps existing sell_unit. */
export async function quickSavePackQty(
  row: {
    busyCode: number;
    itemId: number;
    itemName: string;
    outerQty: number | null;
    innerQty: number | null;
    sellUnit: SellUnit;
  },
  field: 'outer' | 'inner',
  value: number | null,
): Promise<void> {
  const outer = field === 'outer' ? value : row.outerQty;
  const inner = field === 'inner' ? value : row.innerQty;
  const err = validatePackQtys(inner, outer);
  if (err) throw new Error(err);
  await savePackDefinition({
    busyCode: row.busyCode,
    itemId: row.itemId,
    itemName: row.itemName,
    innerPackQty: inner,
    outerPackQty: outer,
    sellUnit: row.sellUnit,
  });
}

export function validatePackQtys(
  inner: number | null,
  outer: number | null,
): string | null {
  if (inner != null && inner < 1) return 'Inner box must be at least 1 piece.';
  if (outer != null && outer < 1) return 'Outer box must be at least 1 piece.';
  if (inner != null && outer != null && inner > 1 && outer % inner !== 0) {
    return `Outer (${outer}) must divide evenly by inner (${inner}).`;
  }
  if (inner == null && outer == null) return 'Set at least outer or inner box size.';
  return null;
}
