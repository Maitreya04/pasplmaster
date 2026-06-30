import type { Customer } from '../types';

function normalizeCustomerText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
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

/** Match a customer by current id, then fall back to normalized name. */
export function matchCustomerFromList(
  customers: Customer[],
  _customerId: number,
  customerName: string,
): Customer | null {
  return matchCustomerByName(customers, customerName);
}

export { matchCustomerByName, isActiveCustomer };
