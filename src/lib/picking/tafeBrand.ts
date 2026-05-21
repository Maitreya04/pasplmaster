/**
 * Detect TAFE-branded catalog lines (Tractors and Farm Equipment).
 * Used for OEM multi-barcode pick hints and scanner prioritization.
 */
export function isTafeLine(input: {
  item_name?: string | null;
  main_group?: string | null;
  parent_group?: string | null;
}): boolean {
  const u = (s: string | null | undefined) => s?.trim().toUpperCase() ?? '';
  const mg = u(input.main_group);
  const pg = u(input.parent_group);
  if (mg === 'TAFE' || pg === 'TAFE') return true;
  if (mg.includes('TAFE') || pg.includes('TAFE')) return true;

  const name = input.item_name?.trim() ?? '';
  if (!name) return false;
  return /\bTAFE\b/i.test(name);
}
