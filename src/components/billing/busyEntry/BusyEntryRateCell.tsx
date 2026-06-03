import type { BusyEntryLineNature } from '../../../lib/billing/busyEntryLineNature';
import { getBookPrice, getQuotedPrice, isSpecialRateItem } from '../../../lib/specialPricing';
import { BillingFigure } from '../shared/BillingFigure';
import type { OrderItem } from '../../../types';

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
      {billedRate == null ? (
        <span className="busy-entry-rate-value text-[var(--content-tertiary)]">—</span>
      ) : (
        <BillingFigure
          value={billedRate}
          kind="currency-raw"
          size="inherit"
          className={`busy-entry-rate-value ${
            isSpecial && showBook ? 'text-[var(--content-accent)]' : 'text-[var(--content-primary)]'
          }`}
        />
      )}
      {showBook && bookRate != null ? (
        <span className="busy-entry-rate-book">
          Book{' '}
          <BillingFigure
            value={bookRate}
            kind="currency-raw"
            size="xs"
            className="line-through decoration-[var(--content-quaternary)]"
          />
        </span>
      ) : null}
    </span>
  );
}
