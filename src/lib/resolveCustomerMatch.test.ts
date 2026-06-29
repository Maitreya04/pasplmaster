import { strict as assert } from 'node:assert';
import type { Customer } from '../types';
import { matchCustomerFromList } from './resolveCustomerMatch.ts';

const customers: Customer[] = [
  { id: 42, name: 'Acme Motors', city: 'Indore' } as Customer,
  { id: 99, name: 'Beta Auto', city: 'Bhopal' } as Customer,
];

assert.equal(matchCustomerFromList(customers, 42, 'Acme Motors')?.id, 42);

assert.equal(
  matchCustomerFromList(customers, 999, 'Acme Motors')?.id,
  42,
  'falls back to name when id is stale',
);

assert.equal(
  matchCustomerFromList(customers, 999, 'Unknown Shop'),
  null,
  'returns null when customer cannot be matched',
);

console.log('resolveCustomerMatch.test.ts: ok');
