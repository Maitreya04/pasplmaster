import { useMemo, useState, type ReactElement } from 'react';
import { useMutation } from '@tanstack/react-query';
import { PrinterIcon, Trash } from '@phosphor-icons/react';
import { BigButton } from '../../../components/shared';
import { useToast } from '../../../context/ToastContext';
import { computeLabelPlan, formatPackDefinitionHint } from '../../../lib/labelStudio/computeLabelPlan';
import { shouldBlockJobOnUnmapped } from '../../../lib/labelStudio/resolveSupplier';
import {
  convertReceivingLineToStructured,
  deleteReceivingJobLine,
  fetchLicensePlatesForLine,
  receivingPrintInnerLabels,
  receivingPrintMasterLabels,
  receivingTryRollUpPoForJobLine,
  updateReceivingJobLineRatio,
  upsertPackDefinitionFromReceiving,
} from '../../../lib/receiving/receivingApi';
import {
  openReceivingBulkLabelsPrint,
  type ReceivingPrintPlate,
} from '../../../lib/receiving/receivingPrintUtils';
import { submitBinCount } from '../../../lib/wms';
import type { Item, ItemPackDefinition } from '../../../types';
import type { ReceivingJobLineRow, ReceivingJobRow } from '../../../types/receiving';

function catalogPackHint(def: ItemPackDefinition | undefined): string | null {
  if (!def) return null;
  return formatPackDefinitionHint({
    innerPackQty: def.inner_pack_qty,
    outerPackQty: def.outer_pack_qty,
  });
}

/** @deprecated Use ReceivingGrnLineCard inside ReceivingGrnTable */
export function ReceivingSkuCard({
  line,
  job,
  jobId,
  catalogItem,
  packDef,
  userId,
  userName,
  onUpdated,
}: {
  line: ReceivingJobLineRow;
  job: ReceivingJobRow;
  jobId: number;
  catalogItem: Item | null;
  packDef: ItemPackDefinition | undefined;
  userId: number | null;
  userName: string | null;
  onUpdated: () => void;
}): ReactElement {
  const toast = useToast();
  const isStructured = line.receive_mode === 'structured';
  const isInnerOnly = line.receive_mode === 'inner_only';

  const [outerLabels, setOuterLabels] = useState(
    String(isStructured ? line.master_labels_count || line.master_carton_qty || '' : ''),
  );
  const [innerLabels, setInnerLabels] = useState(String(line.inner_labels_count || line.inner_pack_count || ''));
  const [pieceLabels, setPieceLabels] = useState(String(line.each_labels_count || ''));
  const [pcsPerInner, setPcsPerInner] = useState(String(line.ea_per_inner || packDef?.inner_pack_qty || ''));
  const [innersPerOuter, setInnersPerOuter] = useState(
    line.inner_per_master != null ? String(line.inner_per_master) : '',
  );
  const [looseEa, setLooseEa] = useState(String(line.total_ea || ''));
  const [targetBin, setTargetBin] = useState(line.loose_target_bin_id ?? '');

  const invoiceBlocked = shouldBlockJobOnUnmapped(job.triggered_by, line.supplier_code_status);
  const poExpectedEa =
    line.po_qty_expected_ea != null && line.po_qty_expected_ea > 0 ? line.po_qty_expected_ea : null;
  const labelsPrinted = Boolean(line.master_labels_printed_at || line.inner_labels_printed_at);
  const countsSaved = Boolean(line.ratio_verified_at);

  const preview = useMemo(() => {
    const pcs = Math.max(1, Math.floor(Number(pcsPerInner) || 1));
    return computeLabelPlan({
      receiveMode: line.receive_mode,
      outerLabels: isStructured ? Number(outerLabels) || 0 : 0,
      innerLabels: Number(innerLabels) || 0,
      pieceLabels: Number(pieceLabels) || 0,
      pcsPerInner: pcs,
      looseTotalEa: Number(looseEa) || 0,
    });
  }, [line.receive_mode, outerLabels, innerLabels, pieceLabels, pcsPerInner, looseEa, isStructured]);

  const saveAndPrintMut = useMutation({
    mutationFn: async () => {
      if (preview.masterLabelsCount + preview.innerLabelsCount + preview.eachLabelsCount <= 0) {
        throw new Error('plan_invalid');
      }
      const innerN = preview.innerLabelsCount;
      const pcs = preview.eaPerInner;
      if (innerN > 0 && pcs <= 0) throw new Error('pcs_required');

      const ipmVal =
        innersPerOuter.trim() !== '' ? Math.max(0, Math.floor(Number(innersPerOuter))) : null;

      await updateReceivingJobLineRatio(line.id, {
        master_carton_qty: preview.masterCartonQty,
        inner_per_master: ipmVal,
        inner_pack_count: preview.innerPackCount,
        ea_per_inner: pcs,
        total_ea: preview.totalEa,
        master_labels_count: preview.masterLabelsCount,
        inner_labels_count: preview.innerLabelsCount,
        each_labels_count: preview.eachLabelsCount,
        ratio_matches_master: null,
        ratio_verified_at: new Date().toISOString(),
        ratio_verified_by_user_id: userId,
        ratio_verified_by_name: userName,
        loose_target_bin_id: line.receive_mode === 'loose' ? targetBin.trim().toUpperCase() || null : null,
      });

      if (line.receive_mode === 'loose' && targetBin.trim()) {
        await submitBinCount({
          binId: targetBin.trim().toUpperCase(),
          skuBusyCode: Number(line.busy_code),
          innerPacks: 0,
          looseEaQty: preview.totalEa,
          innerPackQty: pcs,
          dailyTarget: null,
          reorderPoint: null,
          countType: 'initial_setup',
          userId,
          userName,
          note: `Loose receive job ${jobId} line ${line.line_no}`,
        });
      }

      if (pcs > 0 && (innerN > 0 || preview.masterLabelsCount > 0)) {
        await upsertPackDefinitionFromReceiving({
          busyCode: Number(line.busy_code),
          itemName: line.sku_description_snapshot,
          itemId: catalogItem?.id ?? null,
          pcsPerInner: pcs,
          innersPerOuter: ipmVal,
        });
      }

      if (preview.masterLabelsCount > 0 && !line.master_labels_printed_at) {
        const r = await receivingPrintMasterLabels(line.id, userId, userName);
        if (!r.success) throw new Error(r.reason ?? 'master_print');
      }
      if (preview.innerLabelsCount > 0 && !line.inner_labels_printed_at) {
        const r = await receivingPrintInnerLabels(line.id, userId, userName);
        if (!r.success) throw new Error(r.reason ?? 'inner_print');
      }

      const plates = (await fetchLicensePlatesForLine(line.id)) as ReceivingPrintPlate[];
      const pieceCount = labelsPrinted
        ? line.each_labels_count
        : preview.eachLabelsCount;

      await openReceivingBulkLabelsPrint({
        documentTitle: `Labels ${job.job_public_id ?? ''} · ${line.busy_code}`,
        jobPublicId: job.job_public_id,
        envelopeCode: job.envelope_code,
        poRef: job.po_ref,
        lineBusyCode: Number(line.busy_code),
        skuDescription: line.sku_description_snapshot,
        lotNo: line.lot_no,
        plates,
        pieceLabelCount: pieceCount,
        catalogItem,
      });

      if (line.purchase_order_line_id != null) {
        await receivingTryRollUpPoForJobLine(line.id);
      }
    },
    onSuccess: () => {
      toast.success('Saved and opened print');
      onUpdated();
    },
    onError: (e: Error) => {
      if (e.message === 'plan_invalid') {
        toast.error('Enter at least one label count.');
        return;
      }
      if (e.message === 'pcs_required') {
        toast.error('Pieces per inner is required when printing inner labels.');
        return;
      }
      if (e.message === 'master_labels_already_printed') {
        toast.error('Outer labels were already created. Use Reprint, or refresh the page.');
        return;
      }
      if (e.message.includes('No input text')) {
        toast.error('This SKU has no scan alias in the catalog. Add alias1 or alias, then try again.');
        return;
      }
      toast.error(e.message || 'Could not save or print');
    },
  });

  const reprintMut = useMutation({
    mutationFn: async () => {
      const plates = (await fetchLicensePlatesForLine(line.id)) as ReceivingPrintPlate[];
      await openReceivingBulkLabelsPrint({
        documentTitle: `Reprint ${job.job_public_id ?? ''}`,
        jobPublicId: job.job_public_id,
        envelopeCode: job.envelope_code,
        poRef: job.po_ref,
        lineBusyCode: Number(line.busy_code),
        skuDescription: line.sku_description_snapshot,
        lotNo: line.lot_no,
        plates,
        pieceLabelCount: line.each_labels_count,
        catalogItem,
      });
    },
    onError: () => toast.error('Nothing to reprint'),
  });

  const convertMut = useMutation({
    mutationFn: () => convertReceivingLineToStructured(line),
    onSuccess: () => {
      toast.success('Enter label counts below.');
      onUpdated();
    },
    onError: () => toast.error('Could not switch'),
  });

  const hint = catalogPackHint(packDef);
  const supplierLabel =
    line.supplier_code_status === 'UNMAPPED'
      ? 'UNMAPPED'
      : (line.supplier_code_resolved ?? line.supplier_code_status);

  const showPackSize = isStructured || isInnerOnly;

  return (
    <div className="mb-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-mono text-sm font-bold">
            {line.busy_code} · {line.sku_description_snapshot}
          </p>
          <p className="mt-1 text-xs text-[var(--content-tertiary)]">
            Lot {line.lot_no}
            {poExpectedEa != null ? (
              <>
                {' '}
                · PO expects <span className="font-mono font-semibold">{poExpectedEa} pcs</span> (compare after save)
              </>
            ) : null}
          </p>
          {invoiceBlocked ? (
            <p className="mt-1 text-xs text-amber-800 dark:text-amber-200">
              Invoice job: map supplier barcode before printing.
            </p>
          ) : null}
        </div>
        <button
          type="button"
          className="text-xs text-red-600 hover:underline disabled:opacity-40"
          disabled={labelsPrinted}
          onClick={() => {
            if (!labelsPrinted && window.confirm('Remove this line?')) {
              void deleteReceivingJobLine(line.id).then(() => onUpdated());
            }
          }}
        >
          <Trash size={16} className="inline" /> Remove
        </button>
      </div>

      {line.receive_mode === 'loose' ? (
        <>
          {line.purchase_order_line_id != null && !labelsPrinted ? (
            <BigButton
              type="button"
              variant="secondary"
              className="mt-3 w-full min-h-10 text-sm"
              disabled={convertMut.isPending}
              onClick={() => convertMut.mutate()}
            >
              Switch to carton labels
            </BigButton>
          ) : null}
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <label className="text-xs font-semibold">
              Total pieces
              <input
                value={looseEa}
                onChange={(e) => setLooseEa(e.target.value.replace(/[^\d]/g, ''))}
                className="mt-1 min-h-10 w-full rounded-lg border border-[var(--border-subtle)] px-2 font-mono"
              />
            </label>
            <label className="text-xs font-semibold">
              BIN
              <input
                value={targetBin}
                onChange={(e) => setTargetBin(e.target.value)}
                className="mt-1 min-h-10 w-full rounded-lg border border-[var(--border-subtle)] px-2 font-mono uppercase"
              />
            </label>
          </div>
          <BigButton
            type="button"
            variant="secondary"
            className="mt-3 w-full min-h-11"
            disabled={saveAndPrintMut.isPending}
            onClick={() => saveAndPrintMut.mutate()}
          >
            Save &amp; post to BIN
          </BigButton>
        </>
      ) : (
        <>
          <p className="mt-3 text-sm font-semibold text-[var(--content-primary)]">How many labels to print?</p>
          {hint ? <p className="mt-1 text-xs text-[var(--content-tertiary)]">{hint}</p> : null}
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {isStructured ? (
              <label className="text-xs font-semibold">
                Outer labels
                <input
                  value={outerLabels}
                  readOnly={labelsPrinted}
                  onChange={(e) => setOuterLabels(e.target.value.replace(/[^\d]/g, ''))}
                  className="mt-1 min-h-10 w-full rounded-lg border border-[var(--border-subtle)] px-2 font-mono"
                  placeholder="30"
                  inputMode="numeric"
                />
              </label>
            ) : null}
            <label className="text-xs font-semibold">
              Inner labels
              <input
                value={innerLabels}
                readOnly={labelsPrinted}
                onChange={(e) => setInnerLabels(e.target.value.replace(/[^\d]/g, ''))}
                className="mt-1 min-h-10 w-full rounded-lg border border-[var(--border-subtle)] px-2 font-mono"
                placeholder="5"
                inputMode="numeric"
              />
            </label>
            <label className="text-xs font-semibold">
              Piece labels
              <input
                value={pieceLabels}
                readOnly={labelsPrinted}
                onChange={(e) => setPieceLabels(e.target.value.replace(/[^\d]/g, ''))}
                className="mt-1 min-h-10 w-full rounded-lg border border-[var(--border-subtle)] px-2 font-mono"
                placeholder="25"
                inputMode="numeric"
              />
            </label>
          </div>

          {showPackSize ? (
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <label className="text-xs font-semibold">
                Pieces per inner box
                <input
                  value={pcsPerInner}
                  readOnly={labelsPrinted}
                  onChange={(e) => setPcsPerInner(e.target.value.replace(/[^\d]/g, ''))}
                  className="mt-1 min-h-10 w-full rounded-lg border border-[var(--border-subtle)] px-2 font-mono"
                  placeholder="20"
                  inputMode="numeric"
                />
              </label>
              {isStructured ? (
                <label className="text-xs font-semibold">
                  Inners per outer (for scans)
                  <input
                    value={innersPerOuter}
                    readOnly={labelsPrinted}
                    onChange={(e) => setInnersPerOuter(e.target.value.replace(/[^\d]/g, ''))}
                    className="mt-1 min-h-10 w-full rounded-lg border border-[var(--border-subtle)] px-2 font-mono"
                    placeholder="6"
                    inputMode="numeric"
                  />
                </label>
              ) : null}
            </div>
          ) : null}

          <p className="mt-2 text-sm text-[var(--content-secondary)]">
            Printing:{' '}
            <span className="font-mono font-semibold">
              {isStructured ? `${preview.masterLabelsCount} outer · ` : ''}
              {preview.innerLabelsCount} inner · {preview.eachLabelsCount} piece
            </span>
            {' · ≈ '}
            <span className="font-mono font-semibold">{preview.totalEa} pcs</span>
          </p>

          <BigButton
            type="button"
            variant="primary"
            className="mt-3 w-full min-h-11 bg-[var(--bg-accent)] text-[var(--content-on-color)]"
            disabled={
              saveAndPrintMut.isPending ||
              invoiceBlocked ||
              labelsPrinted ||
              preview.masterLabelsCount + preview.innerLabelsCount + preview.eachLabelsCount <= 0
            }
            onClick={() => saveAndPrintMut.mutate()}
          >
            <PrinterIcon className="mr-1 inline" size={18} />
            Save &amp; print all
          </BigButton>
          {labelsPrinted ? (
            <BigButton
              type="button"
              variant="secondary"
              className="mt-2 w-full min-h-10"
              disabled={reprintMut.isPending}
              onClick={() => reprintMut.mutate()}
            >
              Reprint all labels
            </BigButton>
          ) : null}
          {countsSaved && !labelsPrinted ? (
            <p className="mt-1 text-xs text-[var(--content-tertiary)]">Counts saved — tap print to create labels.</p>
          ) : null}
        </>
      )}

      <p className="mt-3 text-xs text-[var(--content-tertiary)]">
        Supplier barcode: <span className="font-mono">{supplierLabel}</span>
      </p>
    </div>
  );
}
