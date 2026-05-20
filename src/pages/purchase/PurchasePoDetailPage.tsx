import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Receipt } from '@phosphor-icons/react';
import { BigButton } from '../../components/shared';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useLocationwiseStock, stockLocationLabel } from '../../hooks/useLocationwiseStock';
import {
  createReceivingJobFromInvoice,
  createReceivingJobFromPurchaseOrder,
  fetchLatestSupplierInvoiceForPo,
  fetchPurchaseOrder,
  fetchPurchaseOrderLines,
  markPurchaseOrderSent,
  purchaseOrderDetailKey,
  purchaseOrderLinesKey,
  PURCHASE_ORDERS_QUERY_KEY,
  updatePurchaseOrderSupplier,
} from '../../lib/purchase/purchaseApi';
import { RECEIVING_JOBS_QUERY_KEY } from '../../lib/receiving/receivingApi';

export default function PurchasePoDetailPage(): React.JSX.Element {
  const { poId: poIdParam } = useParams<{ poId: string }>();
  const poId = Number(poIdParam);
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const { userId, userName } = useAuth();

  const poQuery = useQuery({
    queryKey: purchaseOrderDetailKey(poId),
    queryFn: () => fetchPurchaseOrder(poId),
    enabled: Number.isFinite(poId) && poId > 0,
  });

  const linesQuery = useQuery({
    queryKey: purchaseOrderLinesKey(poId),
    queryFn: () => fetchPurchaseOrderLines(poId),
    enabled: Number.isFinite(poId) && poId > 0,
  });

  const invoiceQuery = useQuery({
    queryKey: ['purchase', 'po', poId, 'latest_invoice'],
    queryFn: () => fetchLatestSupplierInvoiceForPo(poId),
    enabled: Number.isFinite(poId) && poId > 0,
  });

  const busyCodes = useMemo(
    () =>
      [...new Set((linesQuery.data ?? []).map((l) => Number(l.busy_code)).filter((n) => Number.isFinite(n) && n > 0))],
    [linesQuery.data],
  );

  const stockQuery = useLocationwiseStock(busyCodes);

  const recvPoMut = useMutation({
    mutationFn: () => createReceivingJobFromPurchaseOrder(poId, userId ?? null, userName ?? null),
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: RECEIVING_JOBS_QUERY_KEY });
      toast.success(`Receiving ${r.job_public_id}`);
      navigate(`/admin/receiving/${r.receiving_job_id}`);
    },
    onError: (e: Error) => toast.error(e.message || 'Could not create receiving job'),
  });

  const recvInvMut = useMutation({
    mutationFn: () => {
      const inv = invoiceQuery.data;
      if (!inv?.id) throw new Error('No invoice');
      return createReceivingJobFromInvoice(inv.id, userId ?? null, userName ?? null);
    },
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: RECEIVING_JOBS_QUERY_KEY });
      toast.success(`Receiving ${r.job_public_id}`);
      navigate(`/admin/receiving/${r.receiving_job_id}`);
    },
    onError: (e: Error) => toast.error(e.message || 'Could not create receiving job'),
  });

  const markSentMut = useMutation({
    mutationFn: () => markPurchaseOrderSent(poId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: purchaseOrderDetailKey(poId) });
      await qc.invalidateQueries({ queryKey: PURCHASE_ORDERS_QUERY_KEY });
      toast.success('Marked sent');
    },
    onError: () => toast.error('Could not update'),
  });

  const saveSupplierMut = useMutation({
    mutationFn: (name: string) => updatePurchaseOrderSupplier(poId, name.trim() || null),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: purchaseOrderDetailKey(poId) });
      toast.success('Saved');
    },
    onError: () => toast.error('Could not save'),
  });

  const po = poQuery.data;
  const lines = linesQuery.data ?? [];

  if (!Number.isFinite(poId) || poId <= 0) {
    return <div className="role-admin p-6 text-sm text-[var(--content-warning)]">Invalid PO.</div>;
  }

  if (poQuery.isLoading || !po) {
    return (
      <div className="role-admin p-6 text-sm text-[var(--content-tertiary)]">
        Loading…
      </div>
    );
  }

  const stock = stockQuery.data ?? {};

  return (
    <div className="role-admin min-h-screen bg-[var(--bg-primary)] px-4 py-6 lg:px-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <button
          type="button"
          onClick={() => navigate('/purchase')}
          className="inline-flex items-center gap-1 text-sm text-[var(--content-secondary)] hover:text-[var(--content-primary)]"
        >
          <ArrowLeft size={18} weight="bold" />
          Purchase orders
        </button>

        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="font-mono text-xl font-bold text-[var(--content-primary)]">{po.po_number}</p>
              <p className="mt-1 text-sm text-[var(--content-tertiary)]">
                {po.status} · {po.source}
              </p>
            </div>
            <span className="rounded-full bg-[var(--bg-accent-subtle)] px-3 py-1 text-xs font-semibold text-[var(--content-accent)]">
              Open demand hints use sales <code className="font-mono">qty_po</code>
            </span>
          </div>

          <label className="mt-4 block text-xs font-semibold text-[var(--content-tertiary)]">Supplier</label>
          <div className="mt-1 flex flex-wrap gap-2">
            <input
              key={po.id}
              defaultValue={po.supplier_name ?? ''}
              id="po-supplier-input"
              className="min-h-10 flex-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 text-sm"
              placeholder="Supplier name"
            />
            <BigButton
              type="button"
              variant="secondary"
              className="min-h-10"
              onClick={() => {
                const el = document.getElementById('po-supplier-input') as HTMLInputElement | null;
                saveSupplierMut.mutate(el?.value ?? '');
              }}
            >
              Save supplier
            </BigButton>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <BigButton
              type="button"
              variant="secondary"
              disabled={po.status !== 'draft' || markSentMut.isPending}
              onClick={() => markSentMut.mutate()}
            >
              Mark PO sent
            </BigButton>
            <BigButton type="button" variant="secondary" onClick={() => navigate(`/purchase/po/${poId}/invoice`)}>
              <Receipt size={18} weight="bold" className="mr-1 inline" />
              Invoice PDF & OCR
            </BigButton>
            <BigButton
              type="button"
              variant="primary"
              className="bg-[var(--bg-accent)] text-[var(--content-on-color)]"
              disabled={recvPoMut.isPending || lines.length === 0}
              onClick={() => recvPoMut.mutate()}
            >
              Start receiving (PO)
            </BigButton>
            <BigButton
              type="button"
              variant="secondary"
              disabled={recvInvMut.isPending || !invoiceQuery.data?.id}
              onClick={() => recvInvMut.mutate()}
            >
              Start receiving (invoice)
            </BigButton>
          </div>
          {!invoiceQuery.data?.id ? (
            <p className="mt-3 text-xs text-[var(--content-tertiary)]">
              Save an invoice draft first to enable “Start receiving (invoice)”.
            </p>
          ) : (
            <p className="mt-3 text-xs text-[var(--content-secondary)]">
              Latest invoice #{invoiceQuery.data.invoice_number ?? invoiceQuery.data.id} — receiving uses billed qty and
              supplier billing rates (not MRP).
            </p>
          )}
        </div>

        <div className="overflow-x-auto rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
          <table className="w-full min-w-[880px] text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border-subtle)] text-xs uppercase text-[var(--content-tertiary)]">
                <th className="p-2">#</th>
                <th className="p-2">Busy</th>
                <th className="p-2">Description</th>
                <th className="p-2">Ordered</th>
                <th className="p-2">Demand hint</th>
                <th className="p-2">Received</th>
                <th className="p-2">{stockLocationLabel('main_store')}</th>
                <th className="p-2">{stockLocationLabel('jabalpur')}</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const s = stock[Number(l.busy_code)];
                const main = s?.mainStoreStockQty ?? null;
                const jbp = s?.jabalpurStockQty ?? null;
                return (
                  <tr key={l.id} className="border-b border-[var(--border-subtle)]">
                    <td className="p-2">{l.line_no}</td>
                    <td className="p-2 font-mono">{l.busy_code}</td>
                    <td className="p-2">{l.description_snapshot}</td>
                    <td className="p-2">{l.qty_ordered}</td>
                    <td className="p-2 text-[var(--content-secondary)]">{l.suggested_qty_from_demand ?? '—'}</td>
                    <td className="p-2">{l.qty_received}</td>
                    <td className="p-2 font-mono">{main ?? '…'}</td>
                    <td className="p-2 font-mono">{jbp ?? '…'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {lines.length === 0 ? <p className="p-4 text-sm text-[var(--content-tertiary)]">No lines.</p> : null}
        </div>
      </div>
    </div>
  );
}
