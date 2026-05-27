import { normalizeEmbeddedItem, type OpenPoDemandLine } from '../../hooks/useOpenPoDemandLines';

export function demandLineBrandKey(line: OpenPoDemandLine): string {
  const it = normalizeEmbeddedItem(line.items);
  const g = it?.main_group?.trim();
  if (g) return g;
  const p = it?.parent_group?.trim();
  if (p) return p;
  return 'Ungrouped';
}

export function normalizeBrandKey(value: string): string {
  return value.trim().toUpperCase();
}

export function matchesPartnerBrand(
  line: OpenPoDemandLine,
  brandKeys: string[] | undefined,
): boolean {
  if (!brandKeys?.length) return true;
  const allowed = new Set(brandKeys.map(normalizeBrandKey));
  const it = normalizeEmbeddedItem(line.items);
  const main = it?.main_group?.trim();
  const parent = it?.parent_group?.trim();
  if (main && allowed.has(normalizeBrandKey(main))) return true;
  if (parent && allowed.has(normalizeBrandKey(parent))) return true;
  return false;
}

export function matchesPartnerBrandGroups(
  mainGroup: string | null | undefined,
  parentGroup: string | null | undefined,
  brandKeys: string[] | undefined,
): boolean {
  if (!brandKeys?.length) return true;
  const allowed = new Set(brandKeys.map(normalizeBrandKey));
  const main = mainGroup?.trim();
  const parent = parentGroup?.trim();
  if (main && allowed.has(normalizeBrandKey(main))) return true;
  if (parent && allowed.has(normalizeBrandKey(parent))) return true;
  return false;
}
