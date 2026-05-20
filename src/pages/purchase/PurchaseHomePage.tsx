import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, FilePdf, FileXls, Plus } from '@phosphor-icons/react';
import { BigButton } from '../../components/shared';
import { fetchPurchaseOrders, PURCHASE_ORDERS_QUERY_KEY } from '../../lib/purchase/purchaseApi';

export default function PurchaseHomePage(): React.JSX.Element {
  const navigate = useNavigate();
  const ordersQuery = useQuery({
    queryKey: PURCHASE_ORDERS_QUERY_KEY,
    queryFn: () => fetchPurchaseOrders(),
  });
  const rows = ordersQuery.data ?? [];

  return (
    <div className="role-admin min-h-screen bg-[var(--bg-primary)] px-4 py-6 lg:px-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <button
              type="button"
              onClick={() => navigate('/admin')}
              className="mb-2 inline-flex items-center gap-1 text-sm text-[var(--content-secondary)] hover:text-[var(--content-primary)]"
            >
              <ArrowLeft size={18} weight="bold" />
              Admin
            </button>
            <h1 className="text-2xl font-bold text-[var(--content-primary)]">Purchase orders</h1>
            <p className="mt-1 text-sm text-[var(--content-tertiary)]">
              Start from Excel (Description + ORD/Qty, or Part no / Alias columns), from a supplier invoice PDF (creates a sent PO), attach OCR on an existing PO, then open a receiving job.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <BigButton
              type="button"
              variant="primary"
              className="min-h-11 shrink-0 bg-[var(--bg-accent)] text-[var(--content-on-color)]"
              onClick={() => navigate('/purchase/new')}
            >
              <FileXls size={20} weight="bold" className="mr-1 inline" aria-hidden />
              New from Excel
            </BigButton>
            <BigButton
              type="button"
              variant="secondary"
              className="min-h-11 shrink-0"
              onClick={() => navigate('/purchase/invoice/new')}
            >
              <FilePdf size={20} weight="bold" className="mr-1 inline" aria-hidden />
              New from Invoice PDF
            </BigButton>
            <BigButton type="button" variant="secondary" className="min-h-11" onClick={() => navigate('/admin/receiving')}>
              Receiving jobs
            </BigButton>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
          {ordersQuery.isLoading ? (
            <p className="p-4 text-sm text-[var(--content-tertiary)]">Loading…</p>
          ) : rows.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm text-[var(--content-secondary)]">No purchase orders yet.</p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <BigButton type="button" variant="secondary" className="min-h-11" onClick={() => navigate('/purchase/new')}>
                  <Plus size={18} weight="bold" className="mr-1 inline" />
                  Create from Excel
                </BigButton>
                <BigButton
                  type="button"
                  variant="secondary"
                  className="min-h-11"
                  onClick={() => navigate('/purchase/invoice/new')}
                >
                  <FilePdf size={18} weight="bold" className="mr-1 inline" />
                  Create from invoice PDF
                </BigButton>
              </div>
            </div>
          ) : (
            <ul className="divide-y divide-[var(--border-subtle)]">
              {rows.map((po) => (
                <li key={po.id}>
                  <button
                    type="button"
                    onClick={() => navigate(`/purchase/po/${po.id}`)}
                    className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-4 text-left transition-colors hover:bg-[var(--bg-tertiary)]"
                  >
                    <div>
                      <p className="font-mono text-sm font-bold text-[var(--content-primary)]">{po.po_number}</p>
                      <p className="text-xs text-[var(--content-tertiary)]">
                        {po.source} · {po.supplier_name ?? 'Supplier TBD'}
                      </p>
                    </div>
                    <span className="rounded-full bg-[var(--bg-accent-subtle)] px-3 py-1 text-xs font-semibold text-[var(--content-accent)]">
                      {po.status}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
