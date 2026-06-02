import { splitCartLinePaidFoc } from '../cartSupply';
import type { CartItem, Item, OrderItem, SalesSellingUnitDef } from '../../types';

export const IMPLICIT_SALES_UNIT_ID = 'unit';

/** Default when catalog has no `sales_selling_units` — all items get Kit / Set / Nos. */
export const DEFAULT_SALES_UNIT_ID = 'nos';

export const DEFAULT_SALES_SELLING_UNITS: SalesSellingUnitDef[] = [
  { id: 'kit', label: 'Kit', busy_unit: 'Kit', ea_multiplier: 1 },
  { id: 'set', label: 'Set', busy_unit: 'Set', ea_multiplier: 1 },
  { id: 'nos', label: 'Nos', busy_unit: 'Nos', ea_multiplier: 1 },
];

export function parseSalesSellingUnits(raw: unknown): SalesSellingUnitDef[] {
  if (!Array.isArray(raw)) return [];
  const out: SalesSellingUnitDef[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const id = String((row as SalesSellingUnitDef).id ?? '').trim();
    if (!id) continue;
    const label = String((row as SalesSellingUnitDef).label ?? id).trim() || id;
    const busyUnit = (row as SalesSellingUnitDef).busy_unit?.trim() || null;
    const multRaw = (row as SalesSellingUnitDef).ea_multiplier;
    const ea_multiplier =
      typeof multRaw === 'number' && Number.isFinite(multRaw) && multRaw > 0 ? multRaw : 1;
    out.push({ id, label, busy_unit: busyUnit, ea_multiplier });
  }
  return out;
}

/** Units offered for this item; empty catalog => Kit / Set / Nos for every SKU. */
export function salesUnitsForItem(item: Pick<Item, 'sales_selling_units'>): SalesSellingUnitDef[] {
  const parsed = parseSalesSellingUnits(item.sales_selling_units);
  if (parsed.length > 0) return parsed;
  return DEFAULT_SALES_SELLING_UNITS;
}

export function resolveSalesUnitDef(
  item: Pick<Item, 'sales_selling_units'>,
  unitId: string | null | undefined,
): SalesSellingUnitDef {
  const id = unitId?.trim() || IMPLICIT_SALES_UNIT_ID;
  const units = salesUnitsForItem(item);
  return units.find((u) => u.id === id) ?? units[0]!;
}

export function eaMultiplierForUnit(
  item: Pick<Item, 'sales_selling_units'>,
  unitId: string | null | undefined,
): number {
  return resolveSalesUnitDef(item, unitId).ea_multiplier;
}

export function qtyToEa(
  item: Pick<Item, 'sales_selling_units'>,
  qty: number,
  unitId: string | null | undefined,
): number {
  const q = Math.max(0, Math.floor(qty));
  if (q < 1) return 0;
  const mult = eaMultiplierForUnit(item, unitId);
  return Math.max(1, Math.ceil(q * mult));
}

export function stockQtyInSalesUnit(
  sellableEa: number | null | undefined,
  item: Pick<Item, 'sales_selling_units'>,
  unitId: string | null | undefined,
): number | null {
  if (sellableEa == null || !Number.isFinite(Number(sellableEa))) return null;
  const ea = Number(sellableEa);
  if (ea <= 0) return 0;
  const mult = eaMultiplierForUnit(item, unitId);
  return Math.floor(ea / mult);
}

export function allSalesUnitsOos(
  sellableEa: number | null | undefined,
  item: Pick<Item, 'sales_selling_units'>,
): boolean {
  const units = salesUnitsForItem(item);
  if (units.length === 0) return true;
  return units.every((u) => {
    const stock = stockQtyInSalesUnit(sellableEa, item, u.id);
    return stock == null || stock <= 0;
  });
}

/** Default unit on card open — Nos when offered, else the only explicit unit. */
export function autoSelectUnitId(item: Pick<Item, 'sales_selling_units'>): string {
  const units = salesUnitsForItem(item);
  const nos = units.find((u) => u.id === DEFAULT_SALES_UNIT_ID);
  if (nos) return nos.id;
  if (units.length === 1) return units[0]!.id;
  return units[0]!.id;
}

export function unitLabel(item: Pick<Item, 'sales_selling_units'>, unitId: string): string {
  return resolveSalesUnitDef(item, unitId).label;
}

export function busyPasteUnitLabel(
  orderItem: Pick<OrderItem, 'sales_selling_unit' | 'item_id'>,
  catalogItem?: Pick<Item, 'sales_selling_units'> | null,
): string {
  const unitId = orderItem.sales_selling_unit ?? IMPLICIT_SALES_UNIT_ID;
  if (!catalogItem) return '';
  const def = resolveSalesUnitDef(catalogItem, unitId);
  if (unitId === IMPLICIT_SALES_UNIT_ID && !def.busy_unit) return '';
  return def.busy_unit?.trim() ?? '';
}

export function doneBadgeText(qty: number, item: Pick<Item, 'sales_selling_units'>, unitId: string): string {
  const label = unitLabel(item, unitId).toLowerCase();
  return `${qty} × ${label} added`;
}

/** Paid + FOC quantity converted to EA for stock checks. */
export function cartLineEaPieces(ci: CartItem): number {
  const unit = ci.salesSellingUnit ?? IMPLICIT_SALES_UNIT_ID;
  const paidEa = ci.qty > 0 ? qtyToEa(ci.item, ci.qty, unit) : 0;
  const foc = Math.max(0, ci.focQty ?? 0);
  const focEa = foc > 0 ? qtyToEa(ci.item, foc, unit) : 0;
  return paidEa + focEa;
}

export function eaToSalesQty(
  item: Pick<Item, 'sales_selling_units'>,
  ea: number,
  unitId: string | null | undefined,
): number {
  const mult = eaMultiplierForUnit(item, unitId);
  if (ea <= 0 || mult <= 0) return 0;
  return Math.floor(ea / mult);
}

/** Stock split in sales units; deducts `shipEa` from location stock. */
export function splitCartLineInSalesUnits(
  ci: CartItem,
  stockQty: number | null | undefined,
): {
  ship: number;
  po: number;
  shippedPaid: number;
  shippedFoc: number;
  poPaid: number;
  poFoc: number;
  shipEa: number;
} {
  const unit = ci.salesSellingUnit ?? IMPLICIT_SALES_UNIT_ID;
  const paidEa = ci.qty > 0 ? qtyToEa(ci.item, ci.qty, unit) : 0;
  const focEa = (ci.focQty ?? 0) > 0 ? qtyToEa(ci.item, ci.focQty!, unit) : 0;
  const splitEa = splitCartLinePaidFoc(paidEa, focEa, stockQty);
  const toSales = (ea: number) => eaToSalesQty(ci.item, ea, unit);
  return {
    ship: toSales(splitEa.ship),
    po: toSales(splitEa.po),
    shippedPaid: toSales(splitEa.shippedPaid),
    shippedFoc: toSales(splitEa.shippedFoc),
    poPaid: toSales(splitEa.poPaid),
    poFoc: toSales(splitEa.poFoc),
    shipEa: splitEa.ship,
  };
}
