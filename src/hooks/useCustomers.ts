import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase/client';
import type { Customer } from '../types';

const BATCH_SIZE = 1000;

async function fetchAllCustomers(): Promise<Customer[]> {
  const { count, error: countErr } = await supabase
    .from('customers')
    .select('id', { count: 'exact', head: true })
    .eq('is_active', true);

  if (countErr) throw countErr;
  if (!count) return [];

  const batches = Math.ceil(count / BATCH_SIZE);
  const promises = Array.from({ length: batches }, (_, i) => {
    const from = i * BATCH_SIZE;
    return supabase
      .from('customers')
      .select('*')
      .eq('is_active', true)
      .range(from, from + BATCH_SIZE - 1)
      .order('id');
  });

  const results = await Promise.all(promises);
  const allCustomers: Customer[] = new Array(count);
  let offset = 0;

  for (const { data, error } of results) {
    if (error) throw error;
    if (data) {
      for (let i = 0; i < data.length; i++) {
        allCustomers[offset + i] = data[i] as Customer;
      }
      offset += data.length;
    }
  }

  return allCustomers.slice(0, offset);
}

export function useCustomers() {
  return useQuery<Customer[]>({
    queryKey: ['customers'],
    queryFn: fetchAllCustomers,
    staleTime: 30 * 60 * 1000,
  });
}
