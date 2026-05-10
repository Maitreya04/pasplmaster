/**
 * Detect ASK-branded catalog lines for queue badges and previews.
 * Uses Busy-style `items.main_group` / `parent_group` when present, else invoice line name.
 */
export function isAskLine(input: {
  item_name?: string | null;
  main_group?: string | null;
  parent_group?: string | null;
}): boolean {
  const u = (s: string | null | undefined) => s?.trim().toUpperCase() ?? '';
  if (u(input.main_group) === 'ASK' || u(input.parent_group) === 'ASK') return true;
  const name = input.item_name?.trim() ?? '';
  if (!name) return false;
  const nu = name.toUpperCase();
  if (nu === 'ASK' || nu.startsWith('ASK ') || nu.startsWith('ASK-')) return true;
  return /\bASK\b/.test(name);
}
