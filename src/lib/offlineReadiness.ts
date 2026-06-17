import { idbGet } from './idb';

interface CacheProbe {
  key: string;
  minVersion?: number;
  minRows?: number;
}

const SALES_OFFLINE_PROBES: CacheProbe[] = [
  { key: 'items-cache-v1', minVersion: 1, minRows: 1 },
  { key: 'customers-cache-v1', minVersion: 1, minRows: 1 },
  { key: 'locationwise-stock-cache-v1', minVersion: 2, minRows: 1 },
];

function rowCount(snapshot: unknown): number {
  if (!snapshot || typeof snapshot !== 'object') return 0;
  const record = snapshot as Record<string, unknown>;
  if (Array.isArray(record.items)) return record.items.length;
  if (Array.isArray(record.rows)) return record.rows.length;
  return 0;
}

function versionOk(snapshot: unknown, minVersion?: number): boolean {
  if (minVersion == null) return true;
  if (!snapshot || typeof snapshot !== 'object') return false;
  return (snapshot as { version?: number }).version === minVersion;
}

export interface OfflineReadiness {
  ready: boolean;
  itemsCached: boolean;
  customersCached: boolean;
  stockCached: boolean;
}

export async function getSalesOfflineReadiness(): Promise<OfflineReadiness> {
  const [items, customers, stock] = await Promise.all([
    idbGet<unknown>(SALES_OFFLINE_PROBES[0]!.key),
    idbGet<unknown>(SALES_OFFLINE_PROBES[1]!.key),
    idbGet<unknown>(SALES_OFFLINE_PROBES[2]!.key),
  ]);

  const itemsCached =
    versionOk(items, SALES_OFFLINE_PROBES[0]!.minVersion) &&
    rowCount(items) >= (SALES_OFFLINE_PROBES[0]!.minRows ?? 1);
  const customersCached =
    versionOk(customers, SALES_OFFLINE_PROBES[1]!.minVersion) &&
    rowCount(customers) >= (SALES_OFFLINE_PROBES[1]!.minRows ?? 1);
  const stockCached =
    versionOk(stock, SALES_OFFLINE_PROBES[2]!.minVersion) &&
    rowCount(stock) >= (SALES_OFFLINE_PROBES[2]!.minRows ?? 1);

  return {
    ready: itemsCached && customersCached,
    itemsCached,
    customersCached,
    stockCached,
  };
}
