const KEY_PREFIX = 'billing-busy-entered-v1';

function storageKey(orderId: number): string {
  return `${KEY_PREFIX}:${orderId}`;
}

export function readBusyEnteredIds(orderId: number): Set<number> {
  try {
    const raw = sessionStorage.getItem(storageKey(orderId));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is number => typeof id === 'number'));
  } catch {
    return new Set();
  }
}

export function writeBusyEnteredIds(orderId: number, ids: Set<number>): void {
  try {
    sessionStorage.setItem(storageKey(orderId), JSON.stringify([...ids]));
  } catch {
    /* ignore quota */
  }
}

export function toggleBusyEnteredId(orderId: number, lineId: number): Set<number> {
  const next = readBusyEnteredIds(orderId);
  if (next.has(lineId)) next.delete(lineId);
  else next.add(lineId);
  writeBusyEnteredIds(orderId, next);
  return next;
}

/** Explicit operator confirmation — not triggered by copy alone. */
export function markBusyEnteredIds(orderId: number, lineIds: readonly number[]): Set<number> {
  const next = readBusyEnteredIds(orderId);
  for (const id of lineIds) next.add(id);
  writeBusyEnteredIds(orderId, next);
  return next;
}

export function clearBusyEnteredIds(orderId: number): void {
  try {
    sessionStorage.removeItem(storageKey(orderId));
  } catch {
    /* ignore */
  }
}
