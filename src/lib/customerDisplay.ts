import type { Customer } from '../types';

function trimOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** ERP imports use `station`; app-created rows use `city`. */
export function getCustomerCity(customer: Customer): string | null {
  return trimOrNull(customer.city) ?? trimOrNull(customer.station);
}

type CustomerAddressFields = Pick<Customer, 'address' | 'address1' | 'address2' | 'address3'>;

/** ERP imports split address across address1–3; app-created rows use `address`. */
export function getCustomerAddress(customer: CustomerAddressFields): string | null {
  const legacy = trimOrNull(customer.address);
  if (legacy) return legacy;

  const parts = [customer.address1, customer.address2, customer.address3]
    .map(trimOrNull)
    .filter((part): part is string => Boolean(part));

  return parts.length > 0 ? parts.join(', ') : null;
}

export function normalizeCustomerText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function buildCustomerDuplicateNameSet(customers: Customer[]): Set<string> {
  const counts = new Map<string, number>();
  for (const customer of customers) {
    const normalized = normalizeCustomerText(customer.name);
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }

  return new Set(
    [...counts.entries()]
      .filter(([, count]) => count > 1)
      .map(([name]) => name),
  );
}

export function isCustomerNameDuplicate(customer: Customer, duplicateNames: Set<string>): boolean {
  return duplicateNames.has(normalizeCustomerText(customer.name));
}

export function getCustomerSearchText(customer: Customer): string {
  return [customer.name, getCustomerCity(customer), getCustomerAddress(customer)]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function getCustomerSecondaryLine(
  customer: Customer,
  duplicateNames: Set<string>,
): string | null {
  void duplicateNames;
  return getCustomerCity(customer);
}

export function getCustomerTertiaryLine(customer: Customer, duplicateNames: Set<string>): string | null {
  const address = getCustomerAddress(customer);
  if (address) return address;
  if (isCustomerNameDuplicate(customer, duplicateNames)) return null;
  return null;
}

export function getCustomerMetaParts(customer: Customer): string[] {
  void customer;
  return [];
}
