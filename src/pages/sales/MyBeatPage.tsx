import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CaretRight, UsersThree } from '@phosphor-icons/react';
import { PageHeader, SearchInput, Card, Skeleton } from '../../components/shared';
import { WorkdayBanner } from '../../components/sales/WorkdayBanner';
import { customerRailMetaLine } from '../../components/sales/YourCustomerRailCard';
import { useCustomers } from '../../hooks/useCustomers';
import { useCustomerCollectionSnapshots } from '../../hooks/useCustomerReceivables';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase/client';
import {
  getCustomerSearchText,
  getCustomerSecondaryLine,
} from '../../lib/customerDisplay';
import { buildCustomerRailGlance } from '../../lib/receivables';

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

  const beatCustomerIds = useMemo(
    () => filteredBeat.map(({ customer }) => customer.id),
    [filteredBeat],
  );
  const { byId: snapshotsById, loadingIds: snapshotLoadingIds } =
    useCustomerCollectionSnapshots(beatCustomerIds);

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
              <div className="mb-2 flex items-center justify-between gap-3">
                <h2 className="ds-type-eyebrow">Your customers</h2>
                <p className="ds-type-caption">
                  {filteredBeat.length} on beat
                </p>
              </div>
              <div className="space-y-2">
                {filteredBeat.length === 0 ? (
                  <Card>
                    <p className="text-sm text-[var(--content-tertiary)]">
                      No beat customers yet — search below for any customer.
                    </p>
                  </Card>
                ) : (
                  filteredBeat.map(({ customer, orderCount }) => {
                    const snapshot = snapshotsById.get(customer.id);
                    const snapshotLoading =
                      !snapshot && snapshotLoadingIds.has(customer.id);
                    const glance = buildCustomerRailGlance(snapshot);
                    const meta = customerRailMetaLine(customer, snapshot);

                    return (
                      <Link key={customer.id} to={`/sales/customer/${customer.id}`}>
                        <Card pressable className="py-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-start justify-between gap-2">
                                <p className="ds-type-row-title truncate">{customer.name}</p>
                                <span className="ds-type-caption shrink-0 tabular-nums">
                                  {glance.billCount != null
                                    ? `${glance.billCount} bill${glance.billCount === 1 ? '' : 's'}`
                                    : snapshotLoading
                                      ? '…'
                                      : `${orderCount} order${orderCount === 1 ? '' : 's'}`}
                                </span>
                              </div>
                              {meta ? (
                                <p className="ds-type-caption mt-0.5 truncate">{meta}</p>
                              ) : (
                                <p className="ds-type-caption mt-0.5 truncate">
                                  {getCustomerSecondaryLine(customer, new Set()) ?? '—'}
                                </p>
                              )}
                              <div className="mt-2 flex flex-wrap items-center gap-1">
                                {glance.primaryBadge ? (
                                  <span
                                    className={[
                                      'inline-flex max-w-full items-center rounded-full border px-1.5 py-0.5',
                                      'text-[10px] font-semibold tabular-nums leading-none',
                                      glance.primaryBadge.intent === 'positive'
                                        ? 'bg-[var(--bg-positive-subtle)] text-[var(--content-positive)] border-[var(--border-positive)]'
                                        : glance.primaryBadge.intent === 'negative'
                                          ? 'bg-[var(--bg-negative-subtle)] text-[var(--content-negative)] border-[var(--border-negative)]'
                                          : glance.primaryBadge.intent === 'warning'
                                            ? 'bg-[var(--bg-warning-subtle)] text-[var(--content-warning-on-light)] border-[var(--border-warning)]'
                                            : 'bg-[var(--bg-tertiary)] text-[var(--content-secondary)] border-[var(--border-subtle)]',
                                    ].join(' ')}
                                  >
                                    <span className="truncate">{glance.primaryBadge.label}</span>
                                  </span>
                                ) : snapshotLoading ? (
                                  <span className="h-4 w-16 animate-pulse rounded-full bg-[var(--bg-tertiary)]" />
                                ) : null}
                                {glance.secondaryBadge ? (
                                  <span className="inline-flex items-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] px-1.5 py-0.5 text-[10px] font-medium tabular-nums leading-none text-[var(--content-secondary)]">
                                    {glance.secondaryBadge.label}
                                  </span>
                                ) : null}
                              </div>
                            </div>
                            <CaretRight size={18} className="mt-1 shrink-0 text-[var(--content-quaternary)]" />
                          </div>
                        </Card>
                      </Link>
                    );
                  })
                )}
              </div>
            </section>

            {search.trim() && (
              <section>
                <h2 className="ds-type-eyebrow mb-2">Search all customers</h2>
                <div className="space-y-2">
                  {filteredAll.map((customer) => (
                    <Link key={customer.id} to={`/sales/customer/${customer.id}`}>
                      <Card pressable className="py-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="ds-type-row-title truncate">{customer.name}</p>
                            <p className="ds-type-caption mt-0.5 truncate">
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
            <p className="ds-type-caption text-[var(--content-secondary)]">
              Open a customer, start the visit, then end it with an outcome and optional notes.
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}
