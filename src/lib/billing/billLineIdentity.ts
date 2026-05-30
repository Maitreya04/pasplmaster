import type { OrderItem } from '../../types';
import { orderItemAlternateCode, orderItemPickCode } from '../../utils/itemCodes';
import { orderItemDisplayName } from '../../utils/formatters';

export type BillLineIdentity = {
  pickCode: string;
  altCode: string | null;
  description: string;
};

/** Pick code (alias1), optional alt alias, and stripped description — matches New Order. */
export function billLineIdentity(item: OrderItem): BillLineIdentity {
  return {
    pickCode: orderItemPickCode(item),
    altCode: orderItemAlternateCode(item),
    description: orderItemDisplayName(item),
  };
}
