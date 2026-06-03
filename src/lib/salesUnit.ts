import type { OrderItem, SalesLineUnit } from '../types';

export const SALES_LINE_UNITS: readonly SalesLineUnit[] = ['pcs', 'kit', 'set'] as const;

const SALES_UNIT_LABELS: Record<SalesLineUnit, string> = {
  pcs: 'Pcs',
  kit: 'Kit',
  set: 'Set',
};

export function normalizeSalesLineUnit(value: unknown): SalesLineUnit {
  return value === 'kit' || value === 'set' || value === 'pcs' ? value : 'pcs';
}

export function salesLineUnitLabel(value: unknown): string {
  return SALES_UNIT_LABELS[normalizeSalesLineUnit(value)];
}

/** Order line unit with optional billing draft override (live queue / busy paste). */
export function effectiveSalesLineUnit(
  item: Pick<OrderItem, 'sales_unit'>,
  lineEdit?: { salesUnit?: SalesLineUnit } | null,
): SalesLineUnit {
  if (lineEdit?.salesUnit != null) return normalizeSalesLineUnit(lineEdit.salesUnit);
  return normalizeSalesLineUnit(item.sales_unit);
}
