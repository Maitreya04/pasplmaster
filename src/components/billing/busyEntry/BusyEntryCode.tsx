import type { OrderItem } from '../../../types';
import { orderItemAlias1Code } from '../../../utils/formatters';

export function busyEntryAlias1(item: OrderItem): string {
  return orderItemAlias1Code(item);
}

interface BusyEntryCodeProps {
  item: OrderItem;
  muted?: boolean;
}

/** Alias 1 for busy entry — never truncated; see `.busy-entry-code` in index.css */
export function BusyEntryCode({ item, muted = false }: BusyEntryCodeProps): React.JSX.Element {
  const code = busyEntryAlias1(item);
  const display = code || '—';

  return (
    <span
      className={`busy-entry-code ${muted ? 'busy-entry-code--muted' : ''}`}
      title={code || undefined}
    >
      {display}
    </span>
  );
}

/** List/overlay row grid: alias shrink-wraps, description takes remainder. */
export const BUSY_ENTRY_LIST_GRID =
  'grid grid-cols-[auto_minmax(0,1fr)_auto] gap-x-3 items-center';
