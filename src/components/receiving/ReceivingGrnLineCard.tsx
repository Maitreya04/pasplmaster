import { useMemo, useState, type ReactElement } from 'react';
import { useMutation } from '@tanstack/react-query';
import { CaretDown, CaretRight, PrinterIcon, Trash } from '@phosphor-icons/react';
import { BigButton } from '../shared';
import { useToast } from '../../context/ToastContext';
import { computeLabelPlan, formatPackDefinitionHint } from '../../lib/labelStudio/computeLabelPlan';
import { shouldBlockJobOnUnmapped } from '../../lib/labelStudio/resolveSupplier';
import {
  deleteReceivingJobLine,
  fetchLicensePlatesForLine,
  receivingPrintInnerLabels,
  receivingPrintMasterLabels,
  receivingTryRollUpPoForJobLine,
  updateReceivingJobLineRatio,
  upsertPackDefinitionFromReceiving,
} from '../../lib/receiving/receivingApi';
import { deriveReceiveModeFromCounts } from '../../lib/receiving/receivingWorkflow';
import {
  openReceivingBulkLabelsPrint,
  type ReceivingPrintPlate,
} from '../../lib/receiving/receivingPrintUtils';
import { submitBinCount } from '../../lib/wms';
import type { Item, ItemPackDefinition } from '../../types';
import type { ReceivingJobLineRow, ReceivingJobRow } from '../../types/receiving';

export function ReceivingGrnLineCard({
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
  const isLoose = line.receive_mode === 'loose';

  const [bulkOnly, setBulkOnly] = useState(isLoose);
  const [masterLabels, setMasterLabels] = useState(
    String(line.master_labels_count > 0 ? line.master_labels_count : ''),
  );
  const [innerOpen, setInnerOpen] = useState(true);
  const [innerLabels, setInnerLabels] = useState(String(line.inner_labels_count || line.inner_pack_count || ''));
  const [pieceLabels, setPieceLabels] = useState(String(line.each_labels_count || ''));
  const [pcsPerInner, setPcsPerInner] = useState(
    line.ratio_verified_at
      ? String(line.ea_per_inner)
      : packDef?.inner_pack_qty
        ? String(packDef.inner_pack_qty)
        : '',
  );
  const [innersPerOuter, setInnersPerOuter] = useState(
    line.inner_per_master != null ? String(line.inner_per_master) : '',
  );
  const [looseEa, setLooseEa] = useState(String(line.total_ea || ''));
  const [targetBin, setTargetBin] = useState(line.loose_target_bin_id ?? '');
  const [dockNote, setDockNote] = useState(line.dock_damage_note ?? '');

  const masterN = bulkOnly ? 0 : Math.max(0, Math.floor(Number(masterLabels) || 0));
  const receiveMode = deriveReceiveModeFromCounts({ looseOnly: bulkOnly, masterLabels: masterN });
  const isStructured = receiveMode === 'structured';
  const mastersDone = Boolean(line.master_labels_printed_at);
  const breakupDone = Boolean(line.inner_labels_printed_at);
  const showMasterPhase = !bulkOnly && masterN > 0;
  const breakupUnlocked = bulkOnly || masterN === 0 || mastersDone;

  const invoiceBlocked = shouldBlockJobOnUnmapped(job.triggered_by, line.supplier_code_status);

  const pcsNum = Math.floor(Number(pcsPerInner));
  const pcsHint = Number.isFinite(pcsNum) && pcsNum > 0 ? pcsNum : null;
  const ipmNum = Math.floor(Number(innersPerOuter));
  const outerScanEa =
    pcsHint != null && Number.isFinite(ipmNum) && ipmNum > 0 ? ipmNum * pcsHint : null;

  const preview = useMemo(() => {
    const pcs = Math.max(1, pcsHint ?? 1);
    return computeLabelPlan({
      receiveMode,
      outerLabels: isStructured ? masterN : 0,
      innerLabels: Number(innerLabels) || 0,
      pieceLabels: Number(pieceLabels) || 0,
      pcsPerInner: pcs,
      looseTotalEa: Number(looseEa) || 0,
    });
  }, [receiveMode, masterN, innerLabels, pieceLabels, pcsHint, looseEa, isStructured]);

  const catalogHint = packDef
    ? formatPackDefinitionHint({
        innerPackQty: packDef.inner_pack_qty,
        outerPackQty: packDef.outer_pack_qty,
      })
    : null;

  const persistLine = async (patch: {
    master_labels_count: number;
    inner_labels_count: number;
    each_labels_count: number;
    ea_per_inner: number;
    inner_per_master: number | null;
    total_ea: number;
    ratio_verified?: boolean;
  }) => {
    await updateReceivingJobLineRatio(line.id, {
      receive_mode: receiveMode,
      master_carton_qty: patch.master_labels_count,
      inner_per_master: patch.inner_per_master,
      inner_pack_count: patch.inner_labels_count,
      ea_per_inner: patch.ea_per_inner,
      total_ea: patch.total_ea,
      master_labels_count: patch.master_labels_count,
      inner_labels_count: patch.inner_labels_count,
      each_labels_count: patch.each_labels_count,
      ratio_matches_master: null,
      ratio_verified_at: patch.ratio_verified !== false ? new Date().toISOString() : line.ratio_verified_at,
      ratio_verified_by_user_id: userId,
      ratio_verified_by_name: userName,
      loose_target_bin_id: bulkOnly ? targetBin.trim().toUpperCase() || null : null,
      dock_damage_note: dockNote.trim() || null,
    });
  };

  const printMastersMut = useMutation({
    mutationFn: async () => {
      if (masterN <= 0) throw new Error('no_masters');
      const pcs = pcsHint ?? 0;
      if (pcs <= 0) throw new Error('pcs_required');
      const ipmVal = innersPerOuter.trim() !== '' ? Math.max(1, Math.floor(Number(innersPerOuter))) : null;
      if (ipmVal == null || ipmVal <= 0) throw new Error('ipm_required');

      await persistLine({
        master_labels_count: masterN,
        inner_labels_count: Number(innerLabels) || 0,
        each_labels_count: Number(pieceLabels) || 0,
        ea_per_inner: pcs,
        inner_per_master: ipmVal,
        total_ea: preview.totalEa,
      });

      await upsertPackDefinitionFromReceiving({
        busyCode: Number(line.busy_code),
        itemName: line.sku_description_snapshot,
        itemId: catalogItem?.id ?? null,
        pcsPerInner: pcs,
        innersPerOuter: ipmVal,
      });

      const r = await receivingPrintMasterLabels(line.id, userId, userName);
      if (!r.success) throw new Error(r.reason ?? 'master_print');

      const plates = (await fetchLicensePlatesForLine(line.id)) as ReceivingPrintPlate[];
      await openReceivingBulkLabelsPrint({
        documentTitle: `Master labels · ${job.job_public_id ?? ''}`,
        jobPublicId: job.job_public_id,
        envelopeCode: job.envelope_code,
        poRef: job.po_ref,
        lineBusyCode: Number(line.busy_code),
        skuDescription: line.sku_description_snapshot,
        lotNo: line.lot_no,
        plates,
        pieceLabelCount: 0,
        catalogItem,
      });
    },
    onSuccess: () => {
      toast.success('Master labels printed — now count inner breakup');
      onUpdated();
    },
    onError: (e: Error) => {
      if (e.message === 'pcs_required') {
        toast.error('Enter pieces per inner before printing masters.');
        return;
      }
      if (e.message === 'ipm_required') {
        toast.error('Enter inners per outer so each master sticker shows the right qty.');
        return;
      }
      toast.error(e.message || 'Could not print masters');
    },
  });

  const printBreakupMut = useMutation({
    mutationFn: async () => {
      if (bulkOnly) {
        if (!targetBin.trim() || preview.totalEa <= 0) throw new Error('loose_invalid');
        await persistLine({
          master_labels_count: 0,
          inner_labels_count: 0,
          each_labels_count: 0,
          ea_per_inner: Math.max(1, pcsHint ?? 1),
          inner_per_master: null,
          total_ea: preview.totalEa,
        });
        await submitBinCount({
          binId: targetBin.trim().toUpperCase(),
          skuBusyCode: Number(line.busy_code),
          innerPacks: 0,
          looseEaQty: preview.totalEa,
          innerPackQty: pcsHint ?? 1,
          dailyTarget: null,
          reorderPoint: null,
          countType: 'initial_setup',
          userId,
          userName,
          note: `Loose receive job ${jobId} line ${line.line_no}`,
        });
        if (line.purchase_order_line_id != null) await receivingTryRollUpPoForJobLine(line.id);
        return;
      }

      const innerN = preview.innerLabelsCount;
      const pcs = preview.eaPerInner;
      if (innerN > 0 && pcs <= 0) throw new Error('pcs_required');
      if (preview.innerLabelsCount + preview.eachLabelsCount <= 0) throw new Error('plan_invalid');

      const ipmVal =
        innersPerOuter.trim() !== '' ? Math.max(0, Math.floor(Number(innersPerOuter))) : null;

      await persistLine({
        master_labels_count: preview.masterLabelsCount,
        inner_labels_count: preview.innerLabelsCount,
        each_labels_count: preview.eachLabelsCount,
        ea_per_inner: pcs,
        inner_per_master: ipmVal,
        total_ea: preview.totalEa,
      });

      if (pcs > 0 && (innerN > 0 || preview.masterLabelsCount > 0)) {
        await upsertPackDefinitionFromReceiving({
          busyCode: Number(line.busy_code),
          itemName: line.sku_description_snapshot,
          itemId: catalogItem?.id ?? null,
          pcsPerInner: pcs,
          innersPerOuter: ipmVal,
        });
      }

      if (innerN > 0 && !line.inner_labels_printed_at) {
        const r = await receivingPrintInnerLabels(line.id, userId, userName);
        if (!r.success) throw new Error(r.reason ?? 'inner_print');
      }

      const plates = (await fetchLicensePlatesForLine(line.id)) as ReceivingPrintPlate[];
      await openReceivingBulkLabelsPrint({
        documentTitle: `Breakup labels · ${job.job_public_id ?? ''}`,
        jobPublicId: job.job_public_id,
        envelopeCode: job.envelope_code,
        poRef: job.po_ref,
        lineBusyCode: Number(line.busy_code),
        skuDescription: line.sku_description_snapshot,
        lotNo: line.lot_no,
        plates,
        pieceLabelCount: preview.eachLabelsCount,
        catalogItem,
      });

      if (line.purchase_order_line_id != null) {
        await receivingTryRollUpPoForJobLine(line.id);
      }
    },
    onSuccess: () => {
      toast.success(bulkOnly ? 'Posted to BIN' : 'Breakup labels printed');
      onUpdated();
    },
    onError: (e: Error) => {
      if (e.message === 'plan_invalid') {
        toast.error('Enter inner or piece label counts.');
        return;
      }
      if (e.message === 'pcs_required') {
        toast.error('Pieces per inner is required when printing inner labels.');
        return;
      }
      if (e.message === 'loose_invalid') {
        toast.error('Enter total pieces and BIN.');
        return;
      }
      toast.error(e.message || 'Could not print breakup');
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

  const masterFieldsLocked = mastersDone;
  const breakupFieldsLocked = breakupDone;

  return (
    <div className="border-t border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 py-4 sm:px-4">
      {invoiceBlocked ? (
        <p className="mb-3 text-xs text-amber-800 dark:text-amber-200">
          Invoice job: map supplier barcode before printing.
        </p>
      ) : null}

      <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-[var(--content-secondary)]">
        <input
          type="checkbox"
          checked={bulkOnly}
          disabled={mastersDone || breakupDone}
          onChange={(e) => setBulkOnly(e.target.checked)}
          className="h-4 w-4 accent-[var(--role-primary)]"
        />
        Bulk only (no carton labels — post to BIN)
      </label>

      {bulkOnly ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <label className="text-xs font-semibold">
            Total pieces
            <input
              value={looseEa}
              readOnly={breakupFieldsLocked}
              onChange={(e) => setLooseEa(e.target.value.replace(/[^\d]/g, ''))}
              className="mt-1 min-h-11 w-full rounded-lg border border-[var(--border-subtle)] px-2 font-mono"
              inputMode="numeric"
            />
          </label>
          <label className="text-xs font-semibold">
            BIN
            <input
              value={targetBin}
              onChange={(e) => setTargetBin(e.target.value)}
              className="mt-1 min-h-11 w-full rounded-lg border border-[var(--border-subtle)] px-2 font-mono uppercase"
            />
          </label>
          <BigButton
            type="button"
            variant="primary"
            className="sm:col-span-2 min-h-11 bg-[var(--bg-accent)] text-[var(--content-on-color)]"
            disabled={printBreakupMut.isPending || invoiceBlocked}
            onClick={() => printBreakupMut.mutate()}
          >
            Save &amp; post to BIN
          </BigButton>
        </div>
      ) : (
        <>
          {showMasterPhase ? (
            <div className="mt-4 rounded-xl border-2 border-[var(--role-primary)]/30 bg-[var(--bg-accent-subtle)]/40 p-3">
              <p className="text-sm font-bold text-[var(--content-primary)]">
                Step 1 — Master cartons (gate)
              </p>
              <p className="mt-1 text-xs text-[var(--content-secondary)]">
                Count sealed master cartons on the dock. Print and stick master labels before opening
                anything.
              </p>
              <label className="mt-3 block text-xs font-semibold uppercase text-[var(--content-tertiary)]">
                Master cartons on floor
                <input
                  value={masterLabels}
                  readOnly={masterFieldsLocked}
                  onChange={(e) => setMasterLabels(e.target.value.replace(/[^\d]/g, ''))}
                  className="mt-1 min-h-11 w-full max-w-[8rem] rounded-lg border border-[var(--border-subtle)] px-2 font-mono text-base"
                  inputMode="numeric"
                />
              </label>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <label className="block text-xs font-semibold">
                  Pcs per inner box
                  <input
                    value={pcsPerInner}
                    readOnly={masterFieldsLocked}
                    onChange={(e) => setPcsPerInner(e.target.value.replace(/[^\d]/g, ''))}
                    className="mt-1 min-h-11 w-full rounded-lg border border-[var(--border-subtle)] px-2 font-mono"
                    placeholder="20"
                    inputMode="numeric"
                  />
                  {pcsHint != null ? (
                    <span className="mt-1 block text-[11px] text-[var(--content-tertiary)]">
                      Each inner holds {pcsHint} pcs · inner scan at pick +{pcsHint} ea
                    </span>
                  ) : (
                    <span className="mt-1 block text-[11px] text-[var(--content-tertiary)]">
                      Required before master print (sets qty on sticker)
                    </span>
                  )}
                </label>
                <label className="block text-xs font-semibold">
                  Inners per master
                  <input
                    value={innersPerOuter}
                    readOnly={masterFieldsLocked}
                    onChange={(e) => setInnersPerOuter(e.target.value.replace(/[^\d]/g, ''))}
                    className="mt-1 min-h-11 w-full rounded-lg border border-[var(--border-subtle)] px-2 font-mono"
                    placeholder="6"
                    inputMode="numeric"
                  />
                  {outerScanEa != null ? (
                    <span className="mt-1 block text-[11px] text-[var(--content-tertiary)]">
                      Each master scan at pick +{outerScanEa} ea
                    </span>
                  ) : (
                    <span className="mt-1 block text-[11px] text-[var(--content-tertiary)]">
                      How many inner boxes fit in one master
                    </span>
                  )}
                </label>
              </div>
              <BigButton
                type="button"
                variant="primary"
                className="mt-3 w-full min-h-11 bg-[var(--bg-accent)] text-[var(--content-on-color)]"
                disabled={
                  printMastersMut.isPending ||
                  invoiceBlocked ||
                  masterFieldsLocked ||
                  masterN <= 0
                }
                onClick={() => printMastersMut.mutate()}
              >
                <PrinterIcon className="mr-1 inline" size={18} />
                {mastersDone ? 'Masters printed' : `Print ${masterN} master label${masterN === 1 ? '' : 's'}`}
              </BigButton>
            </div>
          ) : (
            <p className="mt-3 text-xs text-[var(--content-tertiary)]">
              No master cartons (2-level) — go straight to inner breakup below.
            </p>
          )}

          <div
            className={`mt-4 rounded-lg border border-[var(--border-subtle)] ${
              !breakupUnlocked ? 'opacity-50 pointer-events-none' : ''
            }`}
          >
            <p className="border-b border-[var(--border-subtle)] px-3 py-2 text-sm font-bold text-[var(--content-primary)]">
              Step 2 — Breakup (inner + piece)
            </p>
            {!breakupUnlocked ? (
              <p className="px-3 py-3 text-xs text-[var(--content-tertiary)]">
                Print master labels in Step 1 first.
              </p>
            ) : (
              <div className="p-3">
                <p className="text-xs text-[var(--content-secondary)]">
                  Open cartons and count what you will sticker: inner boxes and optional single-piece
                  labels.
                </p>

                <div className="mt-3 rounded-lg border border-[var(--border-subtle)]">
                  <button
                    type="button"
                    className="flex w-full min-h-11 items-center gap-2 px-3 py-2 text-left text-sm font-semibold"
                    onClick={() => setInnerOpen((o) => !o)}
                  >
                    {innerOpen ? <CaretDown size={18} /> : <CaretRight size={18} />}
                    Inner packs
                  </button>
                  {innerOpen ? (
                    <div className="space-y-3 border-t border-[var(--border-subtle)] px-3 py-3">
                      <label className="block text-xs font-semibold">
                        Inner labels to print
                        <input
                          value={innerLabels}
                          readOnly={breakupFieldsLocked}
                          onChange={(e) => setInnerLabels(e.target.value.replace(/[^\d]/g, ''))}
                          className="mt-1 min-h-11 w-full rounded-lg border border-[var(--border-subtle)] px-2 font-mono"
                          placeholder="25"
                          inputMode="numeric"
                        />
                      </label>
                      {!showMasterPhase ? (
                        <label className="block text-xs font-semibold">
                          Pcs per inner
                          <input
                            value={pcsPerInner}
                            readOnly={breakupFieldsLocked}
                            onChange={(e) => setPcsPerInner(e.target.value.replace(/[^\d]/g, ''))}
                            className="mt-1 min-h-11 w-full rounded-lg border border-[var(--border-subtle)] px-2 font-mono"
                            inputMode="numeric"
                          />
                          {pcsHint != null ? (
                            <span className="mt-1 block text-[11px] text-[var(--content-tertiary)]">
                              Inner scan at pick +{pcsHint} ea
                            </span>
                          ) : null}
                        </label>
                      ) : null}
                      {catalogHint ? (
                        <p className="text-[11px] text-[var(--content-tertiary)]">Catalog: {catalogHint}</p>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                <div className="mt-3 rounded-lg border border-[var(--border-subtle)] px-3 py-3">
                  <p className="text-xs font-bold uppercase tracking-wide text-[var(--content-tertiary)]">
                    Piece stickers
                  </p>
                  <label className="mt-2 block text-xs font-semibold">
                    Piece labels to print
                    <input
                      value={pieceLabels}
                      readOnly={breakupFieldsLocked}
                      onChange={(e) => setPieceLabels(e.target.value.replace(/[^\d]/g, ''))}
                      className="mt-1 min-h-11 w-full rounded-lg border border-[var(--border-subtle)] px-2 font-mono"
                      placeholder="5"
                      inputMode="numeric"
                    />
                    <span className="mt-1 block text-[11px] text-[var(--content-tertiary)]">
                      Same ITEM QR (alias1) on every sticker · each pick scan +1 ea
                    </span>
                  </label>
                </div>

                <p className="mt-3 text-sm text-[var(--content-secondary)]">
                  Breakup print:{' '}
                  <span className="font-mono font-semibold">
                    {preview.innerLabelsCount} inner · {preview.eachLabelsCount} piece
                  </span>
                  {pcsHint != null ? (
                    <>
                      {' '}
                      · ≈ <span className="font-mono font-semibold">{preview.totalEa} pcs</span> on line
                    </>
                  ) : null}
                </p>

                <BigButton
                  type="button"
                  variant="primary"
                  className="mt-3 w-full min-h-11 bg-[var(--bg-accent)] text-[var(--content-on-color)]"
                  disabled={
                    printBreakupMut.isPending ||
                    invoiceBlocked ||
                    breakupFieldsLocked ||
                    preview.innerLabelsCount + preview.eachLabelsCount <= 0
                  }
                  onClick={() => printBreakupMut.mutate()}
                >
                  <PrinterIcon className="mr-1 inline" size={18} />
                  {breakupDone ? 'Breakup printed' : 'Print inner + piece labels'}
                </BigButton>
                {(mastersDone || breakupDone) && !invoiceBlocked ? (
                  <BigButton
                    type="button"
                    variant="secondary"
                    className="mt-2 w-full min-h-10"
                    disabled={reprintMut.isPending}
                    onClick={() => reprintMut.mutate()}
                  >
                    Reprint all labels for this SKU
                  </BigButton>
                ) : null}
              </div>
            )}
          </div>
        </>
      )}

      <label className="mt-3 block text-xs font-semibold text-[var(--content-tertiary)]">
        Dock note (damage / variance)
        <textarea
          value={dockNote}
          onChange={(e) => setDockNote(e.target.value)}
          rows={2}
          className="mt-1 w-full rounded-lg border border-[var(--border-subtle)] px-2 py-2 text-sm"
        />
      </label>

      {!mastersDone && !breakupDone && !bulkOnly ? (
        <button
          type="button"
          className="mt-3 text-xs text-red-600 hover:underline"
          onClick={() => {
            if (window.confirm('Remove this GRN line?')) {
              void deleteReceivingJobLine(line.id).then(() => onUpdated());
            }
          }}
        >
          <Trash size={16} className="inline" /> Remove line
        </button>
      ) : null}
    </div>
  );
}
