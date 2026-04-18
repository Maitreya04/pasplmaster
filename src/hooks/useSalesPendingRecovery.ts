import { useEffect, useId, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase/client';
import type {
  PendingItem,
  PendingRecoveryResponse,
  WorkflowStatus,
} from '../types';
import { getStockTier, type StockTier } from '../lib/stockDisplay';

type PendingRecoveryOrderRow = {
  id: number;
  customer_city: string | null;
  salesperson_name: string | null;
  workflow_status: WorkflowStatus | null;
};

type ItemStockRow = {
  id: number;
  stock_qty: number | null;
  sales_price: number | null;
  alias1: string | null;
};

type OrderItemPricingRow = {
  order_id: number;
  item_id: number;
  price_quoted: number | null;
  price_system: number | null;
};

type CustomerContactRow = {
  id: number;
  mobile: string | null;
};

const SALESPERSON_ALIASES: Record<string, string> = {
  rajuji: 'raju',
  asadkhan: 'asad',
  manishsharma: 'manish',
  hardeepsingh: 'hardeep',
  anandawasthi: 'awasthi',
};

export type PendingRecoveryCoverageStatus = 'full' | 'partial' | 'none' | 'unknown';
export type PendingRecoveryPartyStage =
  | 'ready_to_contact'
  | 'waiting_for_customer'
  | 'ready_to_bill'
  | 'waiting_stock';

export interface SalesPendingRecoveryLine extends PendingItem {
  salesperson_name: string | null;
  order_workflow_status: WorkflowStatus | null;
  customer_city: string | null;
  customer_mobile: string | null;
  unit_price: number | null;
  stock_qty: number | null;
  stock_tier: StockTier;
  qty_available: number;
  coverage_status: PendingRecoveryCoverageStatus;
  is_contactable: boolean;
  is_waiting_stock: boolean;
  response_state: PendingRecoveryResponse | null;
  billable_now_value: number;
  total_pending_value: number;
  item_alias1: string | null;
}

export interface SalesPendingRecoveryParty {
  key: string;
  customer_id: number | null;
  customer_name: string;
  customer_mobile: string | null;
  customer_city: string | null;
  lines: SalesPendingRecoveryLine[];
  fullLines: SalesPendingRecoveryLine[];
  partialLines: SalesPendingRecoveryLine[];
  waitingLines: SalesPendingRecoveryLine[];
  confirmedLines: SalesPendingRecoveryLine[];
  stage: PendingRecoveryPartyStage;
  totalPendingQty: number;
  billableNowValue: number;
  confirmedValue: number;
  totalPendingValue: number;
  priorityValue: number;
}

function normalizeSalespersonKey(value: string | null | undefined): string {
  const normalized = (value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
  return SALESPERSON_ALIASES[normalized] ?? normalized;
}

function formatPendingRecoveryError(error: {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
}): Error {
  const haystack = [error.code, error.message, error.details, error.hint]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (
    haystack.includes('recovery_status') ||
    haystack.includes('contacted_at') ||
    haystack.includes('customer_response') ||
    haystack.includes('recovery_order_id')
  ) {
    return new Error(
      'Pending follow-up needs the latest database changes. Apply Supabase migrations 017 and 020.',
    );
  }

  const message = [error.code, error.message].filter(Boolean).join(': ');
  return new Error(message || 'Failed to load pending follow-up queue');
}

function deriveCoverageStatus(
  stockQty: number | null | undefined,
  qtyPending: number,
): {
  stockQty: number | null;
  stockTier: StockTier;
  qtyAvailable: number;
  coverageStatus: PendingRecoveryCoverageStatus;
  isContactable: boolean;
} {
  if (stockQty == null || !Number.isFinite(Number(stockQty))) {
    return {
      stockQty: null,
      stockTier: 'unknown',
      qtyAvailable: 0,
      coverageStatus: 'unknown',
      isContactable: false,
    };
  }

  const numericStock = Math.max(0, Math.floor(Number(stockQty)));
  const qtyAvailable = Math.min(numericStock, Math.max(qtyPending, 0));
  const stockTier = getStockTier(Number(stockQty));

  if (qtyAvailable <= 0) {
    return {
      stockQty: Number(stockQty),
      stockTier,
      qtyAvailable: 0,
      coverageStatus: 'none',
      isContactable: false,
    };
  }

  if (qtyAvailable >= qtyPending) {
    return {
      stockQty: Number(stockQty),
      stockTier,
      qtyAvailable,
      coverageStatus: 'full',
      isContactable: true,
    };
  }

  return {
    stockQty: Number(stockQty),
    stockTier,
    qtyAvailable,
    coverageStatus: 'partial',
    isContactable: true,
  };
}

function normalizePendingItem(
  row: PendingItem,
  order: PendingRecoveryOrderRow | undefined,
  customerMobile: string | null,
  stockQty: number | null,
  unitPrice: number | null,
  fallbackSalesPrice: number | null,
  alias1: string | null,
): SalesPendingRecoveryLine {
  const stock = deriveCoverageStatus(stockQty, row.qty_pending);
  const normalizedPriceSource =
    typeof unitPrice === 'number' && Number.isFinite(unitPrice) && unitPrice > 0
      ? unitPrice
      : typeof fallbackSalesPrice === 'number' &&
          Number.isFinite(fallbackSalesPrice) &&
          fallbackSalesPrice > 0
        ? fallbackSalesPrice
        : null;
  const normalizedPrice = normalizedPriceSource != null ? Number(normalizedPriceSource) : null;
  const billableNowValue = normalizedPrice != null ? normalizedPrice * stock.qtyAvailable : 0;
  const totalPendingValue = normalizedPrice != null ? normalizedPrice * row.qty_pending : 0;

  return {
    ...row,
    salesperson_name: order?.salesperson_name ?? null,
    order_workflow_status: order?.workflow_status ?? null,
    customer_city: order?.customer_city ?? null,
    customer_mobile: customerMobile,
    unit_price: normalizedPrice,
    stock_qty: stock.stockQty,
    stock_tier: stock.stockTier,
    qty_available: stock.qtyAvailable,
    coverage_status: stock.coverageStatus,
    is_contactable: stock.isContactable,
    is_waiting_stock: !stock.isContactable,
    response_state: row.customer_response ?? null,
    billable_now_value: billableNowValue,
    total_pending_value: totalPendingValue,
    item_alias1: alias1,
  };
}

function derivePartyStage(lines: SalesPendingRecoveryLine[]): PendingRecoveryPartyStage {
  const actionable = lines.filter((line) => line.is_contactable);
  if (actionable.some((line) => line.response_state === 'confirmed')) {
    return 'ready_to_bill';
  }
  if (actionable.some((line) => !line.contacted_at)) {
    return 'ready_to_contact';
  }
  if (actionable.length > 0) {
    return 'waiting_for_customer';
  }
  return 'waiting_stock';
}

function buildParty(lines: SalesPendingRecoveryLine[]): SalesPendingRecoveryParty {
  const sortedLines = [...lines].sort((a, b) => {
    const coverageRank = (line: SalesPendingRecoveryLine): number => {
      if (line.response_state === 'confirmed') return 0;
      if (line.coverage_status === 'full') return 1;
      if (line.coverage_status === 'partial') return 2;
      return 3;
    };
    const rankDiff = coverageRank(a) - coverageRank(b);
    if (rankDiff !== 0) return rankDiff;
    const valueDiff = b.billable_now_value - a.billable_now_value;
    if (valueDiff !== 0) return valueDiff;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  const fullLines = sortedLines.filter((line) => line.coverage_status === 'full');
  const partialLines = sortedLines.filter((line) => line.coverage_status === 'partial');
  const waitingLines = sortedLines.filter(
    (line) => !['full', 'partial'].includes(line.coverage_status),
  );
  const confirmedLines = sortedLines.filter((line) => line.response_state === 'confirmed');
  const stage = derivePartyStage(sortedLines);
  const billableNowValue = sortedLines.reduce((sum, line) => sum + line.billable_now_value, 0);
  const confirmedValue = confirmedLines.reduce((sum, line) => sum + line.billable_now_value, 0);
  const totalPendingValue = sortedLines.reduce((sum, line) => sum + line.total_pending_value, 0);
  const priorityValue =
    stage === 'ready_to_bill'
      ? confirmedValue
      : stage === 'ready_to_contact' || stage === 'waiting_for_customer'
        ? billableNowValue
        : totalPendingValue;

  return {
    key: `${sortedLines[0]?.customer_id ?? 'none'}:${sortedLines[0]?.customer_name ?? 'party'}`,
    customer_id: sortedLines[0]?.customer_id ?? null,
    customer_name: sortedLines[0]?.customer_name ?? 'Party',
    customer_mobile: sortedLines[0]?.customer_mobile ?? null,
    customer_city: sortedLines[0]?.customer_city ?? null,
    lines: sortedLines,
    fullLines,
    partialLines,
    waitingLines,
    confirmedLines,
    stage,
    totalPendingQty: sortedLines.reduce((sum, line) => sum + line.qty_pending, 0),
    billableNowValue,
    confirmedValue,
    totalPendingValue,
    priorityValue,
  };
}

export function useSalesPendingRecovery(userName: string | null) {
  const queryClient = useQueryClient();
  const channelId = useId();

  const query = useQuery<SalesPendingRecoveryLine[]>({
    queryKey: ['sales-pending-recovery', userName ?? 'unknown'],
    queryFn: async () => {
      if (!userName) return [];

      const { data: pendingItems, error: pendingError } = await supabase
        .from('pending_items')
        .select('*')
        .eq('status', 'pending')
        .is('recovery_order_id', null)
        .order('created_at', { ascending: false })
        .returns<PendingItem[]>();

      if (pendingError) {
        throw formatPendingRecoveryError(pendingError);
      }

      if (!pendingItems?.length) {
        return [];
      }

      const orderIds = [...new Set(pendingItems.map((item) => item.order_id))];
      const customerIds = [
        ...new Set(
          pendingItems
            .map((item) => item.customer_id)
            .filter((id): id is number => typeof id === 'number'),
        ),
      ];
      const itemIds = [
        ...new Set(
          pendingItems
            .map((item) => item.item_id)
            .filter((id): id is number => typeof id === 'number'),
        ),
      ];

      const [
        { data: orders, error: ordersError },
        { data: customers, error: customersError },
        { data: items, error: itemsError },
        { data: orderItems, error: orderItemsError },
      ] = await Promise.all([
        supabase
          .from('orders')
          .select('id, customer_city, salesperson_name, workflow_status')
          .in('id', orderIds)
          .returns<PendingRecoveryOrderRow[]>(),
        customerIds.length > 0
          ? supabase
              .from('customers')
              .select('id, mobile')
              .in('id', customerIds)
              .returns<CustomerContactRow[]>()
          : Promise.resolve({ data: [], error: null }),
        itemIds.length > 0
          ? supabase
              .from('items')
              .select('id, stock_qty, sales_price, alias1')
              .in('id', itemIds)
              .returns<ItemStockRow[]>()
          : Promise.resolve({ data: [], error: null }),
        orderIds.length > 0 && itemIds.length > 0
          ? supabase
              .from('order_items')
              .select('order_id, item_id, price_quoted, price_system')
              .in('order_id', orderIds)
              .in('item_id', itemIds)
              .returns<OrderItemPricingRow[]>()
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (ordersError) throw formatPendingRecoveryError(ordersError);
      if (customersError) throw formatPendingRecoveryError(customersError);
      if (itemsError) throw formatPendingRecoveryError(itemsError);
      if (orderItemsError) throw formatPendingRecoveryError(orderItemsError);

      const userKey = normalizeSalespersonKey(userName);
      const ownedOrders = new Map(
        (orders ?? [])
          .filter((order) => normalizeSalespersonKey(order.salesperson_name) === userKey)
          .map((order) => [order.id, order] as const),
      );
      const customerMap = new Map((customers ?? []).map((customer) => [customer.id, customer.mobile]));
      const itemMap = new Map((items ?? []).map((item) => [item.id, item] as const));
      const orderItemPriceMap = new Map(
        (orderItems ?? []).map((item) => [
          `${item.order_id}:${item.item_id}`,
          item.price_quoted ?? item.price_system ?? null,
        ] as const),
      );

      return pendingItems
        .filter((item) => ownedOrders.has(item.order_id))
        .map((item) =>
          normalizePendingItem(
            item,
            ownedOrders.get(item.order_id),
            typeof item.customer_id === 'number' ? customerMap.get(item.customer_id) ?? null : null,
            typeof item.item_id === 'number' ? itemMap.get(item.item_id)?.stock_qty ?? null : null,
            typeof item.item_id === 'number'
              ? orderItemPriceMap.get(`${item.order_id}:${item.item_id}`) ?? null
              : null,
            typeof item.item_id === 'number' ? itemMap.get(item.item_id)?.sales_price ?? null : null,
            typeof item.item_id === 'number' ? itemMap.get(item.item_id)?.alias1 ?? null : null,
          ),
        );
    },
    enabled: !!userName,
    staleTime: 0,
    refetchInterval: 30000,
  });

  const parties = useMemo(() => {
    const buckets = new Map<string, SalesPendingRecoveryLine[]>();
    for (const line of query.data ?? []) {
      const key = `${line.customer_id ?? 'none'}:${line.customer_name}`;
      const bucket = buckets.get(key) ?? [];
      bucket.push(line);
      buckets.set(key, bucket);
    }

    return [...buckets.values()]
      .map((lines) => buildParty(lines))
      .sort((a, b) => {
        const stageRank = (party: SalesPendingRecoveryParty): number => {
          switch (party.stage) {
            case 'ready_to_bill':
              return 0;
            case 'ready_to_contact':
              return 1;
            case 'waiting_for_customer':
              return 2;
            default:
              return 3;
          }
        };
        const rankDiff = stageRank(a) - stageRank(b);
        if (rankDiff !== 0) return rankDiff;
        const valueDiff = b.priorityValue - a.priorityValue;
        if (valueDiff !== 0) return valueDiff;
        return a.customer_name.localeCompare(b.customer_name);
      });
  }, [query.data]);

  return {
    ...query,
    data: query.data ?? [],
    parties,
  };
}
