import type { OrderItem, SalesLineUnit } from '../types';

export const SALES_LINE_UNITS: readonly SalesLineUnit[] = ['pcs', 'kit', 'set'] as const;

/** Units sales can explicitly pick; default (pcs) is omitted so Busy auto-selects. */
export const SALES_SELECTABLE_UNITS = ['kit', 'set'] as const satisfies readonly SalesLineUnit[];

const SALES_UNIT_LABELS: Record<SalesLineUnit, string> = {
  pcs: 'Pcs',
  kit: 'Kit',
  set: 'Set',
};

export function normalizeSalesLineUnit(value: unknown): SalesLineUnit {
  return value === 'kit' || value === 'set' || value === 'pcs' ? value : 'pcs';
}

export function isExplicitSalesLineUnit(value: unknown): value is 'kit' | 'set' {
  return value === 'kit' || value === 'set';
}

export function salesLineUnitLabel(value: unknown): string {
  return SALES_UNIT_LABELS[normalizeSalesLineUnit(value)];
}

/** Busy paste / qty suffix — empty when default (pcs) so Busy auto-selects unit. */
export function busyPasteUnitLabel(value: unknown): string {
  const unit = normalizeSalesLineUnit(value);
  return isExplicitSalesLineUnit(unit) ? SALES_UNIT_LABELS[unit] : '';
}

/** Qty display suffix with leading space, e.g. " Kit" or "". */
export function salesLineUnitSuffix(value: unknown): string {
  const label = busyPasteUnitLabel(value);
  return label ? ` ${label}` : '';
}

/** Order line unit with optional billing draft override (live queue / busy paste). */
export function effectiveSalesLineUnit(
  item: Pick<OrderItem, 'sales_unit'>,
  lineEdit?: { salesUnit?: SalesLineUnit } | null,
): SalesLineUnit {
  if (lineEdit?.salesUnit != null) return normalizeSalesLineUnit(lineEdit.salesUnit);
  return normalizeSalesLineUnit(item.sales_unit);
}
