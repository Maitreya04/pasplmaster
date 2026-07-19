import { useMutation, useQueries, useQuery } from '@tanstack/react-query';
import {
  fetchCustomerCollectionSnapshot,
  fetchCustomerLedgerStatement,
  fetchCustomerOsBucket,
  fetchCustomerPaymentSignal,
  recordCustomerCollectionEvent,
  type AgingBucketFilter,
  type CollectionEventType,
  type CollectionSnapshot,
} from '../lib/receivables';

const CUSTOMER_SNAPSHOT_STALE_MS = 5 * 60 * 1000;
const CUSTOMER_DETAIL_STALE_MS = 5 * 60 * 1000;

export function useCustomerCollectionSnapshot(customerId: number) {
  return useQuery({
    queryKey: ['receivables', 'customer', customerId, 'snapshot'],
    queryFn: () => fetchCustomerCollectionSnapshot(customerId),
    enabled: Number.isFinite(customerId) && customerId > 0,
    staleTime: CUSTOMER_SNAPSHOT_STALE_MS,
    gcTime: 10 * 60 * 1000,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}

/** Parallel snapshots for the Your Customers rail — shares cache with single-id hook. */
export function useCustomerCollectionSnapshots(customerIds: number[]) {
  const uniqueIds = [...new Set(customerIds.filter((id) => Number.isFinite(id) && id > 0))];

  return useQueries({
    queries: uniqueIds.map((customerId) => ({
      queryKey: ['receivables', 'customer', customerId, 'snapshot'] as const,
      queryFn: () => fetchCustomerCollectionSnapshot(customerId),
      staleTime: CUSTOMER_SNAPSHOT_STALE_MS,
      gcTime: 10 * 60 * 1000,
      refetchOnReconnect: false,
      refetchOnWindowFocus: false,
      retry: 1 as const,
    })),
    combine: (results) => {
      const byId = new Map<number, CollectionSnapshot | undefined>();
      const loadingIds = new Set<number>();
      results.forEach((result, index) => {
        const id = uniqueIds[index];
        if (result.data) byId.set(id, result.data);
        else if (result.isPending) loadingIds.add(id);
      });
      return { byId, loadingIds };
    },
  });
}

export function useCustomerOsBucket(
  customerId: number,
  bucket: AgingBucketFilter,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ['receivables', 'customer', customerId, 'bucket', bucket],
    queryFn: () => fetchCustomerOsBucket(customerId, bucket),
    enabled: enabled && Number.isFinite(customerId) && customerId > 0,
    staleTime: CUSTOMER_DETAIL_STALE_MS,
    gcTime: 5 * 60 * 1000,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}

export function useCustomerLedgerStatement(params: {
  customerId: number;
  fromDate: string;
  toDate: string;
  enabled: boolean;
  limit?: number;
}) {
  return useQuery({
    queryKey: [
      'receivables',
      'customer',
      params.customerId,
      'ledger',
      params.fromDate,
      params.toDate,
      params.limit ?? 100,
    ],
    queryFn: () =>
      fetchCustomerLedgerStatement({
        customerId: params.customerId,
        fromDate: params.fromDate,
        toDate: params.toDate,
        limit: params.limit,
      }),
    enabled:
      params.enabled &&
      Number.isFinite(params.customerId) &&
      params.customerId > 0 &&
      Boolean(params.fromDate) &&
      Boolean(params.toDate),
    staleTime: CUSTOMER_DETAIL_STALE_MS,
    gcTime: 5 * 60 * 1000,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}

export function useCustomerPaymentSignal(params: {
  customerId: number;
  enabled?: boolean;
  windowDays?: number;
  limit?: number;
}) {
  return useQuery({
    queryKey: [
      'receivables',
      'customer',
      params.customerId,
      'payment-signal',
      params.windowDays ?? 180,
      params.limit ?? 5,
    ],
    queryFn: () =>
      fetchCustomerPaymentSignal({
        customerId: params.customerId,
        windowDays: params.windowDays,
        limit: params.limit,
      }),
    enabled:
      params.enabled !== false &&
      Number.isFinite(params.customerId) &&
      params.customerId > 0,
    staleTime: CUSTOMER_DETAIL_STALE_MS,
    gcTime: 5 * 60 * 1000,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}

export function useRecordCustomerCollectionEvent() {
  return useMutation({
    mutationFn: (params: {
      customerId: number;
      eventType: CollectionEventType;
      channel?: string;
      payload?: Record<string, unknown>;
    }) => recordCustomerCollectionEvent(params),
  });
}
