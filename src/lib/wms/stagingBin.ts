/** Default holding location for received stock before a SKU has a permanent rack/bin. */
export const STAGING_BIN_DEFAULT = 'STG-DEFAULT';

const STAGING_PREFIX = 'STG-';

export function isStagingBinId(binId: string | null | undefined): boolean {
  const norm = (binId ?? '').trim().toUpperCase();
  return norm === STAGING_BIN_DEFAULT || norm.startsWith(STAGING_PREFIX);
}

/** Prefer catalog rack; otherwise staging for putaway. */
export function defaultPutawayBinId(rackNo: string | null | undefined): string {
  const rack = (rackNo ?? '').trim().toUpperCase();
  if (rack && !rack.startsWith('OVF-')) return rack;
  return STAGING_BIN_DEFAULT;
}
