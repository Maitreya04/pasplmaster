export type OfflineLeaseWarningLevel = 'ok' | 'soon' | 'urgent' | 'expired';

const WARN_SOON_MS = 15 * 60 * 1000;
const WARN_URGENT_MS = 5 * 60 * 1000;

export function getOfflineLeaseRemainingMs(expiresAtIso: string | null | undefined): number | null {
  if (!expiresAtIso) return null;
  const expiresAt = new Date(expiresAtIso).getTime();
  if (Number.isNaN(expiresAt)) return null;
  return expiresAt - Date.now();
}

export function getOfflineLeaseWarningLevel(
  expiresAtIso: string | null | undefined,
): OfflineLeaseWarningLevel {
  const remaining = getOfflineLeaseRemainingMs(expiresAtIso);
  if (remaining == null) return 'ok';
  if (remaining <= 0) return 'expired';
  if (remaining <= WARN_URGENT_MS) return 'urgent';
  if (remaining <= WARN_SOON_MS) return 'soon';
  return 'ok';
}

export function formatOfflineLeaseRemaining(expiresAtIso: string | null | undefined): string | null {
  const remaining = getOfflineLeaseRemainingMs(expiresAtIso);
  if (remaining == null) return null;
  if (remaining <= 0) return 'Lease expired';
  const totalMinutes = Math.ceil(remaining / 60_000);
  if (totalMinutes < 60) return `${totalMinutes}m left`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours}h ${minutes}m left` : `${hours}h left`;
}
