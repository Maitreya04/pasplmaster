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

async function fetchActiveCustomerById(customerId: number): Promise<Customer | null> {
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .eq('id', customerId)
    .eq('is_active', true)
    .maybeSingle();

  if (error || !data) return null;
  return data as Customer;
}

async function lookupCustomerOnServer(customerName: string): Promise<Customer | null> {
  const trimmed = customerName.trim();
  if (!trimmed) return null;

  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .eq('is_active', true)
    .ilike('name', trimmed)
    .order('id')
    .limit(10);

  if (error || !data?.length) return null;

  return matchCustomerByName(data as Customer[], trimmed);
}

/** Resolve stale cart/offline customer ids before submitting an order. */
export async function resolveCustomerForOrder(
  customer: Customer,
  options?: { customers?: Customer[] },
): Promise<Customer> {
  const byServerId = await fetchActiveCustomerById(customer.id);
  if (byServerId) return byServerId;

  const cached = await readCachedCustomers();
  const localCustomers = options?.customers?.length ? options.customers : cached;
  const byName =
    matchCustomerByName(localCustomers, customer.name) ??
    (await lookupCustomerOnServer(customer.name));

  if (!byName) {
    throw new Error(
      'Customer was not found. Refresh your customer list and select the customer again.',
    );
  }

  const verified = await fetchActiveCustomerById(byName.id);
  return verified ?? byName;
}

/** Refresh stale offline customer ids before replaying an order to the server. */
export async function resolveCustomerForOfflineSync(
  payload: SalesOrderPayload,
): Promise<SalesOrderPayload> {
  const byServerId = await fetchActiveCustomerById(payload.customer_id);
  if (byServerId) {
    return {
      ...payload,
      customer_id: byServerId.id,
      customer_name: byServerId.name,
      customer_city: getCustomerCity(byServerId) ?? payload.customer_city,
    };
  }

  const cached = await readCachedCustomers();
  const resolved =
    matchCustomerFromList(cached, payload.customer_id, payload.customer_name) ??
    (await lookupCustomerOnServer(payload.customer_name));

  if (!resolved) return payload;

  const verified = (await fetchActiveCustomerById(resolved.id)) ?? resolved;

  return {
    ...payload,
    customer_id: verified.id,
    customer_name: verified.name,
    customer_city: getCustomerCity(verified) ?? payload.customer_city,
  };
}

export { matchCustomerFromList } from './resolveCustomerMatch';
