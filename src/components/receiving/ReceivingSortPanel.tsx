import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Check, FloppyDisk, PrinterIcon } from '@phosphor-icons/react';
import { AliasChip, BigButton } from '../shared';
import { useToast } from '../../context/ToastContext';
import { shouldBlockJobOnUnmapped } from '../../lib/labelStudio/resolveSupplier';
import {
  fetchLicensePlatesForLine,
  receivingPrintInnerLabels,
  receivingTryRollUpPoForJobLine,
  updateReceivingJobLineRatio,
  upsertPackDefinitionFromReceiving,
} from '../../lib/receiving/receivingApi';
import { derivePackFromCatalog } from '../../lib/receiving/derivePackFromCatalog';
import { formatReceivingPrintError } from '../../lib/receiving/receivingPrintErrors';
import {
  openReceivingBatchPrint,
  type ReceivingBatchLineInput,
  type ReceivingPrintPlate,
} from '../../lib/receiving/receivingPrintUtils';
import { submitBinCount } from '../../lib/wms';
import type { Item, ItemPackDefinition } from '../../types';
import type { ReceivingJobLineRow, ReceivingJobRow } from '../../types/receiving';

interface SortRowState {
  innerLabels: string;
  pieceLabels: string;
  pcsPerInner: string;
  looseEa: string;
  targetBin: string;
}

function initialRow(line: ReceivingJobLineRow, packDef: ItemPackDefinition | undefined): SortRowState {
  const hasReceiveData = Boolean(line.ratio_verified_at);
  const catalog = derivePackFromCatalog(packDef);
  return {
    innerLabels: line.inner_labels_count > 0 ? String(line.inner_labels_count) : '',
    pieceLabels: line.each_labels_count > 0 ? String(line.each_labels_count) : '',
    pcsPerInner: hasReceiveData
      ? String(line.ea_per_inner)
      : catalog.pcsPerInner != null
        ? String(catalog.pcsPerInner)
        : '',
    looseEa: line.total_ea > 0 ? String(line.total_ea) : '',
    targetBin: line.loose_target_bin_id ?? '',
  };
}

function parseBreakupCounts(r: SortRowState | undefined) {
  const inner = Math.floor(Number(r?.innerLabels) || 0);
  const piece = Math.floor(Number(r?.pieceLabels) || 0);
  const pcs = Math.floor(Number(r?.pcsPerInner) || 0);
  return { inner, piece, pcs, valid: inner + piece > 0 && (inner === 0 || pcs > 0) };
}

async function buildBreakupBatch(
  linesToPrint: ReceivingJobLineRow[],
  rows: Record<number, SortRowState>,
  items: Item[],
): Promise<ReceivingBatchLineInput[]> {
  const batch: ReceivingBatchLineInput[] = [];
  for (const line of linesToPrint) {
    const r = rows[line.id];
    const innerN = Math.floor(Number(r?.innerLabels) || line.inner_labels_count || 0);
    const pieceN = Math.floor(Number(r?.pieceLabels) || line.each_labels_count || 0);
    const allPlates = (await fetchLicensePlatesForLine(line.id)) as ReceivingPrintPlate[];
    const innerPlates = allPlates.filter((p) => p.pack_type === 'inner');
    if (innerN <= 0 && pieceN <= 0) continue;
    batch.push({
      lineBusyCode: Number(line.busy_code),
      skuDescription: line.sku_description_snapshot,
      lotNo: line.lot_no,
      plates: innerPlates,
      catalogItem: items.find((i) => Number(i.busy_code) === Number(line.busy_code)) ?? null,
      includeMaster: false,
      includeInner: innerN > 0,
      pieceLabelCount: pieceN,
    });
  }
  return batch;
}

export function ReceivingSortPanel({
  job,
  lines,
  items,
  packByBusy,
  userId,
  userName,
  onUpdated,
  jobId,
}: {
  job: ReceivingJobRow;
  lines: ReceivingJobLineRow[];
  items: Item[];
  packByBusy: Map<number, ItemPackDefinition>;
  userId: number | null;
  userName: string | null;
  onUpdated: () => void;
  jobId: number;
}): ReactElement {
  const toast = useToast();

  const cartonLines = useMemo(() => lines.filter((l) => l.receive_mode !== 'loose'), [lines]);
  const innerPrinted = (l: ReceivingJobLineRow) => Boolean(l.inner_labels_printed_at);

  const [rows, setRows] = useState<Record<number, SortRowState>>(() => {
    const r: Record<number, SortRowState> = {};
    for (const l of lines) r[l.id] = initialRow(l, packByBusy.get(Number(l.busy_code)));
    return r;
  });

  useEffect(() => {
    setRows((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const l of lines) {
        if (innerPrinted(l)) continue;
        const catalog = derivePackFromCatalog(packByBusy.get(Number(l.busy_code)));
        const cur = next[l.id];
        if (!cur || cur.pcsPerInner || catalog.pcsPerInner == null) continue;
        next[l.id] = { ...cur, pcsPerInner: String(catalog.pcsPerInner) };
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [lines, packByBusy]);

  const updateRow = (id: number, patch: Partial<SortRowState>) => {
    setRows((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  };

  const linesWithCounts = useMemo(
    () =>
      cartonLines.filter((l) => {
        if (innerPrinted(l)) return false;
        if (shouldBlockJobOnUnmapped(job.triggered_by, l.supplier_code_status)) return false;
        return parseBreakupCounts(rows[l.id]).valid;
      }),
    [cartonLines, rows, job.triggered_by],
  );

  const savedAwaitingPrint = useMemo(
    () =>
      cartonLines.filter(
        (l) =>
          !innerPrinted(l) &&
          Boolean(l.ratio_verified_at) &&
          (l.inner_labels_count > 0 || l.each_labels_count > 0),
      ),
    [cartonLines],
  );

  const printedLines = useMemo(() => cartonLines.filter((l) => innerPrinted(l)), [cartonLines]);

  const saveRow = async (line: ReceivingJobLineRow, r: SortRowState) => {
    const { inner, piece, pcs } = parseBreakupCounts(r);
    if (!parseBreakupCounts(r).valid) return;
    const totalEa = piece + inner * pcs;
    await updateReceivingJobLineRatio(line.id, {
      inner_labels_count: inner,
      each_labels_count: piece,
      inner_pack_count: inner,
      ea_per_inner: pcs,
      total_ea: totalEa,
      ratio_verified_at: new Date().toISOString(),
      ratio_verified_by_user_id: userId,
      ratio_verified_by_name: userName,
    });
  };

  const saveAllMut = useMutation({
    mutationFn: async (toSave: ReceivingJobLineRow[]) => {
      if (toSave.length === 0) throw new Error('nothing_to_save');
      for (const line of toSave) {
        const r = rows[line.id];
        if (!r) continue;
        await saveRow(line, r);
      }
      return toSave.length;
    },
    onSuccess: (n) => {
      toast.success(`Saved breakup for ${n} line${n === 1 ? '' : 's'} — ready for print desk`);
      onUpdated();
    },
    onError: (e: Error) => toast.error(formatReceivingPrintError(e.message, 'breakup')),
  });

  const printDeskMut = useMutation({
    mutationFn: async (toPrint: ReceivingJobLineRow[]) => {
      if (toPrint.length === 0) throw new Error('nothing_saved_to_print');

      for (const line of toPrint) {
        const r = rows[line.id];
        const inner = Math.floor(Number(r?.innerLabels) || line.inner_labels_count || 0);
        const pcs = Math.max(1, Math.floor(Number(r?.pcsPerInner) || line.ea_per_inner || 1));
        if (inner > 0) {
          try {
            await upsertPackDefinitionFromReceiving({
              busyCode: Number(line.busy_code),
              itemName: line.sku_description_snapshot,
              itemId: items.find((i) => Number(i.busy_code) === Number(line.busy_code))?.id ?? null,
              pcsPerInner: pcs,
              innersPerOuter: line.inner_per_master ?? null,
            });
          } catch {
            /* best-effort */
          }
        }
        const res = await receivingPrintInnerLabels(line.id, userId, userName);
        if (!res.success && res.reason !== 'inner_labels_already_printed') {
          throw new Error(res.reason ?? 'inner_print_failed');
        }
      }

      const batch = await buildBreakupBatch(toPrint, rows, items);
      if (batch.length === 0) throw new Error('no_label_cards');

      const printResult = await openReceivingBatchPrint({
        documentTitle: `Breakup labels · ${job.job_public_id ?? ''}`,
        jobPublicId: job.job_public_id,
        envelopeCode: job.envelope_code,
        poRef: job.po_ref,
        phaseLabel: 'Phase 2 · Sort (print desk)',
        lines: batch,
      });

      if (!printResult.opened) {
        throw new Error(printResult.cardCount > 0 ? 'popup_blocked' : 'no_label_cards');
      }

      for (const line of toPrint) {
        if (line.purchase_order_line_id != null) {
          await receivingTryRollUpPoForJobLine(line.id);
        }
      }

      return { lineCount: toPrint.length, cardCount: printResult.cardCount };
    },
    onSuccess: (result) => {
      toast.success(
        `Print desk: ${result.cardCount} sticker${result.cardCount === 1 ? '' : 's'} for ${result.lineCount} SKU${result.lineCount === 1 ? '' : 's'}`,
      );
      onUpdated();
    },
    onError: (e: Error) => toast.error(formatReceivingPrintError(e.message, 'breakup')),
  });

  const reprintMut = useMutation({
    mutationFn: async (toReprint: ReceivingJobLineRow[]) => {
      if (toReprint.length === 0) throw new Error('no_label_cards');
      const batch = await buildBreakupBatch(toReprint, rows, items);
      if (batch.every((b) => !b.includeInner && b.pieceLabelCount <= 0)) {
        throw new Error('no_label_cards');
      }
      const printResult = await openReceivingBatchPrint({
        documentTitle: `Breakup reprint · ${job.job_public_id ?? ''}`,
        jobPublicId: job.job_public_id,
        envelopeCode: job.envelope_code,
        poRef: job.po_ref,
        phaseLabel: 'Reprint · breakup',
        lines: batch,
      });
      if (!printResult.opened) throw new Error('popup_blocked');
      return printResult.cardCount;
    },
    onSuccess: (n) => toast.success(`Reopened breakup print (${n} sticker${n === 1 ? '' : 's'})`),
    onError: (e: Error) => toast.error(formatReceivingPrintError(e.message, 'breakup')),
  });

  const looseLines = lines.filter((l) => l.receive_mode === 'loose');

  const loosePostMut = useMutation({
    mutationFn: async (line: ReceivingJobLineRow) => {
      const r = rows[line.id];
      const ea = Math.max(0, Math.floor(Number(r.looseEa) || 0));
      const pcs = Math.max(1, Math.floor(Number(r.pcsPerInner) || 1));
      if (ea <= 0 || !r.targetBin.trim()) throw new Error('loose_invalid');
      await updateReceivingJobLineRatio(line.id, {
        ea_per_inner: pcs,
        total_ea: ea,
        loose_target_bin_id: r.targetBin.trim().toUpperCase(),
        ratio_verified_at: new Date().toISOString(),
        ratio_verified_by_user_id: userId,
        ratio_verified_by_name: userName,
      });
      await submitBinCount({
        binId: r.targetBin.trim().toUpperCase(),
        skuBusyCode: Number(line.busy_code),
        innerPacks: 0,
        looseEaQty: ea,
        innerPackQty: pcs,
        dailyTarget: null,
        reorderPoint: null,
        countType: 'initial_setup',
        userId,
        userName,
        note: `Loose receive job ${jobId} line ${line.line_no}`,
      });
      if (line.purchase_order_line_id != null) {
        await receivingTryRollUpPoForJobLine(line.id);
      }
    },
    onSuccess: () => {
      toast.success('Posted bulk to BIN');
      onUpdated();
    },
    onError: (e: Error) =>
      toast.error(
        e.message === 'loose_invalid' ? 'Enter total pieces and BIN.' : e.message || 'Could not post',
      ),
  });

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border-2 border-amber-500/30 bg-amber-50/50 px-4 py-3 dark:bg-amber-950/30">
        <p className="text-sm font-bold text-[var(--content-primary)]">
          Phase 2 · Sort — count on the floor, print at the desk
        </p>
        <p className="mt-1 text-xs text-[var(--content-secondary)]">
          <strong>1.</strong> Operators enter inner + piece sticker counts and tap{' '}
          <strong>Save all breakup</strong>. <strong>2.</strong> One person at the computer taps{' '}
          <strong>Print all at desk</strong> for one combined print job.
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-[var(--border-subtle)]">
        <div className="hidden grid-cols-[2rem_1fr_5rem_5rem_5rem_5rem] gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-[var(--content-tertiary)] sm:grid">
          <span>#</span>
          <span>SKU</span>
          <span className="text-right">Inner stickers</span>
          <span className="text-right">Piece stickers</span>
          <span className="text-right">Pcs / inner</span>
          <span className="text-right">Status</span>
        </div>

        {cartonLines.map((line) => {
          const r = rows[line.id];
          const printed = innerPrinted(line);
          const saved = Boolean(line.ratio_verified_at) && !printed;
          const { inner: innerN, piece, pcs } = parseBreakupCounts(r);
          const totalEa = piece + innerN * (pcs > 0 ? pcs : 0);
          const invoiceBlocked = shouldBlockJobOnUnmapped(job.triggered_by, line.supplier_code_status);
          const catalogItem = items.find((i) => Number(i.busy_code) === Number(line.busy_code)) ?? null;
          const alias1 = catalogItem?.alias1?.trim() ?? '';

          return (
            <div
              key={line.id}
              className="grid grid-cols-1 gap-2 border-b border-[var(--border-subtle)] px-3 py-3 last:border-b-0 sm:grid-cols-[2rem_1fr_5rem_5rem_5rem_5rem] sm:items-start"
            >
              <span className="font-mono text-xs font-bold">{line.line_no}</span>
              <span className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-bold">{line.busy_code}</span>
                  {alias1 ? <AliasChip label="Alias 1" value={alias1} tone="primary" /> : null}
                </div>
                <span className="mt-0.5 block truncate text-sm">{line.sku_description_snapshot}</span>
                <span className="font-mono text-[11px] text-[var(--content-tertiary)]">
                  Lot {line.lot_no}
                  {line.master_labels_printed_at
                    ? ` · ${line.master_labels_count} outer${line.master_labels_count === 1 ? '' : 's'} done`
                    : ''}
                </span>
                {pcs > 0 && (innerN > 0 || piece > 0) ? (
                  <span className="mt-1 block text-[11px] text-emerald-700 dark:text-emerald-400">
                    {innerN > 0 ? `Inner scan = ${pcs} pcs` : ''}
                    {innerN > 0 && piece > 0 ? ' · ' : ''}
                    {piece > 0 ? 'Piece scan = 1 pc' : ''}
                    {' · '}
                    <strong>≈ {totalEa} pcs</strong>
                  </span>
                ) : null}
                {invoiceBlocked ? (
                  <span className="mt-1 block text-[11px] text-amber-700 dark:text-amber-300">
                    Map supplier barcode before printing
                  </span>
                ) : null}
              </span>

              <label className="text-[10px] font-semibold uppercase text-[var(--content-tertiary)] sm:text-right">
                <span className="sm:hidden">Inner stickers</span>
                <input
                  value={r?.innerLabels ?? ''}
                  onChange={(e) => updateRow(line.id, { innerLabels: e.target.value.replace(/[^\d]/g, '') })}
                  readOnly={printed}
                  placeholder="0"
                  inputMode="numeric"
                  className="mt-1 block min-h-10 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2 font-mono text-base sm:w-18 sm:text-right"
                />
              </label>

              <label className="text-[10px] font-semibold uppercase text-[var(--content-tertiary)] sm:text-right">
                <span className="sm:hidden">Piece stickers</span>
                <input
                  value={r?.pieceLabels ?? ''}
                  onChange={(e) => updateRow(line.id, { pieceLabels: e.target.value.replace(/[^\d]/g, '') })}
                  readOnly={printed}
                  placeholder="0"
                  inputMode="numeric"
                  className="mt-1 block min-h-10 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2 font-mono text-base sm:w-18 sm:text-right"
                />
              </label>

              <label className="text-[10px] font-semibold uppercase text-[var(--content-tertiary)] sm:text-right">
                <span className="sm:hidden">Pcs / inner</span>
                <input
                  value={r?.pcsPerInner ?? ''}
                  onChange={(e) => updateRow(line.id, { pcsPerInner: e.target.value.replace(/[^\d]/g, '') })}
                  readOnly={printed}
                  placeholder="20"
                  inputMode="numeric"
                  className="mt-1 block min-h-10 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2 font-mono text-base sm:w-18 sm:text-right"
                />
              </label>

              <div className="flex flex-col items-start gap-1 sm:items-end">
                {printed ? (
                  <>
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
                      <Check size={12} weight="bold" /> Printed
                    </span>
                    <button
                      type="button"
                      onClick={() => reprintMut.mutate([line])}
                      disabled={reprintMut.isPending}
                      className="text-[10px] font-semibold text-sky-700 underline dark:text-sky-300"
                    >
                      Reprint
                    </button>
                  </>
                ) : saved ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-900 dark:bg-amber-950 dark:text-amber-100">
                    Saved · print desk
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold text-sky-900 dark:bg-sky-950 dark:text-sky-100">
                    Pending
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-col gap-3">
        <p className="text-xs text-[var(--content-tertiary)]">
          {linesWithCounts.length} to save · {savedAwaitingPrint.length} waiting at print desk ·{' '}
          {printedLines.length} printed
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <BigButton
            type="button"
            variant="secondary"
            className="min-h-12"
            disabled={saveAllMut.isPending || linesWithCounts.length === 0}
            onClick={() => saveAllMut.mutate(linesWithCounts)}
          >
            <FloppyDisk className="mr-1 inline" size={18} />
            Save all breakup ({linesWithCounts.length || 0})
          </BigButton>
          <BigButton
            type="button"
            variant="primary"
            className="min-h-12 bg-[var(--bg-accent)] text-[var(--content-on-color)]"
            disabled={printDeskMut.isPending || savedAwaitingPrint.length === 0}
            onClick={() => printDeskMut.mutate(savedAwaitingPrint)}
          >
            <PrinterIcon className="mr-1 inline" size={18} />
            Print all at desk ({savedAwaitingPrint.length || 0})
          </BigButton>
          {printedLines.length > 0 ? (
            <BigButton
              type="button"
              variant="secondary"
              className="min-h-12"
              disabled={reprintMut.isPending}
              onClick={() => reprintMut.mutate(printedLines)}
            >
              <PrinterIcon className="mr-1 inline" size={18} />
              Reprint all breakup ({printedLines.length})
            </BigButton>
          ) : null}
        </div>
      </div>

      {looseLines.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-[var(--border-subtle)]">
          <p className="border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 text-[10px] font-bold uppercase text-[var(--content-tertiary)]">
            Bulk lines (no labels — post to BIN)
          </p>
          {looseLines.map((line) => {
            const r = rows[line.id];
            const posted = Boolean(line.loose_target_bin_id?.trim() && line.ratio_verified_at);
            const looseCatalog = items.find((i) => Number(i.busy_code) === Number(line.busy_code)) ?? null;
            const looseAlias1 = looseCatalog?.alias1?.trim() ?? '';
            return (
              <div
                key={line.id}
                className="grid grid-cols-1 gap-2 border-b border-[var(--border-subtle)] px-3 py-3 last:border-b-0 sm:grid-cols-[1fr_5rem_6rem_5rem_8rem] sm:items-start"
              >
                <span>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-bold">{line.busy_code}</span>
                    {looseAlias1 ? <AliasChip label="Alias 1" value={looseAlias1} tone="primary" /> : null}
                  </div>
                  <span className="mt-0.5 block truncate text-sm">{line.sku_description_snapshot}</span>
                  <span className="font-mono text-[11px] text-[var(--content-tertiary)]">
                    Lot {line.lot_no}
                  </span>
                </span>
                <label className="text-[10px] font-semibold uppercase text-[var(--content-tertiary)]">
                  Total pcs
                  <input
                    value={r?.looseEa ?? ''}
                    onChange={(e) => updateRow(line.id, { looseEa: e.target.value.replace(/[^\d]/g, '') })}
                    readOnly={posted}
                    inputMode="numeric"
                    className="mt-1 block min-h-10 w-full rounded-lg border px-2 font-mono"
                  />
                </label>
                <label className="text-[10px] font-semibold uppercase text-[var(--content-tertiary)]">
                  BIN
                  <input
                    value={r?.targetBin ?? ''}
                    onChange={(e) => updateRow(line.id, { targetBin: e.target.value.toUpperCase() })}
                    readOnly={posted}
                    className="mt-1 block min-h-10 w-full rounded-lg border px-2 font-mono uppercase"
                  />
                </label>
                <label className="text-[10px] font-semibold uppercase text-[var(--content-tertiary)]">
                  Pcs/inner
                  <input
                    value={r?.pcsPerInner ?? ''}
                    onChange={(e) => updateRow(line.id, { pcsPerInner: e.target.value.replace(/[^\d]/g, '') })}
                    readOnly={posted}
                    inputMode="numeric"
                    className="mt-1 block min-h-10 w-full rounded-lg border px-2 font-mono"
                  />
                </label>
                <BigButton
                  type="button"
                  variant="secondary"
                  className="min-h-10"
                  disabled={loosePostMut.isPending || posted}
                  onClick={() => loosePostMut.mutate(line)}
                >
                  {posted ? 'Posted' : 'Post to BIN'}
                </BigButton>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
