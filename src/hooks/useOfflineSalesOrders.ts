import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  readOfflineSalesOrders,
  subscribeOfflineSalesOrders,
  syncOfflineSalesOrders,
  type OfflineSalesOrder,
} from '../lib/offlineSalesOrders';
import { broadcastInvalidate } from '../lib/crossTabSync';
import { ITEMS_QUERY_KEY } from './useItems';
import { invalidateLocationwiseStockQueries } from './useLocationwiseStock';
import { buildOrderCustomerMessage } from '../lib/buildOrderCustomerMessage';
import { useToast } from '../context/ToastContext';
import { isBrowserOffline, markDeviceOnline } from '../lib/networkStatus';

export type { OfflineSalesOrder } from '../lib/offlineSalesOrders';

let cachedOrders: OfflineSalesOrder[] = [];
let hydrated = false;
let hydratePromise: Promise<void> | null = null;

async function hydrate(): Promise<void> {
  if (hydratePromise) return hydratePromise;
  hydratePromise = readOfflineSalesOrders()
    .then((rows) => {
      cachedOrders = rows;
      hydrated = true;
    })
    .finally(() => {
      hydratePromise = null;
    });
  return hydratePromise;
}

function getSnapshot(): OfflineSalesOrder[] {
  return cachedOrders;
}

function getServerSnapshot(): OfflineSalesOrder[] {
  return [];
}

export function useOfflineSalesOrders(): OfflineSalesOrder[] {
  useEffect(() => {
    void hydrate();
  }, []);

  return useSyncExternalStore(
    (listener) => {
      const unsubscribe = subscribeOfflineSalesOrders(() => {
        void readOfflineSalesOrders().then((rows) => {
          cachedOrders = rows;
          hydrated = true;
          listener();
        });
      });
      if (!hydrated) {
        void hydrate().then(listener);
      }
      return unsubscribe;
    },
    getSnapshot,
    getServerSnapshot,
  );
}

export function useOfflineSalesOrderStats() {
  const orders = useOfflineSalesOrders();
  return useMemo(() => {
    let queued = 0;
    let syncing = 0;
    let partial = 0;
    let noStock = 0;
    let failed = 0;
    for (const order of orders) {
      if (order.status === 'queued') queued += 1;
      else if (order.status === 'syncing') syncing += 1;
      else if (order.status === 'partial') partial += 1;
      else if (order.status === 'no_stock') noStock += 1;
      else if (order.status === 'failed') failed += 1;
    }
    return {
      total: orders.length,
      active: queued + syncing,
      queued,
      syncing,
      partial,
      noStock,
      failed,
    };
  }, [orders]);
}

export function useOfflineSalesOrderSync(): void {
  const queryClient = useQueryClient();
  const toast = useToast();

  useEffect(() => {
    let stopped = false;

    const refreshServerState = () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['pending-items'] });
      queryClient.invalidateQueries({ queryKey: ['open-po-demand-lines'] });
      queryClient.invalidateQueries({ queryKey: ITEMS_QUERY_KEY });
      void invalidateLocationwiseStockQueries(queryClient);
      broadcastInvalidate(['orders']);
    };

    const notifySyncedOrders = (before: OfflineSalesOrder[], after: OfflineSalesOrder[]) => {
      const beforeByKey = new Map(before.map((order) => [order.clientOrderKey, order]));
      for (const order of after) {
        const prev = beforeByKey.get(order.clientOrderKey);
        if (!prev) continue;
        if (!['queued', 'syncing'].includes(prev.status)) continue;
        if (order.status !== 'synced' && order.status !== 'partial') continue;
        if (!order.result?.order_number) continue;

        const lines = (order.result.lines ?? []).map((line) => ({
          name: line.name,
          qtyRequested: line.qty_requested,
          qtyShip: line.qty_ship,
          qtyPo: line.qty_po,
          qtyUnavailable: line.qty_skipped,
          isFoc: line.is_foc ?? false,
        }));
        const shareText = buildOrderCustomerMessage({
          customerName: order.payload.customer_name,
          date: new Date(order.updatedAt),
          lines,
        });

        toast.success(`Order ${order.result.order_number} synced`, {
          action: {
            label: 'Copy message',
            onClick: () => {
              void navigator.clipboard.writeText(shareText);
            },
          },
        });
      }
    };

    const run = async () => {
      if (!isBrowserOffline()) {
        markDeviceOnline();
      }
      const before = await readOfflineSalesOrders();
      const beforeDone = before.filter((o) =>
        ['synced', 'partial', 'no_stock'].includes(o.status),
      ).length;
      const after = await syncOfflineSalesOrders();
      if (stopped) return;
      notifySyncedOrders(before, after);
      const afterDone = after.filter((o) =>
        ['synced', 'partial', 'no_stock'].includes(o.status),
      ).length;
      if (afterDone > beforeDone) refreshServerState();
    };

    const onOnline = () => {
      markDeviceOnline();
      void run();
    };
    const onFocus = () => {
      void run();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void run();
    };

    void run();
    window.addEventListener('online', onOnline);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    const timer = window.setInterval(() => {
      void run();
    }, 10_000);

    return () => {
      stopped = true;
      window.removeEventListener('online', onOnline);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearInterval(timer);
    };
  }, [queryClient, toast]);
}
