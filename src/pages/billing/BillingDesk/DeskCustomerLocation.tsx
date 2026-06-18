import type { DeskOrderRow } from '../../../hooks/useBillingDeskOrders';
import { deskType } from './deskTypography';

type DeskCustomerLocationProps = {
  order: Pick<DeskOrderRow, 'customer_city' | 'customer_address'>;
  className?: string;
};

export function DeskCustomerLocation({
  order,
  className = '',
}: DeskCustomerLocationProps): React.JSX.Element | null {
  const station = order.customer_city?.trim() ?? '';
  const address = order.customer_address?.trim() ?? '';
  if (!station && !address) return null;

  return (
    <p className={`${deskType.orderDetail} mt-0.5 line-clamp-2 ${className}`.trim()}>
      {station ? (
        <span className="font-medium text-[var(--content-secondary)]">{station}</span>
      ) : null}
      {station && address ? (
        <span className="px-1 text-[var(--content-quaternary)]">·</span>
      ) : null}
      {address ? <span>{address}</span> : null}
    </p>
  );
}
