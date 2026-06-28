import type { Customer } from '../types';
import { getCustomerCity, normalizeCustomerText } from './customerDisplay';
import { idbGet } from './idb';
import { supabase } from './supabase/client';
import type { SalesOrderPayload } from './offlineSalesOrders';

const CUSTOMERS_IDB_KEY = 'customers-cache-v1';

interface PersistedCustomers {
  version: number;
  rows: Array<Customer & { is_active?: boolean | null }>;
}

function isActiveCustomer(row: Customer & { is_active?: boolean | null }): boolean {
  return row.is_active !== false;
}

function matchCustomerByName(
  customers: Array<Customer & { is_active?: boolean | null }>,
  customerName: string,
): Customer | null {
  const needle = normalizeCustomerText(customerName);
  const matches = customers.filter(
    (row) => isActiveCustomer(row) && normalizeCustomerText(row.name) === needle,
  );
  if (matches.length === 0) return null;
  return matches.sort((a, b) => a.id - b.id)[0] ?? null;
}

async function readCachedCustomers(): Promise<Customer[]> {
  const snapshot = await idbGet<PersistedCustomers>(CUSTOMERS_IDB_KEY);
  if (!snapshot?.rows?.length) return [];
  return snapshot.rows.filter(isActiveCustomer);
}

async function lookupCustomerOnServer(customerName: string): Promise<Customer | null> {
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .eq('is_active', true)
    .ilike('name', customerName.trim())
    .order('id')
    .limit(5);

  if (error || !data?.length) return null;

  const exact = matchCustomerByName(data as Customer[], customerName);
  return exact;
}

/** Refresh stale offline customer ids before replaying an order to the server. */
export async function resolveCustomerForOfflineSync(
  payload: SalesOrderPayload,
): Promise<SalesOrderPayload> {
  const cached = await readCachedCustomers();
  const byId = cached.find((row) => row.id === payload.customer_id) ?? null;
  const byName = matchCustomerByName(cached, payload.customer_name);
  const resolved = byId ?? byName ?? (await lookupCustomerOnServer(payload.customer_name));

  if (!resolved) return payload;

  return {
    ...payload,
    customer_id: resolved.id,
    customer_name: resolved.name,
    customer_city: getCustomerCity(resolved) ?? payload.customer_city,
  };
}
