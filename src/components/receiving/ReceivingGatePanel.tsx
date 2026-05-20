import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Check, PrinterIcon, ArrowRight, Package } from '@phosphor-icons/react';
import { AliasChip, BigButton } from '../shared';
import { useToast } from '../../context/ToastContext';
import { shouldBlockJobOnUnmapped } from '../../lib/labelStudio/resolveSupplier';
import {
  fetchLicensePlatesForLine,
  receivingPrintMasterLabels,
  updateReceivingJobLineRatio,
  upsertPackDefinitionFromReceiving,
} from '../../lib/receiving/receivingApi';
import {
  openReceivingBatchPrint,
  type ReceivingBatchLineInput,
  type ReceivingPrintPlate,
} from '../../lib/receiving/receivingPrintUtils';
import { derivePackFromCatalog } from '../../lib/receiving/derivePackFromCatalog';
import { formatReceivingPrintError } from '../../lib/receiving/receivingPrintErrors';
import type { Item, ItemPackDefinition } from '../../types';
import type { ReceivingJobLineRow, ReceivingJobRow } from '../../types/receiving';

/**
 * Pack hierarchy (physical reality):
 *
 *   ┌─────────────────────────────────────┐
 *   │  OUTER BOX (master carton)         │  ← "Outer boxes" field
 *   │  ┌─────────┐ ┌─────────┐ ┌───┐     │
 *   │  │ INNER 1 │ │ INNER 2 │ │...│     │  ← "Inner boxes per outer" field
 *   │  │ 20 pcs  │ │ 20 pcs  │ │   │     │  ← "Pcs per inner box" field
 *   │  └─────────┘ └─────────┘ └───┘     │
 *   └─────────────────────────────────────┘
 *
 * 3-level: outer → inner → pieces (most suppliers)
 * 2-level: outer → pieces directly (no inner boxes, e.g. TIDC)
 */

interface GateRowState {
  outerBoxes: string;
  innersPerOuter: string;
  pcsPerInner: string;
  twoLevel: boolean; // 2-level = no inner boxes (outer → pieces directly)
}

function rowFromLineAndCatalog(
  line: ReceivingJobLineRow,
  packDef: ItemPackDefinition | undefined,
): GateRowState {
  const catalog = derivePackFromCatalog(packDef);
  const hasLinePack =
    line.ratio_verified_at != null ||
    line.ea_per_inner > 1 ||
    (line.inner_per_master != null && line.inner_per_master > 0);

  const twoLevel =
    hasLinePack && (line.inner_per_master == null || line.inner_per_master === 0)
      ? true
      : catalog.twoLevel;

  return {
    outerBoxes: line.master_labels_count > 0 ? String(line.master_labels_count) : '',
    innersPerOuter:
      line.inner_per_master != null && line.inner_per_master > 0
        ? String(line.inner_per_master)
        : !twoLevel && catalog.innersPerOuter != null
          ? String(catalog.innersPerOuter)
          : '',
    pcsPerInner: hasLinePack
      ? String(line.ea_per_inner)
      : catalog.pcsPerInner != null
        ? String(catalog.pcsPerInner)
        : '',
    twoLevel,
  };
}

export function ReceivingGatePanel({
  job,
  lines,
  items,
  packByBusy,
  userId,
  userName,
  onUpdated,
  onAllDone,
}: {
  job: ReceivingJobRow;
  lines: ReceivingJobLineRow[];
  items: Item[];
  packByBusy: Map<number, ItemPackDefinition>;
  userId: number | null;
  userName: string | null;
  onUpdated: () => void;
  onAllDone: () => void;
}): ReactElement {
  const toast = useToast();

  const eligible = useMemo(
    () => lines.filter((l) => l.receive_mode !== 'loose'),
    [lines],
  );

  const masterPrinted = (l: ReceivingJobLineRow) => Boolean(l.master_labels_printed_at);

  const [rows, setRows] = useState<Record<number, GateRowState>>(() => {
    const r: Record<number, GateRowState> = {};
    for (const l of eligible) r[l.id] = rowFromLineAndCatalog(l, packByBusy.get(Number(l.busy_code)));
    return r;
  });

  // Pack definitions load async — re-hydrate empty fields when catalog arrives
  useEffect(() => {
    setRows((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const l of eligible) {
        if (masterPrinted(l)) continue;
        const def = packByBusy.get(Number(l.busy_code));
        const catalog = derivePackFromCatalog(def);
        if (!catalog.label) continue;
        const cur = next[l.id] ?? rowFromLineAndCatalog(l, def);
        const merged: GateRowState = { ...cur };
        if (!merged.pcsPerInner && catalog.pcsPerInner != null) {
          merged.pcsPerInner = String(catalog.pcsPerInner);
          changed = true;
        }
        if (!merged.innersPerOuter && !merged.twoLevel && catalog.innersPerOuter != null) {
          merged.innersPerOuter = String(catalog.innersPerOuter);
          changed = true;
        }
        if (!l.ratio_verified_at && catalog.twoLevel && !merged.twoLevel) {
          merged.twoLevel = true;
          merged.innersPerOuter = '';
          changed = true;
        }
        next[l.id] = merged;
      }
      return changed ? next : prev;
    });
  }, [eligible, packByBusy, lines]);

  const updateRow = (id: number, patch: Partial<GateRowState>) => {
    setRows((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  };

  const pendingCount = useMemo(
    () => eligible.filter((l) => !masterPrinted(l)).length,
    [eligible],
  );

  const readyToPrint = useMemo(
    () =>
      eligible.filter((l) => {
        const r = rows[l.id];
        if (!r || masterPrinted(l)) return false;
        const outer = Math.floor(Number(r.outerBoxes) || 0);
        const pcs = Math.floor(Number(r.pcsPerInner) || 0);
        const inners = r.twoLevel ? 1 : Math.floor(Number(r.innersPerOuter) || 0);
        if (outer <= 0 || pcs <= 0 || inners <= 0) return false;
        if (shouldBlockJobOnUnmapped(job.triggered_by, l.supplier_code_status)) return false;
        return true;
      }),
    [eligible, rows, job.triggered_by],
  );

  const saveRow = async (line: ReceivingJobLineRow, r: GateRowState) => {
    const outer = Math.max(0, Math.floor(Number(r.outerBoxes) || 0));
    const pcs = Math.max(1, Math.floor(Number(r.pcsPerInner) || 0));
    // 2-level: inner_per_master = null (outer contains pieces directly)
    // 3-level: inner_per_master = user input
    const ipm = r.twoLevel ? null : Math.max(1, Math.floor(Number(r.innersPerOuter) || 1));

    await updateReceivingJobLineRatio(line.id, {
      receive_mode: outer > 0 ? 'structured' : 'inner_only',
      master_carton_qty: outer,
      master_labels_count: outer,
      ea_per_inner: pcs,
      inner_per_master: ipm,
    });
  };

  const toggle2LevelMut = useMutation({
    mutationFn: async ({ line, makeTwoLevel }: { line: ReceivingJobLineRow; makeTwoLevel: boolean }) => {
      const r = rows[line.id];
      const newState: GateRowState = {
        ...r,
        twoLevel: makeTwoLevel,
        innersPerOuter: makeTwoLevel ? '' : r.innersPerOuter,
      };
      updateRow(line.id, newState);

      // Save to DB
      const outer = Math.max(0, Math.floor(Number(newState.outerBoxes) || 0));
      const pcs = Math.max(1, Math.floor(Number(newState.pcsPerInner) || 1));
      await updateReceivingJobLineRatio(line.id, {
        receive_mode: 'structured',
        master_carton_qty: outer,
        master_labels_count: outer,
        ea_per_inner: pcs,
        inner_per_master: makeTwoLevel ? null : Math.max(1, Math.floor(Number(newState.innersPerOuter) || 1)),
        ratio_verified_at: new Date().toISOString(),
        ratio_verified_by_user_id: userId,
        ratio_verified_by_name: userName,
      });
    },
    onSuccess: () => onUpdated(),
    onError: () => toast.error('Could not update'),
  });

  const printAllMut = useMutation({
    mutationFn: async (linesToPrint: ReceivingJobLineRow[]) => {
      if (linesToPrint.length === 0) throw new Error('nothing_to_print');

      for (const line of linesToPrint) {
        const r = rows[line.id];
        if (!r) throw new Error('nothing_to_print');
        const pcs = Math.max(1, Math.floor(Number(r.pcsPerInner) || 1));
        const ipm = r.twoLevel ? null : Math.max(1, Math.floor(Number(r.innersPerOuter) || 1));
        await saveRow(line, r);
        try {
          await upsertPackDefinitionFromReceiving({
            busyCode: Number(line.busy_code),
            itemName: line.sku_description_snapshot,
            itemId: items.find((i) => Number(i.busy_code) === Number(line.busy_code))?.id ?? null,
            pcsPerInner: pcs,
            innersPerOuter: ipm,
          });
        } catch {
          /* catalog upsert is best-effort */
        }
        const res = await receivingPrintMasterLabels(line.id, userId, userName);
        if (!res.success && res.reason !== 'master_labels_already_printed') {
          throw new Error(res.reason ?? 'master_print_failed');
        }
      }

      const batch: ReceivingBatchLineInput[] = [];
      for (const line of linesToPrint) {
        const allPlates = (await fetchLicensePlatesForLine(line.id)) as ReceivingPrintPlate[];
        const outerPlates = allPlates.filter((p) => p.pack_type === 'outer');
        if (outerPlates.length === 0) throw new Error('no_label_cards');
        batch.push({
          lineBusyCode: Number(line.busy_code),
          skuDescription: line.sku_description_snapshot,
          lotNo: line.lot_no,
          plates: outerPlates,
          catalogItem: items.find((i) => Number(i.busy_code) === Number(line.busy_code)) ?? null,
          includeMaster: true,
          includeInner: false,
          pieceLabelCount: 0,
        });
      }

      const printResult = await openReceivingBatchPrint({
        documentTitle: `Outer box labels · ${job.job_public_id ?? ''}`,
        jobPublicId: job.job_public_id,
        envelopeCode: job.envelope_code,
        poRef: job.po_ref,
        phaseLabel: 'Phase 1 · Gate (outer boxes)',
        lines: batch,
      });

      if (!printResult.opened) {
        throw new Error(printResult.cardCount > 0 ? 'popup_blocked' : 'no_label_cards');
      }

      return { lineCount: linesToPrint.length, cardCount: printResult.cardCount };
    },
    onSuccess: (result) => {
      toast.success(
        `Opened print for ${result.cardCount} outer label${result.cardCount === 1 ? '' : 's'} (${result.lineCount} SKU${result.lineCount === 1 ? '' : 's'})`,
      );
      onUpdated();
    },
    onError: (e: Error) => toast.error(formatReceivingPrintError(e.message, 'outer')),
  });

  const printedOuterLines = useMemo(
    () => eligible.filter((l) => masterPrinted(l)),
    [eligible],
  );

  const reprintMut = useMutation({
    mutationFn: async (linesToReprint: ReceivingJobLineRow[]) => {
      if (linesToReprint.length === 0) throw new Error('no_label_cards');
      const batch: ReceivingBatchLineInput[] = [];
      for (const line of linesToReprint) {
        const allPlates = (await fetchLicensePlatesForLine(line.id)) as ReceivingPrintPlate[];
        const outerPlates = allPlates.filter((p) => p.pack_type === 'outer');
        if (outerPlates.length === 0) continue;
        batch.push({
          lineBusyCode: Number(line.busy_code),
          skuDescription: line.sku_description_snapshot,
          lotNo: line.lot_no,
          plates: outerPlates,
          catalogItem: items.find((i) => Number(i.busy_code) === Number(line.busy_code)) ?? null,
          includeMaster: true,
          includeInner: false,
          pieceLabelCount: 0,
        });
      }
      if (batch.length === 0) throw new Error('no_label_cards');
      const printResult = await openReceivingBatchPrint({
        documentTitle: `Outer reprint · ${job.job_public_id ?? ''}`,
        jobPublicId: job.job_public_id,
        envelopeCode: job.envelope_code,
        poRef: job.po_ref,
        phaseLabel: 'Reprint · outer boxes',
        lines: batch,
      });
      if (!printResult.opened) throw new Error('popup_blocked');
      return printResult.cardCount;
    },
    onSuccess: (n) => toast.success(`Reopened outer print (${n} label${n === 1 ? '' : 's'})`),
    onError: (e: Error) => toast.error(formatReceivingPrintError(e.message, 'outer')),
  });

  const allPrinted = pendingCount === 0;

  // Visual diagram for the info banner
  const PackDiagram = ({ twoLevel }: { twoLevel: boolean }) => (
    <div className="flex items-center gap-1 text-[10px] font-mono text-[var(--content-tertiary)]">
      <span className="rounded border border-current px-1">Outer</span>
      <ArrowRight size={10} />
      {twoLevel ? (
        <span className="rounded border border-current px-1">Pcs</span>
      ) : (
        <>
          <span className="rounded border border-current px-1">Inner</span>
          <ArrowRight size={10} />
          <span className="rounded border border-current px-1">Pcs</span>
        </>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Explanation banner with Norman's "conceptual model" */}
      <div className="rounded-2xl border-2 border-sky-500/30 bg-sky-50/50 px-4 py-3 dark:bg-sky-950/30">
        <p className="text-sm font-bold text-[var(--content-primary)]">
          Phase 1 · Gate — outer box labels
        </p>
        <p className="mt-1 text-xs text-[var(--content-secondary)]">
          Count sealed outer boxes on the dock. Print and stick labels <em>while unloading</em>.
        </p>
        <div className="mt-2 flex flex-wrap gap-4 text-[11px] text-[var(--content-secondary)]">
          <div>
            <span className="font-semibold">3-level pack:</span> <PackDiagram twoLevel={false} />
          </div>
          <div>
            <span className="font-semibold">2-level (no inner):</span> <PackDiagram twoLevel={true} />
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-[var(--border-subtle)]">
        {/* Column headers — order: outer → inner → pcs (big to small) */}
        <div className="hidden grid-cols-[2rem_1fr_5.5rem_5.5rem_5.5rem_6rem] gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-[var(--content-tertiary)] sm:grid">
          <span>#</span>
          <span>SKU</span>
          <span className="text-right">Outer boxes</span>
          <span className="text-right">Inners / outer</span>
          <span className="text-right">Pcs / inner</span>
          <span className="text-right">Status</span>
        </div>

        {eligible.map((line) => {
          const r = rows[line.id];
          const printed = masterPrinted(line);
          const catalogItem = items.find((i) => Number(i.busy_code) === Number(line.busy_code)) ?? null;
          const alias1 = catalogItem?.alias1?.trim() ?? '';
          const packDef = packByBusy.get(Number(line.busy_code));
          const catalogHint = derivePackFromCatalog(packDef);
          const invoiceBlocked = shouldBlockJobOnUnmapped(job.triggered_by, line.supplier_code_status);

          // Compute what one outer-box scan will add at pick
          const outerN = Math.floor(Number(r?.outerBoxes) || 0);
          const innersN = r?.twoLevel ? 1 : Math.floor(Number(r?.innersPerOuter) || 0);
          const pcsN = Math.floor(Number(r?.pcsPerInner) || 0);
          const outerScanEa = innersN > 0 && pcsN > 0 ? innersN * pcsN : null;
          const totalEaEstimate = outerN > 0 && outerScanEa ? outerN * outerScanEa : null;

          return (
            <div
              key={line.id}
              className="grid grid-cols-1 gap-2 border-b border-[var(--border-subtle)] px-3 py-3 last:border-b-0 sm:grid-cols-[2rem_1fr_5.5rem_5.5rem_5.5rem_6rem] sm:items-start"
            >
              {/* Line # */}
              <span className="font-mono text-xs font-bold text-[var(--content-tertiary)]">{line.line_no}</span>

              {/* SKU info */}
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-bold">{line.busy_code}</span>
                  {alias1 ? <AliasChip label="Alias 1" value={alias1} tone="primary" /> : null}
                </div>
                <span className="mt-0.5 block truncate text-sm text-[var(--content-primary)]">
                  {line.sku_description_snapshot}
                </span>
                <span className="font-mono text-[11px] text-[var(--content-tertiary)]">
                  Lot {line.lot_no}
                  {line.po_qty_expected_ea != null ? ` · PO says ${line.po_qty_expected_ea} pcs` : ''}
                </span>

                {catalogHint.label ? (
                  <span className="mt-1 block text-[11px] font-medium text-sky-800 dark:text-sky-300">
                    Catalog (Book box): {catalogHint.label}
                  </span>
                ) : !printed ? (
                  <span className="mt-1 block text-[11px] text-amber-700 dark:text-amber-300">
                    No pack size in catalog — import Book box.xlsx on Upload, or type sizes below
                  </span>
                ) : null}

                {/* Feedback: what the scan will do */}
                {outerScanEa != null && !printed ? (
                  <span className="mt-1 block text-[11px] text-emerald-700 dark:text-emerald-400">
                    Each outer sticker = <strong>{outerScanEa} pcs</strong> at pick
                    {totalEaEstimate != null ? ` · ${outerN} boxes ≈ ${totalEaEstimate} pcs total` : ''}
                  </span>
                ) : null}

                {invoiceBlocked ? (
                  <span className="mt-1 block text-[11px] text-amber-700 dark:text-amber-300">
                    Map supplier barcode before printing
                  </span>
                ) : null}

                {/* 2-level toggle */}
                {!printed ? (
                  <label className="mt-2 flex cursor-pointer items-center gap-2 text-[11px]">
                    <input
                      type="checkbox"
                      checked={r?.twoLevel ?? false}
                      onChange={(e) =>
                        toggle2LevelMut.mutate({ line, makeTwoLevel: e.target.checked })
                      }
                      className="h-4 w-4 rounded border-[var(--border-subtle)]"
                    />
                    <span className="text-[var(--content-secondary)]">
                      2-level (no inner boxes — outer contains pieces directly)
                    </span>
                  </label>
                ) : null}
              </div>

              {/* Input 1: Outer boxes */}
              <label className="text-[10px] font-semibold uppercase text-[var(--content-tertiary)] sm:text-right">
                <span className="sm:hidden">Outer boxes</span>
                <input
                  value={r?.outerBoxes ?? ''}
                  onChange={(e) => updateRow(line.id, { outerBoxes: e.target.value.replace(/[^\d]/g, '') })}
                  onBlur={() => saveRow(line, rows[line.id])}
                  readOnly={printed}
                  placeholder="0"
                  inputMode="numeric"
                  className="mt-1 block min-h-10 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2 font-mono text-base sm:w-20 sm:text-right"
                />
              </label>

              {/* Input 2: Inners per outer (disabled if 2-level) */}
              <label
                className={`text-[10px] font-semibold uppercase sm:text-right ${
                  r?.twoLevel ? 'text-[var(--content-tertiary)]/40' : 'text-[var(--content-tertiary)]'
                }`}
              >
                <span className="sm:hidden">Inners / outer</span>
                <input
                  value={r?.twoLevel ? '—' : r?.innersPerOuter ?? ''}
                  onChange={(e) =>
                    updateRow(line.id, { innersPerOuter: e.target.value.replace(/[^\d]/g, '') })
                  }
                  onBlur={() => saveRow(line, rows[line.id])}
                  readOnly={printed || r?.twoLevel}
                  disabled={r?.twoLevel}
                  placeholder={catalogHint.innersPerOuter != null ? String(catalogHint.innersPerOuter) : '—'}
                  inputMode="numeric"
                  className={`mt-1 block min-h-10 w-full rounded-lg border border-[var(--border-subtle)] px-2 font-mono text-base sm:w-20 sm:text-right ${
                    r?.twoLevel ? 'bg-[var(--bg-secondary)] text-[var(--content-tertiary)]' : 'bg-[var(--bg-primary)]'
                  }`}
                />
              </label>

              {/* Input 3: Pcs per inner (or pcs per outer if 2-level) */}
              <label className="text-[10px] font-semibold uppercase text-[var(--content-tertiary)] sm:text-right">
                <span className="sm:hidden">{r?.twoLevel ? 'Pcs / outer' : 'Pcs / inner'}</span>
                <input
                  value={r?.pcsPerInner ?? ''}
                  onChange={(e) => updateRow(line.id, { pcsPerInner: e.target.value.replace(/[^\d]/g, '') })}
                  onBlur={() => saveRow(line, rows[line.id])}
                  readOnly={printed}
                  placeholder={catalogHint.pcsPerInner != null ? String(catalogHint.pcsPerInner) : '—'}
                  inputMode="numeric"
                  className="mt-1 block min-h-10 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2 font-mono text-base sm:w-20 sm:text-right"
                />
              </label>

              {/* Status */}
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
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold text-sky-900 dark:bg-sky-950 dark:text-sky-100">
                    <Package size={12} /> Pending
                  </span>
                )}
              </div>
            </div>
          );
        })}

        {eligible.length === 0 ? (
          <p className="px-3 py-4 text-sm text-[var(--content-tertiary)]">
            No carton lines yet. Add a SKU below.
          </p>
        ) : null}
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-[var(--content-tertiary)]">
          {readyToPrint.length} of {eligible.length} ready · {pendingCount} pending print
          {readyToPrint.length === 0 && eligible.length > 0 ? (
            <span className="block text-amber-700 dark:text-amber-300">
              Enter <strong>outer box count</strong> on each line (pack sizes can come from catalog).
            </span>
          ) : null}
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <BigButton
            type="button"
            variant="primary"
            className="min-h-12 bg-[var(--bg-accent)] text-[var(--content-on-color)]"
            disabled={printAllMut.isPending || readyToPrint.length === 0}
            onClick={() => printAllMut.mutate(readyToPrint)}
          >
            <PrinterIcon className="mr-1 inline" size={18} />
            Print {readyToPrint.length || ''} outer label{readyToPrint.length === 1 ? '' : 's'}
          </BigButton>
          {printedOuterLines.length > 0 ? (
            <BigButton
              type="button"
              variant="secondary"
              className="min-h-12"
              disabled={reprintMut.isPending}
              onClick={() => reprintMut.mutate(printedOuterLines)}
            >
              <PrinterIcon className="mr-1 inline" size={18} />
              Reprint all outer ({printedOuterLines.length})
            </BigButton>
          ) : null}
          {allPrinted ? (
            <BigButton
              type="button"
              variant="primary"
              className="min-h-12 bg-[var(--bg-accent)] text-[var(--content-on-color)]"
              onClick={onAllDone}
            >
              Continue to Phase 2 — Sort
              <ArrowRight className="ml-1 inline" size={18} />
            </BigButton>
          ) : null}
        </div>
      </div>
    </div>
  );
}
