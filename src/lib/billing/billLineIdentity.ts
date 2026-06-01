import type { OrderItem } from '../../types';
import { orderItemAlternateCode, orderItemAlias1Code, orderItemPickCode } from '../../utils/itemCodes';
import { orderItemDisplayName } from '../../utils/formatters';

export type BillLineIdentity = {
  /** Fallback pick code (alias1 → alias → snapshot). */
  pickCode: string;
  /** Catalog alias1 only — busy entry / typing into Busy. */
  alias1Code: string;
  altCode: string | null;
  description: string;
};

/** Pick code (alias1), optional alt alias, and stripped description — matches New Order. */
export function billLineIdentity(item: OrderItem): BillLineIdentity {
  return {
    pickCode: orderItemPickCode(item),
    alias1Code: orderItemAlias1Code(item),
    altCode: orderItemAlternateCode(item),
    description: orderItemDisplayName(item),
  };
}
