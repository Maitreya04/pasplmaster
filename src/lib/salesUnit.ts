import type { SalesLineUnit } from '../types';

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
