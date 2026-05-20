import { useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import { ArrowLeft, FileXls } from '@phosphor-icons/react';
import { BigButton } from '../../components/shared';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { detectFileType } from '../../lib/import/fileDetector';
import {
  buildPurchasePoPreviewRows,
  parsePurchasePoSheet,
  resolvePurchasePoRows,
  type PurchasePoPreviewRow,
} from '../../lib/import/purchasePoImporter';
import {
  aggregateQtyPoByItemId,
  createPurchaseOrderWithLines,
  fetchSuggestedQtyByBusyCode,
  PURCHASE_ORDERS_QUERY_KEY,
  purchaseOrderDetailKey,
  purchaseOrderLinesKey,
} from '../../lib/purchase/purchaseApi';
import { groupOpenPoDemandByItemId } from '../../lib/purchase/openPoDemand';
import { useOpenPoDemandLines } from '../../hooks/useOpenPoDemandLines';
import { useLocationwiseStock } from '../../hooks/useLocationwiseStock';
import { PurchasePoPreviewTable } from './PurchasePoPreviewTable';

type Step = 'pick' | 'preview';

export default function PurchaseNewPoPage(): React.JSX.Element {
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const { userId, userName } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const demandQuery = useOpenPoDemandLines();

  const [step, setStep] = useState<Step>('pick');
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<PurchasePoPreviewRow[]>([]);
  const [supplierName, setSupplierName] = useState('');

  const busyCodes = useMemo(
    () => rows.map((r) => r.resolvedBusyCode).filter((c): c is number => c != null && Number.isFinite(c)),
    [rows],
  );
  const stockQuery = useLocationwiseStock(busyCodes);

  const demandByItemId = useMemo(
    () => groupOpenPoDemandByItemId(demandQuery.data ?? []),
    [demandQuery.data],
  );

  const parseFile = useCallback(
    async (file: File) => {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array' });
      const det = detectFileType(wb);
      if (det.type !== 'purchase_po') {
        toast.error(
          'Not a purchase PO file. Need Item Name or Description (or Part no / Alias) and a qty column (e.g. Final Order Qty, ORD, Qty).',
        );
        return;
      }
      const raw = parsePurchasePoSheet(wb, det.headerRowIndex);
      const resolved = await resolvePurchasePoRows(raw);
      const demandMap = aggregateQtyPoByItemId(demandQuery.data ?? []);
      const suggestedByBusy = await fetchSuggestedQtyByBusyCode(demandMap);
      const previewRows = buildPurchasePoPreviewRows(resolved, suggestedByBusy);

      setFileName(file.name);
      setRows(previewRows);
      setStep('preview');
      if (resolved.some((r) => r.warning)) {
        toast.warning('Some rows did not match catalog — fix or remove before confirm.');
      }
    },
    [toast, demandQuery.data],
  );

  const updateRowQty = useCallback((rowIndex: number, orderQty: number) => {
    setRows((prev) => prev.map((r) => (r.rowIndex === rowIndex ? { ...r, orderQty } : r)));
  }, []);

  const createMut = useMutation({
    mutationFn: async () => {
      const demandMap = aggregateQtyPoByItemId(demandQuery.data ?? []);
      const suggestedByBusy = await fetchSuggestedQtyByBusyCode(demandMap);
      const okRows = rows.filter((r) => r.resolvedBusyCode != null);
      if (okRows.length === 0) throw new Error('no_lines');
      const lines = okRows.map((r) => {
        const bc = r.resolvedBusyCode!;
        const suggested = suggestedByBusy.get(bc) ?? null;
        return {
          busy_code: bc,
          description_snapshot: r.descriptionRaw || r.resolvedItemName || String(bc),
          qty_ordered: r.orderQty,
          suggested_qty_from_demand: suggested,
        };
      });
      const withQty = lines.filter((l) => l.qty_ordered > 0);
      if (withQty.length === 0) throw new Error('zero_qty');
      return createPurchaseOrderWithLines({
        supplier_name: supplierName.trim() || null,
        source: 'excel_upload',
        lines: withQty,
        userId: userId ?? null,
        userName: userName ?? null,
      });
    },
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: PURCHASE_ORDERS_QUERY_KEY });
      await qc.invalidateQueries({ queryKey: purchaseOrderDetailKey(r.purchase_order_id) });
      await qc.invalidateQueries({ queryKey: purchaseOrderLinesKey(r.purchase_order_id) });
      toast.success(`Created ${r.po_number} — open the PO and tap Start receiving (PO) to dock it`);
      navigate(`/purchase/po/${r.purchase_order_id}`);
    },
    onError: (e: Error) => {
      if (e.message === 'no_lines') toast.error('No rows with resolved Part numbers.');
      else if (e.message === 'zero_qty') toast.error('Every line has qty 0 — increase order qty on mapped rows.');
      else toast.error(e.message || 'Could not create PO');
    },
  });

  const matchedCount = rows.filter((r) => r.resolvedBusyCode != null).length;

  return (
    <div className="role-admin min-h-screen bg-[var(--bg-primary)] px-4 py-6 lg:px-6">
      <div className={step === 'preview' ? 'mx-auto max-w-[min(100%,80rem)]' : 'mx-auto max-w-3xl'}>
        <button
          type="button"
          onClick={() => navigate('/purchase')}
          className="mb-4 inline-flex items-center gap-1 text-sm text-[var(--content-secondary)] hover:text-[var(--content-primary)]"
        >
          <ArrowLeft size={18} weight="bold" />
          Purchase orders
        </button>

        {step === 'pick' ? (
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-6">
            <h1 className="text-xl font-bold text-[var(--content-primary)]">New PO from Excel</h1>
            <p className="mt-2 text-sm text-[var(--content-secondary)]">
              Upload your supplier sheet, then edit quantities in a spreadsheet-style table with stock and
              pending order context.
            </p>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void parseFile(f);
                e.target.value = '';
              }}
            />
            <BigButton
              type="button"
              variant="primary"
              className="mt-6 w-full min-h-12 bg-[var(--bg-accent)] text-[var(--content-on-color)]"
              onClick={() => inputRef.current?.click()}
            >
              <FileXls size={22} weight="bold" className="mr-2 inline" />
              Choose Excel file
            </BigButton>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4">
              <h1 className="text-lg font-bold text-[var(--content-primary)]">Preview · {fileName}</h1>
              <p className="mt-1 text-sm text-[var(--content-secondary)]">
                {matchedCount} of {rows.length} lines mapped · edit <strong>Order qty</strong> in the table
              </p>
              <label className="mt-3 block text-xs font-semibold text-[var(--content-tertiary)]">
                Supplier name (optional)
              </label>
              <input
                value={supplierName}
                onChange={(e) => setSupplierName(e.target.value)}
                className="mt-1 min-h-10 max-w-md rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 text-sm"
                placeholder="Supplier"
              />
            </div>

            <PurchasePoPreviewTable
              rows={rows}
              demandByItemId={demandByItemId}
              stockByBusyCode={stockQuery.data}
              stockFetching={stockQuery.isFetching}
              onOrderQtyChange={updateRowQty}
            />

            <div className="flex flex-wrap gap-2 pb-8">
              <BigButton type="button" variant="secondary" onClick={() => setStep('pick')}>
                Back
              </BigButton>
              <BigButton
                type="button"
                variant="primary"
                className="bg-[var(--bg-accent)] text-[var(--content-on-color)]"
                disabled={createMut.isPending}
                onClick={() => createMut.mutate()}
              >
                Create PO
              </BigButton>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
