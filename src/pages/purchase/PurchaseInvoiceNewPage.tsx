import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, FilePdf } from '@phosphor-icons/react';
import { BigButton } from '../../components/shared';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { fetchPurchaseLookupMaps } from '../../lib/import/purchasePoImporter';
import { extractSupplierInvoiceFromJpegPages } from '../../lib/purchase/invoiceExtract';
import { buildInvoiceDraftRows, type InvoiceDraftRow } from '../../lib/purchase/linkInvoiceLinesToPo';
import {
  createPurchaseOrderFromInvoiceDraft,
  createReceivingJobFromInvoice,
  purchaseOrderDetailKey,
  PURCHASE_ORDERS_QUERY_KEY,
} from '../../lib/purchase/purchaseApi';
import { renderPdfPagesToJpegBase64 } from '../../lib/purchase/renderPdfToJpeg';
import { RECEIVING_JOBS_QUERY_KEY } from '../../lib/receiving/receivingApi';

export default function PurchaseInvoiceNewPage(): React.JSX.Element {
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const { userId, userName } = useAuth();

  const [supplierName, setSupplierName] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState('');
  const [draftRows, setDraftRows] = useState<InvoiceDraftRow[]>([]);
  const [extractBusy, setExtractBusy] = useState(false);
  const [savedInvoiceId, setSavedInvoiceId] = useState<number | null>(null);
  const [savedPoId, setSavedPoId] = useState<number | null>(null);
  const [pdfName, setPdfName] = useState('');

  const mapsQuery = useQuery({
    queryKey: ['purchase', 'lookup_maps'],
    queryFn: fetchPurchaseLookupMaps,
    staleTime: 5 * 60 * 1000,
  });

  const onPickPdf = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      const maps = mapsQuery.data;
      if (!maps) {
        toast.error('Catalog is still loading — try again in a moment.');
        return;
      }
      setPdfName(file.name);
      setExtractBusy(true);
      try {
        const jpegBase64 = await renderPdfPagesToJpegBase64(file, 8);
        const extracted = await extractSupplierInvoiceFromJpegPages(jpegBase64);
        setInvoiceNumber(extracted.invoice_number ?? '');
        setInvoiceDate(extracted.invoice_date ?? '');
        const draft = buildInvoiceDraftRows(extracted.lines, maps, []);
        setDraftRows(draft);
        setSavedInvoiceId(null);
        setSavedPoId(null);
        if (draft.length === 0) toast.warning('No lines extracted — edit manually or retry.');
        else {
          const mapped = draft.filter((r) => r.busy_code != null).length;
          const needBusy = draft.length - mapped;
          toast.success(
            needBusy > 0
              ? `Extracted ${draft.length} lines — ${mapped} matched items.alias / busy_code, ${needBusy} need Busy filled.`
              : `Extracted ${draft.length} lines — all rows matched catalog.`,
          );
        }
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : 'PDF / OCR failed');
      } finally {
        setExtractBusy(false);
      }
    },
    [toast, mapsQuery.data],
  );

  const saveMut = useMutation({
    mutationFn: () => {
      const supplier = supplierName.trim();
      if (!supplier) throw new Error('Enter supplier name');
      if (draftRows.length === 0) throw new Error('Upload and extract an invoice first');
      const missingBusy = draftRows.some((r) => r.busy_code == null || !Number.isFinite(Number(r.busy_code)));
      if (missingBusy) throw new Error('Every line needs a busy code before saving');
      return createPurchaseOrderFromInvoiceDraft({
        supplier_name: supplier,
        invoice_number: invoiceNumber || null,
        invoice_date: invoiceDate || null,
        file_name: pdfName || null,
        raw_extract_json: { draftRows, invoiceNumber, invoiceDate, supplierName },
        lines: draftRows.map((r) => ({
          busy_code: Number(r.busy_code),
          description_snapshot: r.description_raw?.trim() || r.part_no_raw?.trim() || `Line ${r.line_no}`,
          qty_billed: r.qty_billed,
          rate_per_ea: r.rate_per_ea,
          part_no_raw: r.part_no_raw,
          description_raw: r.description_raw,
        })),
        userId: userId ?? null,
        userName: userName ?? null,
      });
    },
    onSuccess: async (r) => {
      setSavedInvoiceId(r.supplier_invoice_id);
      setSavedPoId(r.purchase_order_id);
      await qc.invalidateQueries({ queryKey: PURCHASE_ORDERS_QUERY_KEY });
      await qc.invalidateQueries({ queryKey: purchaseOrderDetailKey(r.purchase_order_id) });
      await qc.invalidateQueries({ queryKey: ['purchase', 'po', r.purchase_order_id, 'lines'] });
      await qc.invalidateQueries({ queryKey: ['purchase', 'po', r.purchase_order_id, 'latest_invoice'] });
      toast.success(`Saved · ${r.po_number}`);
    },
    onError: (e: Error) => toast.error(e.message || 'Could not create PO from invoice'),
  });

  const recvMut = useMutation({
    mutationFn: () => {
      const id = savedInvoiceId;
      if (id == null) throw new Error('Save invoice first');
      return createReceivingJobFromInvoice(id, userId ?? null, userName ?? null);
    },
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: RECEIVING_JOBS_QUERY_KEY });
      toast.success(`Receiving ${r.job_public_id}`);
      navigate(`/admin/receiving/${r.receiving_job_id}`);
    },
    onError: (e: Error) => toast.error(e.message || 'Could not start receiving'),
  });

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
          <h1 className="text-lg font-bold text-[var(--content-primary)]">New from supplier invoice PDF</h1>
          <p className="mt-2 text-sm text-[var(--content-secondary)]">
            Upload a PDF (first 8 pages). OCR fills qty to receive and supplier billing rate per line (not MRP). Busy codes
            resolve from your Items catalog (busy_code, alias, alias1); fix any rows that do not auto-match.
          </p>

          <label className="mt-4 block text-xs font-semibold">
            Supplier name (required)
            <input
              value={supplierName}
              onChange={(e) => setSupplierName(e.target.value)}
              className="mt-1 min-h-10 w-full max-w-md rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 text-sm"
              placeholder="Supplier / vendor name"
              autoComplete="organization"
            />
          </label>

          <input
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            id="inv-pdf-new-input"
            onChange={(e) => {
              void onPickPdf(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <BigButton
            type="button"
            variant="secondary"
            className="mt-4 min-h-11"
            disabled={extractBusy || mapsQuery.isLoading || mapsQuery.isError}
            onClick={() => document.getElementById('inv-pdf-new-input')?.click()}
          >
            <FilePdf size={20} weight="bold" className="mr-2 inline" />
            {extractBusy ? 'Extracting…' : 'Choose PDF'}
          </BigButton>
          {pdfName ? <p className="mt-2 text-xs text-[var(--content-tertiary)]">{pdfName}</p> : null}

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-semibold">
              Invoice number
              <input
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
                className="mt-1 min-h-10 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 text-sm"
              />
            </label>
            <label className="block text-xs font-semibold">
              Invoice date
              <input
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
                className="mt-1 min-h-10 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 text-sm"
                placeholder="YYYY-MM-DD"
              />
            </label>
          </div>
        </div>

        {draftRows.length > 0 ? (
          <div className="overflow-x-auto rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
            <table className="w-full min-w-[1080px] text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] text-xs uppercase text-[var(--content-tertiary)]">
                  <th className="p-2">#</th>
                  <th className="p-2">Part</th>
                  <th className="p-2">Description</th>
                  <th className="p-2">Qty to receive</th>
                  <th className="p-2">Billing rate / ea</th>
                  <th className="p-2">Busy</th>
                  <th className="p-2">Catalog</th>
                </tr>
              </thead>
              <tbody>
                {draftRows.map((r, idx) => (
                  <tr key={r.line_no} className="border-b border-[var(--border-subtle)]">
                    <td className="p-2">{r.line_no}</td>
                    <td className="p-2">
                      <input
                        value={r.part_no_raw}
                        className="min-h-9 w-full rounded border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2 font-mono text-xs"
                        onChange={(e) => {
                          const v = e.target.value;
                          setDraftRows((prev) =>
                            prev.map((x, i) =>
                              i === idx ? { ...x, part_no_raw: v, resolved_item_name: null, resolution_warning: null } : x,
                            ),
                          );
                        }}
                      />
                    </td>
                    <td className="p-2">
                      <input
                        value={r.description_raw}
                        className="min-h-9 w-full rounded border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2 text-xs"
                        onChange={(e) => {
                          const v = e.target.value;
                          setDraftRows((prev) =>
                            prev.map((x, i) =>
                              i === idx ? { ...x, description_raw: v, resolved_item_name: null, resolution_warning: null } : x,
                            ),
                          );
                        }}
                      />
                    </td>
                    <td className="p-2">
                      <input
                        type="number"
                        min={0}
                        value={r.qty_billed}
                        className="min-h-9 w-20 rounded border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2 font-mono text-xs"
                        onChange={(e) => {
                          const v = Math.max(0, Number(e.target.value) || 0);
                          setDraftRows((prev) => prev.map((x, i) => (i === idx ? { ...x, qty_billed: v } : x)));
                        }}
                      />
                    </td>
                    <td className="p-2">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={r.rate_per_ea ?? ''}
                        className="min-h-9 w-24 rounded border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2 font-mono text-xs"
                        onChange={(e) => {
                          const raw = e.target.value;
                          const v = raw === '' ? null : Number(raw);
                          setDraftRows((prev) =>
                            prev.map((x, i) =>
                              i === idx ? { ...x, rate_per_ea: v != null && Number.isFinite(v) ? v : null } : x,
                            ),
                          );
                        }}
                      />
                    </td>
                    <td className="p-2">
                      <input
                        type="number"
                        value={r.busy_code ?? ''}
                        className="min-h-9 w-28 rounded border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2 font-mono text-xs"
                        onChange={(e) => {
                          const raw = e.target.value;
                          const bc = raw === '' ? null : Number(raw);
                          const maps = mapsQuery.data;
                          const validBc = bc != null && Number.isFinite(bc) ? bc : null;
                          const itemName =
                            validBc != null && maps ? maps.byBusy.get(validBc)?.name ?? null : null;
                          setDraftRows((prev) =>
                            prev.map((x, i) =>
                              i === idx
                                ? {
                                    ...x,
                                    busy_code: validBc,
                                    purchase_order_line_id: null,
                                    resolved_item_name: itemName,
                                    resolution_warning: null,
                                  }
                                : x,
                            ),
                          );
                        }}
                      />
                    </td>
                    <td className="max-w-[220px] p-2 align-top">
                      {r.resolved_item_name ? (
                        <p className="text-xs text-[var(--content-secondary)]">{r.resolved_item_name}</p>
                      ) : (
                        <p className="text-xs text-[var(--content-tertiary)]">—</p>
                      )}
                      {r.resolution_warning ? (
                        <p className="mt-1 text-xs text-[var(--content-warning)]">{r.resolution_warning}</p>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-[var(--content-tertiary)]">Upload a PDF to populate lines.</p>
        )}

        <div className="flex flex-wrap gap-2">
          <BigButton
            type="button"
            variant="secondary"
            disabled={saveMut.isPending || draftRows.length === 0}
            onClick={() => saveMut.mutate()}
          >
            Save and create PO
          </BigButton>
          <BigButton
            type="button"
            variant="secondary"
            disabled={savedPoId == null}
            onClick={() => savedPoId != null && navigate(`/purchase/po/${savedPoId}`)}
          >
            Open PO
          </BigButton>
          <BigButton
            type="button"
            variant="primary"
            className="bg-[var(--bg-accent)] text-[var(--content-on-color)]"
            disabled={recvMut.isPending || savedInvoiceId == null}
            onClick={() => recvMut.mutate()}
          >
            Start receiving job
          </BigButton>
        </div>
      </div>
    </div>
  );
}
