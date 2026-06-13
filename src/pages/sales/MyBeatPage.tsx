import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CaretRight, UsersThree } from '@phosphor-icons/react';
import { PageHeader, SearchInput, Card, Skeleton } from '../../components/shared';
import { WorkdayBanner } from '../../components/sales/WorkdayBanner';
import { useCustomers } from '../../hooks/useCustomers';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase/client';
import {
  getCustomerSearchText,
  getCustomerSecondaryLine,
} from '../../lib/customerDisplay';
import { formatTimeAgo } from '../../utils/formatters';

interface TopCustomerRow {
  customer_name: string;
  order_count: number;
  last_order_date: string | null;
}

export default function MyBeatPage(): React.JSX.Element {
  const { userName } = useAuth();
  const { data: customers = [], isLoading: customersLoading } = useCustomers();
  const [search, setSearch] = useState('');

  const { data: topCustomers = [], isLoading: topLoading } = useQuery({
    queryKey: ['sales', 'topCustomers', userName],
    queryFn: async () => {
      if (!userName) return [] as TopCustomerRow[];
      const { data, error } = await supabase.rpc('get_salesperson_top_customers_live', {
        p_salesperson_name: userName,
        p_limit: 50,
      });
      if (error) throw error;
      return (data ?? []) as TopCustomerRow[];
    },
    enabled: Boolean(userName),
  });

  const customerByName = useMemo(() => {
    const map = new Map<string, (typeof customers)[number]>();
    for (const c of customers) map.set(c.name.toLowerCase(), c);
    return map;
  }, [customers]);

  const beatRows = useMemo(() => {
    return topCustomers
      .map((row) => {
        const customer = customerByName.get(row.customer_name.toLowerCase());
        if (!customer) return null;
        return { customer, orderCount: row.order_count, lastOrderDate: row.last_order_date };
      })
      .filter(Boolean) as Array<{
      customer: (typeof customers)[number];
      orderCount: number;
      lastOrderDate: string | null;
    }>;
  }, [customerByName, topCustomers]);

  const filteredBeat = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return beatRows;
    return beatRows.filter(({ customer }) => getCustomerSearchText(customer).includes(q));
  }, [beatRows, search]);

  const filteredAll = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return customers
      .filter((c) => getCustomerSearchText(c).includes(q))
      .slice(0, 30);
  }, [customers, search]);

  const isLoading = customersLoading || topLoading;

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] pb-6">
      <PageHeader title="My beat" />
      <WorkdayBanner />

      <div className="px-4 space-y-4">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search customers…"
        />

        {isLoading ? (
          <Skeleton variant="text" lines={6} />
        ) : (
          <>
            <section>
              <h2 className="mb-2 text-sm font-semibold text-[var(--content-secondary)]">
                Your customers
              </h2>
              <div className="space-y-2">
                {filteredBeat.length === 0 ? (
                  <Card>
                    <p className="text-sm text-[var(--content-tertiary)]">
                      No beat customers yet — search below for any customer.
                    </p>
                  </Card>
                ) : (
                  filteredBeat.map(({ customer, orderCount, lastOrderDate }) => (
                    <Link key={customer.id} to={`/sales/customer/${customer.id}`}>
                      <Card pressable className="py-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-semibold text-[var(--content-primary)] truncate">
                              {customer.name}
                            </p>
                            <p className="text-xs text-[var(--content-tertiary)] truncate">
                              {getCustomerSecondaryLine(customer, new Set())}
                            </p>
                            <p className="mt-1 text-xs text-[var(--content-secondary)]">
                              {orderCount} orders
                              {lastOrderDate ? ` · last order ${formatTimeAgo(lastOrderDate)}` : ''}
                            </p>
                          </div>
                          <CaretRight size={18} className="shrink-0 text-[var(--content-quaternary)]" />
                        </div>
                      </Card>
                    </Link>
                  ))
                )}
              </div>
            </section>

            {search.trim() && (
              <section>
                <h2 className="mb-2 text-sm font-semibold text-[var(--content-secondary)]">
                  Search all customers
                </h2>
                <div className="space-y-2">
                  {filteredAll.map((customer) => (
                    <Link key={customer.id} to={`/sales/customer/${customer.id}`}>
                      <Card pressable className="py-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-medium text-[var(--content-primary)] truncate">
                              {customer.name}
                            </p>
                            <p className="text-xs text-[var(--content-tertiary)] truncate">
                              {getCustomerSecondaryLine(customer, new Set())}
                            </p>
                          </div>
                          <CaretRight size={18} className="shrink-0 text-[var(--content-quaternary)]" />
                        </div>
                      </Card>
                    </Link>
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        {!search.trim() && !isLoading && (
          <Card className="flex items-center gap-3">
            <UsersThree size={24} className="text-[var(--role-primary)]" />
            <p className="text-sm text-[var(--content-secondary)]">
              Start a visit from a customer card to build location history and enable geofence checks.
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}
