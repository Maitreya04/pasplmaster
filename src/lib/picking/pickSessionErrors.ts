export function isPickNoLongerActiveError(error?: string | null): boolean {
  const normalized = (error ?? '').trim().toLowerCase();
  if (!normalized) return false;
  return (
    normalized === 'order_not_picking' ||
    normalized === 'not_picking' ||
    normalized === 'claim_lost' ||
    normalized === 'already_finalised' ||
    normalized.includes('no active picking claim')
  );
}

export function pickNoLongerActiveMessage(error?: string | null): string {
  const normalized = (error ?? '').trim().toLowerCase();
  if (normalized === 'already_finalised') {
    return 'This pick is already finalised.';
  }
  if (normalized === 'claim_lost' || normalized.includes('no active picking claim')) {
    return 'Your picking lock expired. Refreshing the queue.';
  }
  return 'This order is no longer active for picking. Refreshing the queue.';
}

export function pickMutationErrorMessage(
  error?: string | null,
  fallback = 'Could not complete action',
): string {
  if (!error) return fallback;
  if (isPickNoLongerActiveError(error)) return pickNoLongerActiveMessage(error);
  return error;
}

