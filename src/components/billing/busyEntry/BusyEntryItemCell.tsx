import type { ReactNode } from 'react';
import type { OrderItem } from '../../../types';
import { orderItemReadableName } from '../../../utils/formatters';
import { BusyEntryCode } from './BusyEntryCode';

interface BusyEntryItemCellProps {
  item: OrderItem;
  brandName?: string | null;
  isSplitSibling?: boolean;
  muted?: boolean;
  chips?: ReactNode;
}

/** Part code + brand + description — one flexible column for desk scaling. */
export function BusyEntryItemCell({
  item,
  brandName,
  isSplitSibling = false,
  muted = false,
  chips,
}: BusyEntryItemCellProps): React.JSX.Element {
  const name = orderItemReadableName(item);

  return (
    <div className={`busy-entry-item min-w-0${muted ? ' busy-entry-item--muted' : ''}`}>
      <div className="busy-entry-item__identity">
        <BusyEntryCode item={item} muted={muted} />
        {brandName ? <span className="busy-entry-brand">{brandName}</span> : null}
      </div>
      <p className="busy-entry-desc" title={name}>
        {isSplitSibling ? '↳ ' : ''}
        {name}
      </p>
      {chips}
    </div>
  );
}
