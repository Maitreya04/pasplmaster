import type { Customer } from '../types';
import { getCustomerCity } from './customerDisplay';
import { idbGet } from './idb';
import { matchCustomerByName, matchCustomerFromList } from './resolveCustomerMatch';
import { supabase } from './supabase/client';
import type { SalesOrderPayload } from './offlineSalesOrders';

const CUSTOMERS_IDB_KEY = 'customers-cache-v1';

interface PersistedCustomers {
  version: number;
  rows: Array<Customer & { is_active?: boolean | null }>;
}

async function readCachedCustomers(): Promise<Customer[]> {
  const snapshot = await idbGet<PersistedCustomers>(CUSTOMERS_IDB_KEY);
  if (!snapshot?.rows?.length) return [];
  return snapshot.rows.filter((row) => row.is_active !== false);
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

  return matchCustomerByName(data as Customer[], customerName);
}

/** Resolve stale cart/offline customer ids before submitting an order. */
export async function resolveCustomerForOrder(customer: Customer): Promise<Customer> {
  const cached = await readCachedCustomers();
  const resolved =
    matchCustomerFromList(cached, customer.id, customer.name) ??
    (await lookupCustomerOnServer(customer.name));

  if (!resolved) {
    throw new Error(
      'Customer was not found. Refresh your customer list and select the customer again.',
    );
  }

  return resolved;
}

/** Refresh stale offline customer ids before replaying an order to the server. */
export async function resolveCustomerForOfflineSync(
  payload: SalesOrderPayload,
): Promise<SalesOrderPayload> {
  const cached = await readCachedCustomers();
  const resolved =
    matchCustomerFromList(cached, payload.customer_id, payload.customer_name) ??
    (await lookupCustomerOnServer(payload.customer_name));

  if (!resolved) return payload;

  return {
    ...payload,
    customer_id: resolved.id,
    customer_name: resolved.name,
    customer_city: getCustomerCity(resolved) ?? payload.customer_city,
  };
}

export { matchCustomerFromList } from './resolveCustomerMatch';
