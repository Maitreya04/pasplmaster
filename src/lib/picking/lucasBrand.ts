/**
 * Detect Lucas-branded catalog lines for queue badges and previews.
 * Uses Busy `items.main_group` / `parent_group` when present, else invoice line name.
 */
export function isLucasLine(input: {
  item_name?: string | null;
  main_group?: string | null;
  parent_group?: string | null;
}): boolean {
  const u = (s: string | null | undefined) => s?.trim().toUpperCase() ?? '';
  const mg = u(input.main_group);
  const pg = u(input.parent_group);
  if (mg === 'LUCAS' || pg === 'LUCAS') return true;
  if (mg.startsWith('LUCAS ') || pg.startsWith('LUCAS ')) return true;
  if (mg.includes('LUCAS') || pg.includes('LUCAS')) return true;

  const name = input.item_name?.trim() ?? '';
  if (!name) return false;
  const nu = name.toUpperCase();
  if (nu.startsWith('LC ') || nu.startsWith('LC-')) return true;
  if (/\bLUCAS\b/.test(nu)) return true;
  return false;
}
