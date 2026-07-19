export function normalizeSalesTargetProductGroup(name: string): string {
  const trimmed = name.trim().replace(/\s*\(\d+(?:\.\d+)?\)\s*$/, '').trim();
  const upper = trimmed.toUpperCase();
  // Preserve detailed U3/U4 target rows. Different salespeople can target a
  // specific Busy ItemmainGrp or the broader USHA 3W/4W family, and collapsing
  // these labels destroys the distinction needed by the database mapper.
  // Busy does not split these cable sales by vehicle type.
  if (/^SJ\.CABLES\s+(?:2W|3W|4W)$/i.test(trimmed)) return 'SJ.CABLES';
  if (upper === 'G. VALVES') return 'G.Val';
  return trimmed;
}
