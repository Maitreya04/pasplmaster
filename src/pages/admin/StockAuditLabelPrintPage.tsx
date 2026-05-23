import { useCallback, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Printer, UploadSimple } from '@phosphor-icons/react';
import { useItems } from '../../hooks/useItems';
import { useToast } from '../../context/ToastContext';
import { BigButton } from '../../components/shared';
import {
  matchStockStatusToItems,
  stockStatusMatchSummary,
  type MatchedStockStatusRow,
} from '../../lib/packCatalog/matchStockStatusToItems';
import {
  busyStockStatusTotals,
  parseBusyStockStatusCsv,
  type BusyStockStatusRow,
} from '../../lib/packCatalog/parseBusyStockStatusCsv';
import { openBulkPieceLabelsPrint } from '../../lib/packCatalog/printPackLabels';
import {
  loadPrecutPrintOffsets,
  precutSheetSummary,
  PRECUT_SHEET,
  savePrecutPrintOffsets,
  type PrecutPrintOffsets,
} from '../../lib/packCatalog/precutSheetLayout';
import { PrecutSheetPreview } from '../../components/packCatalog/PrecutSheetPreview';

type GroupFilter = 'all' | string;

function matchStatusLabel(row: MatchedStockStatusRow): string {
  if (row.matchStatus === 'ok') return 'Ready';
  if (row.matchStatus === 'unmatched') return 'Not in catalog';
  if (row.matchStatus === 'ambiguous') return 'Multiple matches';
  return 'No busy code';
}

export default function StockAuditLabelPrintPage(): React.JSX.Element {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const { data: items = [], isLoading: itemsLoading } = useItems();

  const [stockRows, setStockRows] = useState<BusyStockStatusRow[] | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [skippedZeroOrNegative, setSkippedZeroOrNegative] = useState(0);
  const [groupFilter, setGroupFilter] = useState<GroupFilter>('all');
  const [printing, setPrinting] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [precutOffsets, setPrecutOffsets] = useState<PrecutPrintOffsets>(loadPrecutPrintOffsets);

  const matchedRows = useMemo(() => {
    if (!stockRows) return [];
    return matchStockStatusToItems(stockRows, items);
  }, [stockRows, items]);

  const groupOptions = useMemo(() => {
    if (!stockRows) return [];
    const set = new Set<string>();
    for (const row of stockRows) set.add(row.group.trim() || 'Ungrouped');
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [stockRows]);

  const filteredRows = useMemo(() => {
    if (groupFilter === 'all') return matchedRows;
    return matchedRows.filter((r) => (r.group.trim() || 'Ungrouped') === groupFilter);
  }, [matchedRows, groupFilter]);

  const totals = useMemo(
    () => (stockRows ? busyStockStatusTotals(stockRows) : null),
    [stockRows],
  );

  const matchStats = useMemo(() => stockStatusMatchSummary(matchedRows), [matchedRows]);

  const filteredPrintable = useMemo(() => {
    const rows = groupFilter === 'all' ? matchedRows : filteredRows;
    return rows.filter((r) => r.matchStatus === 'ok' && r.item && r.busyCode != null);
  }, [matchedRows, filteredRows, groupFilter]);

  const filteredLabelCount = useMemo(
    () => filteredPrintable.reduce((sum, r) => sum + r.labelCount, 0),
    [filteredPrintable],
  );

  const loadCsv = useCallback(
    (text: string, name: string) => {
      try {
        const parsed = parseBusyStockStatusCsv(text);
        if (parsed.rows.length === 0) {
          toast.error('No in-stock SKU rows found — check Part Number and Stock Qty columns');
          return;
        }
        setStockRows(parsed.rows);
        setFileName(name);
        setSkippedZeroOrNegative(parsed.skippedZeroOrNegative);
        setGroupFilter('all');
        const t = busyStockStatusTotals(parsed.rows);
        const skipNote =
          parsed.skippedZeroOrNegative > 0
            ? ` · skipped ${parsed.skippedZeroOrNegative} zero/negative`
            : '';
        toast.success(
          `Loaded ${t.skuCount} in-stock SKUs · ${t.labelCount.toLocaleString('en-IN')} labels planned${skipNote}`,
        );
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Could not parse CSV');
      }
    },
    [toast],
  );

  const handleFile = async (file: File) => {
    const text = await file.text();
    loadCsv(text, file.name);
  };

  const handlePrecutOffsetsChange = useCallback((next: PrecutPrintOffsets) => {
    setPrecutOffsets(next);
    savePrecutPrintOffsets(next);
  }, []);

  const openPrintWindow = async (autoPrint: boolean) => {
    const requests = filteredPrintable.map((r) => ({
      item: r.item!,
      busyCode: r.busyCode!,
      count: r.labelCount,
    }));
    if (requests.length === 0) {
      toast.info('No matched SKUs to print for this selection');
      return;
    }

    const setBusy = autoPrint ? setPrinting : setPreviewing;
    setBusy(true);
    try {
      const groupLabel = groupFilter === 'all' ? 'All groups' : groupFilter;
      const result = await openBulkPieceLabelsPrint({
        requests,
        offsets: precutOffsets,
        autoPrint,
        title: `Stock audit — ${groupLabel}`,
      });
      if (result.blocked) {
        toast.error('Allow pop-ups to preview or print labels');
      } else if (result.cardCount === 0) {
        toast.info('Nothing to print');
      } else if (autoPrint) {
        toast.success(
          `Printing ${result.cardCount.toLocaleString('en-IN')} piece labels (${Math.ceil(result.cardCount / PRECUT_SHEET.labelsPerPage)} sheets)`,
        );
      } else {
        toast.success(`Preview: ${result.cardCount.toLocaleString('en-IN')} labels`);
      }
    } finally {
      setBusy(false);
    }
  };

  const problemRows = matchedRows.filter((r) => r.matchStatus !== 'ok');

  return (
    <div className="role-admin min-h-screen bg-[var(--bg-primary)] pb-24">
      <header className="sticky top-0 z-30 border-b border-[var(--border-subtle)] bg-[var(--bg-primary)]/95 backdrop-blur px-4 py-3">
        <div className="mx-auto flex max-w-4xl items-center gap-3">
          <Link
            to="/admin"
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--bg-secondary)] text-[var(--content-secondary)]"
            aria-label="Back to admin"
          >
            <ArrowLeft size={20} weight="bold" />
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-bold text-[var(--content-primary)]">
              Stock audit label print
            </h1>
            <p className="text-xs text-[var(--content-tertiary)]">
              {precutSheetSummary(PRECUT_SHEET)} · one piece label per stock qty unit
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-5 px-4 py-5">
        <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4 space-y-3">
          <p className="text-sm text-[var(--content-secondary)]">
            Upload your Busy stock status CSV after a physical count. The app matches Part Number to
            your catalog, skips zero and negative stock, and prints one piece sticker per counted
            unit on Oddy precut sheets.
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-2 rounded-xl bg-[var(--role-primary)] px-4 py-2.5 text-sm font-semibold text-white"
            >
              <UploadSimple size={18} weight="bold" />
              Upload stock CSV
            </button>
          </div>
          {fileName ? (
            <p className="text-xs text-[var(--content-tertiary)]">
              Loaded: <span className="font-medium text-[var(--content-secondary)]">{fileName}</span>
              {skippedZeroOrNegative > 0 ? (
                <span className="ml-2 text-[var(--content-warning)]">
                  · {skippedZeroOrNegative} row{skippedZeroOrNegative === 1 ? '' : 's'} skipped
                  (qty ≤ 0)
                </span>
              ) : null}
            </p>
          ) : null}
        </section>

        {stockRows && totals ? (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard label="In-stock SKUs" value={String(totals.skuCount)} />
              <StatCard label="Labels planned" value={totals.labelCount.toLocaleString('en-IN')} />
              <StatCard
                label="Ready to print"
                value={matchStats.printableLabels.toLocaleString('en-IN')}
                tone="positive"
              />
              <StatCard
                label="Need attention"
                value={String(
                  matchStats.unmatched + matchStats.ambiguous + matchStats.noBusyCode,
                )}
                tone={
                  matchStats.unmatched + matchStats.ambiguous + matchStats.noBusyCode > 0
                    ? 'warning'
                    : undefined
                }
              />
            </div>

            <PrecutSheetPreview
              spec={PRECUT_SHEET}
              outerCount={0}
              innerCount={0}
              individualCount={1}
              offsets={precutOffsets}
              onOffsetsChange={handlePrecutOffsetsChange}
            />

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setGroupFilter('all')}
                className={`rounded-full px-3 py-1.5 text-sm font-semibold transition-colors ${
                  groupFilter === 'all'
                    ? 'bg-[var(--role-primary)] text-white'
                    : 'bg-[var(--bg-secondary)] text-[var(--content-secondary)] border border-[var(--border-subtle)]'
                }`}
              >
                All groups
                <span className="ml-1 opacity-80">({totals.labelCount.toLocaleString('en-IN')})</span>
              </button>
              {groupOptions.map((group) => {
                const bucket = totals.byGroup[group];
                const labels = bucket?.labels ?? 0;
                const active = groupFilter === group;
                return (
                  <button
                    key={group}
                    type="button"
                    onClick={() => setGroupFilter(group)}
                    className={`rounded-full px-3 py-1.5 text-sm font-semibold transition-colors ${
                      active
                        ? 'bg-[var(--role-primary)] text-white'
                        : 'bg-[var(--bg-secondary)] text-[var(--content-secondary)] border border-[var(--border-subtle)]'
                    }`}
                  >
                    {group}
                    <span className="ml-1 opacity-80">({labels.toLocaleString('en-IN')})</span>
                  </button>
                );
              })}
            </div>

            {problemRows.length > 0 ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <p className="font-semibold">
                  {problemRows.length} SKU{problemRows.length === 1 ? '' : 's'} won&apos;t print until
                  fixed in catalog
                </p>
                <ul className="mt-2 max-h-32 overflow-y-auto text-xs space-y-1">
                  {problemRows.slice(0, 12).map((r) => (
                    <li key={`${r.lineIndex}-${r.partNumber}`}>
                      {r.partNumber} — {matchStatusLabel(r)}
                    </li>
                  ))}
                  {problemRows.length > 12 ? (
                    <li className="text-amber-700">…and {problemRows.length - 12} more</li>
                  ) : null}
                </ul>
              </div>
            ) : null}

            <div className="overflow-x-auto rounded-2xl border border-[var(--border-subtle)]">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="bg-[var(--bg-secondary)] text-xs uppercase tracking-wide text-[var(--content-tertiary)]">
                  <tr>
                    <th className="px-3 py-2">Part number</th>
                    <th className="px-3 py-2">Description</th>
                    <th className="px-3 py-2">Group</th>
                    <th className="px-3 py-2 text-right">Stock qty</th>
                    <th className="px-3 py-2 text-right">Labels</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => (
                    <tr
                      key={`${row.lineIndex}-${row.partNumber}`}
                      className="border-t border-[var(--border-subtle)] hover:bg-[var(--bg-secondary)]"
                    >
                      <td className="px-3 py-2 font-mono text-xs font-semibold text-[var(--content-primary)]">
                        {row.partNumber}
                      </td>
                      <td className="px-3 py-2 max-w-[240px]">
                        <div className="font-medium text-[var(--content-primary)] line-clamp-2">
                          {row.description || row.item?.name || '—'}
                        </div>
                        {row.item ? (
                          <div className="text-xs text-[var(--content-tertiary)]">
                            Busy {row.busyCode ?? '—'}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-xs text-[var(--content-secondary)]">
                        {row.group.trim() || '—'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.stockQty}</td>
                      <td className="px-3 py-2 text-right font-bold tabular-nums">
                        {row.labelCount}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <span
                          className={
                            row.matchStatus === 'ok'
                              ? 'text-[var(--content-positive)] font-semibold'
                              : 'text-[var(--content-warning)] font-semibold'
                          }
                        >
                          {matchStatusLabel(row)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-[var(--border-subtle)] bg-[var(--bg-primary)] p-4 safe-area-pb">
              <div className="mx-auto flex max-w-4xl flex-col gap-2 sm:flex-row">
                <BigButton
                  variant="secondary"
                  disabled={previewing || printing || itemsLoading || filteredLabelCount === 0}
                  onClick={() => void openPrintWindow(false)}
                  className="sm:flex-1"
                >
                  Preview {filteredLabelCount.toLocaleString('en-IN')} labels
                </BigButton>
                <BigButton
                  disabled={previewing || printing || itemsLoading || filteredLabelCount === 0}
                  onClick={() => void openPrintWindow(true)}
                  className="sm:flex-1"
                >
                  <Printer size={20} weight="bold" className="mr-2 inline" />
                  Print {filteredLabelCount.toLocaleString('en-IN')} labels
                </BigButton>
              </div>
              <p className="mx-auto mt-2 max-w-4xl text-center text-xs text-[var(--content-tertiary)]">
                {Math.ceil(filteredLabelCount / PRECUT_SHEET.labelsPerPage)} A4 sheets at 100% scale ·
                pop-up must be allowed
              </p>
            </div>
          </>
        ) : (
          <p className="text-center text-sm text-[var(--content-tertiary)] py-12">
            {itemsLoading ? 'Loading catalog…' : 'Upload a Busy stock status CSV to begin.'}
          </p>
        )}
      </main>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'positive' | 'warning';
}): React.JSX.Element {
  const valueClass =
    tone === 'positive'
      ? 'text-[var(--content-positive)]'
      : tone === 'warning'
        ? 'text-[var(--content-warning)]'
        : 'text-[var(--content-primary)]';
  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--content-tertiary)]">
        {label}
      </p>
      <p className={`mt-1 text-xl font-bold tabular-nums ${valueClass}`}>{value}</p>
    </div>
  );
}
