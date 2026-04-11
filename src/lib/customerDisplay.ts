import type { Customer } from '../types';

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
  return [customer.name, customer.city, customer.address]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function getCustomerSecondaryLine(customer: Customer, _duplicateNames: Set<string>): string | null {
  return customer.city || null;
}

export function getCustomerTertiaryLine(customer: Customer, duplicateNames: Set<string>): string | null {
  if (customer.address) return customer.address;
  if (isCustomerNameDuplicate(customer, duplicateNames)) return null;
  return null;
}

export function getCustomerMetaParts(_customer: Customer): string[] {
  return [];
}
