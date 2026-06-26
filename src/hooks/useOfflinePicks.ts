import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  readOfflinePicks,
  readOfflinePicksMirror,
  subscribeOfflinePicks,
  syncOfflinePicks,
  type OfflinePickSession,
} from '../lib/offlinePicks';
import { broadcastInvalidate } from '../lib/crossTabSync';

export type { OfflinePickSession } from '../lib/offlinePicks';

let cachedPicks: OfflinePickSession[] = [];
let hydrated = false;
let hydratePromise: Promise<void> | null = null;

async function hydrate(): Promise<void> {
  if (hydratePromise) return hydratePromise;
  const mirror = readOfflinePicksMirror();
  if (mirror.length > 0) {
    cachedPicks = mirror;
    hydrated = true;
  }
  hydratePromise = readOfflinePicks()
    .then((rows) => {
      cachedPicks = rows;
      hydrated = true;
    })
    .finally(() => {
      hydratePromise = null;
    });
  return hydratePromise;
}

function getSnapshot(): OfflinePickSession[] {
  return cachedPicks;
}

function getServerSnapshot(): OfflinePickSession[] {
  return [];
}

/** UI-relevant queue equality — ignore lineMrpByItemId-only writes (live MRP lives in React). */
function offlinePickQueueEqualForUi(
  prev: OfflinePickSession[],
  next: OfflinePickSession[],
): boolean {
  if (prev.length !== next.length) return false;
  for (let i = 0; i < prev.length; i += 1) {
    const a = prev[i]!;
    const b = next[i]!;
    if (
      a.orderId !== b.orderId ||
      a.status !== b.status ||
      a.clientPickKey !== b.clientPickKey ||
      a.claimId !== b.claimId ||
      a.offlineLeaseExpiresAt !== b.offlineLeaseExpiresAt ||
      a.orderSnapshot !== b.orderSnapshot
    ) {
      return false;
    }
  }
  return true;
}

function applyOfflinePickSnapshot(next: OfflinePickSession[]): boolean {
  if (offlinePickQueueEqualForUi(cachedPicks, next)) return false;
  cachedPicks = next;
  hydrated = true;
  return true;
}

export function useOfflinePicks(): OfflinePickSession[] {
  useEffect(() => {
    void hydrate();
  }, []);

  return useSyncExternalStore(
    (listener) => {
      const unsubscribe = subscribeOfflinePicks(() => {
        // Mirror is updated synchronously in writeQueue — use it first so we do not
        // re-render the pick UI on lineMrpByItemId-only persistence loops.
        const mirror = readOfflinePicksMirror();
        if (mirror.length > 0 && applyOfflinePickSnapshot(mirror)) {
          listener();
        }
        void readOfflinePicks().then((rows) => {
          if (applyOfflinePickSnapshot(rows)) listener();
        });
      });
      if (!hydrated) {
        void hydrate().then(() => {
          if (hydrated) listener();
        });
      }
      return unsubscribe;
    },
    getSnapshot,
    getServerSnapshot,
  );
}

export function useOfflinePickSession(orderId: number | null): OfflinePickSession | null {
  const picks = useOfflinePicks();
  return useMemo(() => {
    if (!orderId) return null;
    return picks.find((pick) => pick.orderId === orderId && pick.status !== 'applied') ?? null;
  }, [orderId, picks]);
}

export function useOfflinePicksHydrated(): boolean {
  useOfflinePicks();
  return hydrated;
}

export function useOfflinePickStats() {
  const picks = useOfflinePicks();
  return useMemo(() => {
    let active = 0;
    let preparing = 0;
    let queued = 0;
    let syncing = 0;
    let conflict = 0;
    let failed = 0;
    for (const pick of picks) {
      if (pick.status === 'active') active += 1;
      else if (pick.status === 'preparing') preparing += 1;
      else if (pick.status === 'queued') queued += 1;
      else if (pick.status === 'syncing') syncing += 1;
      else if (pick.status === 'conflict') conflict += 1;
      else if (pick.status === 'failed') failed += 1;
    }
    return {
      total: picks.length,
      waiting: preparing + active + queued + syncing,
      preparing,
      active,
      queued,
      syncing,
      conflict,
      failed,
    };
  }, [picks]);
}

export function useOfflinePickSync(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    let stopped = false;

    const refreshServerState = () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['claimable-orders'] });
      queryClient.invalidateQueries({ queryKey: ['picker-daily-stats'] });
      queryClient.invalidateQueries({ queryKey: ['picker-completed-orders'] });
      queryClient.invalidateQueries({ queryKey: ['offline-pick-conflicts'] });
      broadcastInvalidate(['orders']);
    };

    const run = async () => {
      const before = await readOfflinePicks();
      const beforeDone = before.filter((row) =>
        ['applied', 'conflict', 'failed'].includes(row.status),
      ).length;
      const after = await syncOfflinePicks();
      if (stopped) return;
      const afterDone = after.filter((row) =>
        ['applied', 'conflict', 'failed'].includes(row.status),
      ).length;
      if (afterDone > beforeDone) refreshServerState();
    };

    const onOnline = () => {
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
    }, 30_000);

    return () => {
      stopped = true;
      window.removeEventListener('online', onOnline);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearInterval(timer);
    };
  }, [queryClient]);
}
