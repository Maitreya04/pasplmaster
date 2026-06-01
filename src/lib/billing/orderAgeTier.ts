export type OrderAgeTier = 'fresh' | 'warning' | 'critical';

export interface OrderAgePill {
  show: true;
  tier: OrderAgeTier;
  label: string;
}

const THIRTY_MIN_MS = 30 * 60_000;
const FOUR_HOURS_MS = 4 * 3_600_000;

export function orderAgePill(dateStr: string, nowMs = Date.now()): OrderAgePill | null {
  const diffMs = nowMs - new Date(dateStr).getTime();

  if (diffMs < THIRTY_MIN_MS) {
    return null;
  }

  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMs < 3_600_000) {
    return { show: true, tier: 'warning', label: `${diffMins} min` };
  }

  if (diffMs < FOUR_HOURS_MS) {
    return { show: true, tier: 'warning', label: `${diffHours}h ago` };
  }

  if (diffMs < 86_400_000) {
    return { show: true, tier: 'critical', label: `${diffHours}h ago` };
  }

  return { show: true, tier: 'critical', label: `${diffDays}d ago` };
}

/** @deprecated use orderAgePill — kept for queue list rows that still use tier labels */
export function orderAgeTier(
  dateStr: string,
  nowMs = Date.now(),
): { label: string; tier: OrderAgeTier | 'fresh' } {
  const pill = orderAgePill(dateStr, nowMs);
  if (!pill) {
    return { label: '', tier: 'fresh' };
  }
  return { label: pill.label, tier: pill.tier };
}

export function isOrderAgeUrgent(dateStr: string, nowMs = Date.now()): boolean {
  const pill = orderAgePill(dateStr, nowMs);
  return pill?.tier === 'critical';
}

export function customerNameSizeClass(name: string): string {
  if (name.length <= 20) return 'font-ds-lead';
  if (name.length <= 32) return 'font-ds-body-size';
  return 'font-ds-prose';
}
