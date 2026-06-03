import type { BusyEntryLineNature } from '../../../lib/billing/busyEntryLineNature';
import { getBookPrice, getQuotedPrice, isSpecialRateItem } from '../../../lib/specialPricing';
import { formatCurrencyRaw } from '../../../utils/formatters';
import type { OrderItem } from '../../../types';

function formatRate(rate: number | null): string {
  return rate == null ? '—' : formatCurrencyRaw(rate);
}

function resolveBilledRate(
  item: OrderItem,
  edit?: { priceQuoted?: number | null },
): number | null {
  if (typeof edit?.priceQuoted === 'number' && Number.isFinite(edit.priceQuoted)) {
    return edit.priceQuoted;
  }
  return getQuotedPrice(item);
}

interface BusyEntryRateCellProps {
  item: OrderItem;
  edit?: { priceQuoted?: number | null };
  nature?: BusyEntryLineNature;
}

export function BusyEntryRateCell({
  item,
  edit,
  nature,
}: BusyEntryRateCellProps): React.JSX.Element {
  const billedRate = resolveBilledRate(item, edit);
  const bookRate = getBookPrice(item);
  const isSpecial = nature === 'special_rate' || isSpecialRateItem(item);
  const showBook = bookRate != null && billedRate != null && bookRate !== billedRate;

  return (
    <span className="block text-right">
      {isSpecial && showBook ? <span className="busy-entry-rate-label">Special</span> : null}
      <span
        className={`busy-entry-rate-value ${
          isSpecial && showBook ? 'text-[var(--content-accent)]' : 'text-[var(--content-primary)]'
        }`}
      >
        {formatRate(billedRate)}
      </span>
      {showBook ? (
        <span className="busy-entry-rate-book">
          Book{' '}
          <span className="line-through decoration-[var(--content-quaternary)]">
            {formatRate(bookRate)}
          </span>
        </span>
      ) : null}
    </span>
  );
}
