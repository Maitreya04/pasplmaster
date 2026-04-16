import { startTransition, useDeferredValue, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeftIcon, ArrowsClockwiseIcon, PrinterIcon, TagIcon } from '@phosphor-icons/react';
import QRCode from 'qrcode';
import { useItems } from '../../hooks/useItems';
import type { Item } from '../../types';
import { itemAlternateCode, itemGroupLabel, itemPickCode } from '../../utils/itemCodes';

type LabelRecord = Item & {
  pickCode: string;
  alternateCode: string | null;
  groupLabel: string;
};

type SortMode = 'group-rack-code' | 'code-rack';
type PreviewScope = 'filtered' | 'selected';
type PrintPreset = 'rack-strip' | 'compact' | 'full';
type GroupFilter = 'unselected' | 'all' | string;

const RACK_STRIP_HEIGHT_MM = 30;
const RACK_STRIP_QR_SIZE_MM = 16;

const PRINT_CSS = `
  @page {
    size: A4 portrait;
    margin: 10mm;
  }

  @media print {
    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    body {
      background: #ffffff !important;
    }

    [data-print-hidden="true"] {
      display: none !important;
    }

    .print-root {
      padding: 0 !important;
      max-width: none !important;
    }

    .a4-label-sheet {
      display: grid !important;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 6mm;
    }

    .a4-label-card {
      break-inside: avoid;
      page-break-inside: avoid;
      min-height: 48mm;
      border-color: #cbd5e1 !important;
      box-shadow: none !important;
    }

    .a4-label-card[data-preset="rack-strip"] {
      min-height: 30mm;
      height: 30mm;
      padding: 0;
    }
  }

  .rack-strip-shell {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 18mm;
    gap: 2.5mm;
    height: 100%;
    padding: 3mm 3.5mm;
    align-items: stretch;
  }

  .rack-strip-copy {
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    overflow: hidden;
  }

  .rack-strip-code {
    font-variant-ligatures: none;
  }

  .rack-strip-description {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .rack-strip-qr-shell {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .rack-strip-qr {
    width: 16mm;
    height: 16mm;
  }

  .rack-strip-qr svg {
    display: block;
    width: 100%;
    height: 100%;
    shape-rendering: crispEdges;
  }
`;

function formatCount(value: number): string {
  return value.toLocaleString('en-IN');
}

function compareNullableText(a: string | null | undefined, b: string | null | undefined): number {
  return (a ?? '').localeCompare(b ?? '', undefined, { numeric: true, sensitivity: 'base' });
}

function csvEscape(value: string | number | null | undefined): string {
  const text = String(value ?? '');
  return `"${text.replaceAll('"', '""')}"`;
}

function downloadTextFile(fileName: string, body: string, mimeType: string): void {
  const blob = new Blob([body], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function matchesQuery(item: LabelRecord, query: string): boolean {
  if (!query) return true;
  const haystack = [
    item.pickCode,
    item.alias1,
    item.alias,
    item.name,
    item.rack_no,
    item.main_group,
    item.parent_group,
    item.groupLabel,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(query);
}

function MetricCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4">
      <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--content-tertiary)]">
        {label}
      </p>
      <p className="mt-2 text-[clamp(1.5rem,2.2vw,1.85rem)] font-bold leading-tight text-[var(--content-primary)] tabular-nums">
        {value}
      </p>
      <p className="mt-1 text-sm text-[var(--content-secondary)]">{hint}</p>
    </div>
  );
}

function buildManifestCsv(items: LabelRecord[]): string {
  const rows = [
    ['rack_no', 'pick_code', 'alias1', 'alias', 'item_name', 'main_group', 'parent_group'],
    ...items.map((item) => [
      item.rack_no ?? '',
      item.pickCode,
      item.alias1 ?? '',
      item.alias ?? '',
      item.name,
      item.main_group ?? '',
      item.parent_group ?? '',
    ]),
  ];
  return rows.map((row) => row.map((cell) => csvEscape(cell)).join(',')).join('\n');
}

function presetDescription(preset: PrintPreset): string {
  if (preset === 'rack-strip') return '1.2 inch rack strip with bold name + big code';
  if (preset === 'compact') return 'Rack + canonical code only';
  if (preset === 'full') return 'Rack + canonical code + alternate code + description';
  return 'Rack + canonical code + description';
}

function rackStripCodeStyle(code: string): CSSProperties {
  const length = code.trim().length;
  if (length <= 10) return { fontSize: '9.6mm', letterSpacing: '-0.06em', lineHeight: 0.88 };
  if (length <= 12) return { fontSize: '8.4mm', letterSpacing: '-0.055em', lineHeight: 0.88 };
  if (length <= 14) return { fontSize: '7.6mm', letterSpacing: '-0.05em', lineHeight: 0.88 };
  if (length <= 17) return { fontSize: '6.7mm', letterSpacing: '-0.045em', lineHeight: 0.88 };
  if (length <= 20) return { fontSize: '6.0mm', letterSpacing: '-0.04em', lineHeight: 0.88 };
  return { fontSize: '5.0mm', letterSpacing: '-0.03em', lineHeight: 0.84 };
}

function buildRecord(item: Item): LabelRecord | null {
  const pickCode = itemPickCode(item);
  if (!pickCode) return null;
  return {
    ...item,
    pickCode,
    alternateCode: itemAlternateCode(item),
    groupLabel: itemGroupLabel(item),
  };
}

export default function LabelStudioPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { data: items = [], isLoading, error, refetch, isFetching } = useItems();

  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const [onlyWithRack, setOnlyWithRack] = useState(false);
  const [groupFilter, setGroupFilter] = useState<GroupFilter>('unselected');
  const [sortMode, setSortMode] = useState<SortMode>('group-rack-code');
  const [previewScope, setPreviewScope] = useState<PreviewScope>('filtered');
  const [printPreset, setPrintPreset] = useState<PrintPreset>('rack-strip');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [qrByItemId, setQrByItemId] = useState<Record<number, string>>({});

  const labelableItems = useMemo<LabelRecord[]>(
    () =>
      items
        .map(buildRecord)
        .filter((item): item is LabelRecord => item !== null),
    [items],
  );

  const groupOptions = useMemo(
    () => Array.from(new Set(labelableItems.map((item) => item.groupLabel))).sort((a, b) => a.localeCompare(b)),
    [labelableItems],
  );

  const filteredItems = useMemo(() => {
    if (groupFilter === 'unselected') return [];

    const filtered = labelableItems
      .filter((item) => (onlyWithRack ? Boolean(item.rack_no?.trim()) : true))
      .filter((item) => (groupFilter === 'all' ? true : item.groupLabel === groupFilter))
      .filter((item) => matchesQuery(item, deferredQuery));

    return filtered.sort((a, b) => {
      if (sortMode === 'code-rack') {
        const codeCompare = a.pickCode.localeCompare(b.pickCode, undefined, {
          numeric: true,
          sensitivity: 'base',
        });
        if (codeCompare !== 0) return codeCompare;
        return compareNullableText(a.rack_no, b.rack_no);
      }

      const groupCompare = a.groupLabel.localeCompare(b.groupLabel, undefined, {
        sensitivity: 'base',
      });
      if (groupCompare !== 0) return groupCompare;
      const rackCompare = compareNullableText(a.rack_no, b.rack_no);
      if (rackCompare !== 0) return rackCompare;
      return a.pickCode.localeCompare(b.pickCode, undefined, {
        numeric: true,
        sensitivity: 'base',
      });
    });
  }, [deferredQuery, groupFilter, labelableItems, onlyWithRack, sortMode]);

  const selectedItems = useMemo(() => {
    const selectedSet = new Set(selectedIds);
    return labelableItems.filter((item) => selectedSet.has(item.id));
  }, [labelableItems, selectedIds]);

  const previewItems = useMemo(() => {
    if (previewScope === 'selected') return selectedItems;
    return filteredItems;
  }, [filteredItems, previewScope, selectedItems]);

  const brandChosen = groupFilter !== 'unselected';

  useEffect(() => {
    let cancelled = false;
    const pendingItems = previewItems.filter((item) => !qrByItemId[item.id]);
    if (pendingItems.length === 0) return;

    void Promise.all(
      pendingItems.map(async (item) => {
        const svgMarkup = await QRCode.toString(item.pickCode, {
          errorCorrectionLevel: 'M',
          margin: 0,
          type: 'svg',
          color: {
            dark: '#111827',
            light: '#ffffff',
          },
        });
        return [item.id, svgMarkup.replace('<svg', '<svg shape-rendering="crispEdges"')] as const;
      }),
    ).then((entries) => {
      if (cancelled) return;
      startTransition(() => {
        setQrByItemId((current) => {
          const next = { ...current };
          for (const [id, dataUrl] of entries) next[id] = dataUrl;
          return next;
        });
      });
    });

    return () => {
      cancelled = true;
    };
  }, [previewItems, qrByItemId]);

  const toggleSelected = (itemId: number) => {
    setSelectedIds((current) =>
      current.includes(itemId) ? current.filter((id) => id !== itemId) : [...current, itemId],
    );
  };

  const selectFiltered = () => {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const item of filteredItems) next.add(item.id);
      return Array.from(next);
    });
  };

  const clearSelection = () => {
    setSelectedIds([]);
  };

  const exportManifest = (scope: PreviewScope) => {
    const rows = scope === 'selected' ? selectedItems : filteredItems;
    if (rows.length === 0) return;
    downloadTextFile(
      `sku-label-manifest-${scope}-${new Date().toISOString().slice(0, 10)}.csv`,
      buildManifestCsv(rows),
      'text/csv;charset=utf-8',
    );
  };

  const printCurrentScope = () => {
    if (previewItems.length === 0) return;
    window.print();
  };

  return (
    <div className="role-admin min-h-screen bg-[var(--bg-primary)]">
      <style>{PRINT_CSS}</style>

      <div className="print-root mx-auto max-w-7xl px-4 pb-10 pt-4 lg:px-6">
        <div className="flex flex-wrap items-center gap-3" data-print-hidden="true">
          <button
            type="button"
            onClick={() => navigate('/admin')}
            className="inline-flex items-center gap-2 rounded-xl bg-[var(--bg-secondary)] px-3 py-2 text-sm font-semibold text-[var(--content-secondary)] hover:text-[var(--content-primary)]"
          >
            <ArrowLeftIcon size={18} weight="bold" />
            Back to admin
          </button>
          <button
            type="button"
            onClick={() => {
              void refetch();
            }}
            className="inline-flex items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 text-sm font-semibold text-[var(--content-secondary)] hover:text-[var(--content-primary)]"
          >
            <ArrowsClockwiseIcon
              size={18}
              weight="bold"
              className={isFetching ? 'animate-spin' : ''}
            />
            Refresh items
          </button>
        </div>

        <div className="mt-4 rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full bg-[var(--bg-accent-subtle)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--content-accent)]">
                <TagIcon size={14} weight="fill" />
                Alias Fallback
              </div>
              <h1 className="mt-3 text-2xl font-bold text-[var(--content-primary)]">
                SKU Label Studio
              </h1>
              <p className="mt-2 text-sm leading-6 text-[var(--content-secondary)]">
                Generate A4-friendly batch labels for every SKU that has either{' '}
                <span className="font-mono font-semibold">alias1</span> or{' '}
                <span className="font-mono font-semibold">alias</span>. Each QR encodes the
                canonical code: <span className="font-mono font-semibold">alias1 ?? alias</span>.
              </p>
            </div>

            <div className="rounded-2xl border border-[var(--bg-accent)] bg-[var(--bg-accent-subtle)] px-4 py-3 text-sm text-[var(--content-accent)] lg:max-w-sm">
              Pick a brand/group first, then the sheet prepares only that batch. That keeps QR
              rendering focused on the run you actually want to print.
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label="Labelable Items"
              value={formatCount(labelableItems.length)}
              hint="Items with alias1 or alias available"
            />
            <MetricCard
              label="Filtered"
              value={formatCount(filteredItems.length)}
              hint={
                brandChosen
                  ? 'Current list after search, group, and rack filters'
                  : 'Choose a brand/group to open a batch'
              }
            />
            <MetricCard
              label="Selected"
              value={formatCount(selectedItems.length)}
              hint="Manual picks for focused print runs"
            />
            <MetricCard
              label="Payload"
              value="alias1 → alias"
              hint="Canonical QR code fallback rule"
            />
          </div>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <section
            className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4 sm:p-5"
            data-print-hidden="true"
          >
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h2 className="text-base font-semibold text-[var(--content-primary)]">
                  Batch selection
                </h2>
                <p className="mt-1 text-sm text-[var(--content-tertiary)]">
                  Pick a brand/group first, then search inside that batch and build the A4 run you
                  want.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={selectFiltered}
                  disabled={filteredItems.length === 0}
                  className="rounded-xl bg-[var(--bg-accent-subtle)] px-3 py-2 text-sm font-semibold text-[var(--content-accent)] disabled:opacity-50"
                >
                  Select filtered
                </button>
                <button
                  type="button"
                  onClick={clearSelection}
                  disabled={selectedItems.length === 0}
                  className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 py-2 text-sm font-semibold text-[var(--content-secondary)] disabled:opacity-50"
                >
                  Clear selection
                </button>
              </div>
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search pick code, alias, rack, item name..."
                className="min-h-12 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-4 text-sm text-[var(--content-primary)] outline-none transition-[border-color,box-shadow] focus:border-[var(--bg-accent)] focus:shadow-[0_0_0_3px_var(--bg-accent-subtle)]"
              />
              <label className="inline-flex min-h-12 items-center gap-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-4 text-sm text-[var(--content-secondary)]">
                <input
                  type="checkbox"
                  checked={onlyWithRack}
                  onChange={(event) => setOnlyWithRack(event.target.checked)}
                  className="h-4 w-4 rounded border-[var(--border-subtle)]"
                />
                Only SKUs with a rack number
              </label>
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--content-tertiary)]">
                    Brand / Group
                  </span>
                  <select
                    value={groupFilter}
                    onChange={(event) => {
                      setGroupFilter(event.target.value as GroupFilter);
                      setQuery('');
                    }}
                    className="min-h-11 w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 text-sm text-[var(--content-primary)]"
                  >
                    <option value="unselected">Choose a brand/group</option>
                    <option value="all">All groups</option>
                    {groupOptions.map((group) => (
                      <option key={group} value={group}>
                        {group}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--content-tertiary)]">
                  Sort
                </span>
                <select
                  value={sortMode}
                  onChange={(event) => setSortMode(event.target.value as SortMode)}
                  className="min-h-11 w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 text-sm text-[var(--content-primary)]"
                >
                  <option value="group-rack-code">Group → rack → code</option>
                  <option value="code-rack">Code → rack</option>
                </select>
              </label>

              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--content-tertiary)]">
                  Sheet preset
                </span>
                <select
                  value={printPreset}
                  onChange={(event) => setPrintPreset(event.target.value as PrintPreset)}
                  className="min-h-11 w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 text-sm text-[var(--content-primary)]"
                >
                  <option value="rack-strip">Rack strip 1.2in</option>
                  <option value="compact">Canonical code only</option>
                  <option value="full">Canonical + alternate + description</option>
                </select>
              </label>
            </div>

            <div className="mt-4 overflow-hidden rounded-2xl border border-[var(--border-subtle)]">
              <div className="grid grid-cols-[auto_minmax(0,0.8fr)_minmax(0,0.95fr)_minmax(0,1.4fr)] gap-3 bg-[var(--bg-primary)] px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--content-tertiary)]">
                <span>Select</span>
                <span>Rack</span>
                <span>Code</span>
                <span>Item</span>
              </div>

              {isLoading ? (
                <div className="px-4 py-6 text-sm text-[var(--content-tertiary)]">Loading items...</div>
              ) : error ? (
                <div className="px-4 py-6 text-sm text-[var(--content-negative)]">
                  Could not load items for label generation.
                </div>
              ) : !brandChosen ? (
                <div className="px-4 py-6 text-sm text-[var(--content-tertiary)]">
                  Choose a brand/group first. The label tool will only prepare one batch at a time
                  so we do not waste time rendering QR codes for the whole catalog.
                </div>
              ) : filteredItems.length === 0 ? (
                <div className="px-4 py-6 text-sm text-[var(--content-tertiary)]">
                  No items matched this filter.
                </div>
              ) : (
                <ul className="max-h-[34rem] divide-y divide-[var(--border-subtle)] overflow-y-auto">
                  {filteredItems.map((item) => {
                    const isSelected = selectedIds.includes(item.id);
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          onClick={() => toggleSelected(item.id)}
                          className={`grid w-full grid-cols-[auto_minmax(0,0.8fr)_minmax(0,0.95fr)_minmax(0,1.4fr)] gap-3 px-4 py-3 text-left transition-colors ${
                            isSelected
                              ? 'bg-[var(--bg-accent-subtle)]'
                              : 'bg-[var(--bg-secondary)] hover:bg-[var(--bg-primary)]'
                          }`}
                        >
                          <span className="flex items-center">
                            <span
                              className={`inline-flex h-5 w-5 items-center justify-center rounded border text-xs font-bold ${
                                isSelected
                                  ? 'border-[var(--bg-accent)] bg-[var(--bg-accent)] text-white'
                                  : 'border-[var(--border-opaque)] bg-[var(--bg-primary)] text-transparent'
                              }`}
                            >
                              ✓
                            </span>
                          </span>

                          <span className="truncate font-mono text-sm text-[var(--content-primary)]">
                            {item.rack_no ?? 'No rack'}
                          </span>

                          <span className="min-w-0">
                            <span className="block truncate font-mono text-sm font-semibold text-[var(--content-accent)]">
                              {item.pickCode}
                            </span>
                            {item.alternateCode && (
                              <span className="block truncate text-xs text-[var(--content-tertiary)]">
                                Alt: {item.alternateCode}
                              </span>
                            )}
                          </span>

                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium text-[var(--content-primary)]">
                              {item.name}
                            </span>
                            <span className="block truncate text-xs text-[var(--content-tertiary)]">
                              {item.groupLabel}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>

          <section className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4 sm:p-5">
            <div
              className="flex flex-col gap-4 border-b border-[var(--border-subtle)] pb-4"
              data-print-hidden="true"
            >
              <div>
                <h2 className="text-base font-semibold text-[var(--content-primary)]">A4 print sheet</h2>
                <p className="mt-1 text-sm text-[var(--content-tertiary)]">
                  Choose whether the sheet is built from the filtered set or your manual selection,
                  then print or save as PDF from the browser dialog.
                </p>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--content-tertiary)]">
                    Preview scope
                  </span>
                  <select
                    value={previewScope}
                    onChange={(event) => setPreviewScope(event.target.value as PreviewScope)}
                    className="min-h-11 w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 text-sm text-[var(--content-primary)]"
                  >
                    <option value="filtered" disabled={!brandChosen}>
                      Filtered items
                    </option>
                    <option value="selected">Selected items</option>
                  </select>
                </label>

                <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-4 py-3 text-sm text-[var(--content-secondary)]">
                  <p className="font-semibold text-[var(--content-primary)]">
                    {previewScope === 'filtered'
                      ? `${formatCount(filteredItems.length)} filtered labels`
                      : `${formatCount(selectedItems.length)} selected labels`}
                  </p>
                  <p className="mt-1">{presetDescription(printPreset)}</p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={printCurrentScope}
                  disabled={previewItems.length === 0}
                  className="inline-flex items-center gap-2 rounded-xl bg-[var(--bg-accent)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  <PrinterIcon size={18} weight="bold" />
                  Print current A4 sheet
                </button>
                <button
                  type="button"
                  onClick={() => exportManifest(previewScope)}
                  disabled={previewItems.length === 0}
                  className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 py-2 text-sm font-semibold text-[var(--content-secondary)] disabled:opacity-50"
                >
                  Export current manifest CSV
                </button>
                <button
                  type="button"
                  onClick={() => exportManifest('filtered')}
                  disabled={filteredItems.length === 0}
                  className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 py-2 text-sm font-semibold text-[var(--content-secondary)] disabled:opacity-50"
                >
                  Export filtered CSV
                </button>
                <button
                  type="button"
                  onClick={() => exportManifest('selected')}
                  disabled={selectedItems.length === 0}
                  className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 py-2 text-sm font-semibold text-[var(--content-secondary)] disabled:opacity-50"
                >
                  Export selected CSV
                </button>
              </div>
            </div>

            {previewItems.length === 0 ? (
              <div className="py-8 text-sm text-[var(--content-tertiary)]" data-print-hidden="true">
                {previewScope === 'selected'
                  ? 'Select one or more rows to build the A4 sheet.'
                  : !brandChosen
                    ? 'Choose a brand/group first to prepare a filtered A4 batch.'
                  : 'Adjust the current filters to build the A4 sheet.'}
              </div>
            ) : (
              <div className="a4-label-sheet mt-4 grid gap-4 sm:grid-cols-2" data-preset={printPreset}>
                {previewItems.map((item) => {
                  const qrMarkup = qrByItemId[item.id];
                  const isRackStrip = printPreset === 'rack-strip';
                  const showDescription = printPreset !== 'compact';
                  const showAlternateCode = printPreset === 'full' && Boolean(item.alternateCode);
                  const wrapRackCode = item.pickCode.trim().length > 12;

                  return (
                    <article
                      key={item.id}
                      data-preset={printPreset}
                      className={`a4-label-card border border-[var(--border-opaque)] bg-white text-slate-900 shadow-sm ${
                        isRackStrip ? 'rounded-none' : 'rounded-3xl'
                      } ${
                        isRackStrip ? 'overflow-hidden' : 'p-4'
                      }`}
                      style={isRackStrip ? { height: `${RACK_STRIP_HEIGHT_MM}mm` } : undefined}
                    >
                      {isRackStrip ? (
                        <div className="rack-strip-shell">
                          <div className="rack-strip-copy">
                            <div className="min-w-0">
                              <p
                                className={`rack-strip-code block min-w-0 font-sans font-black uppercase text-slate-900 ${
                                  wrapRackCode ? 'whitespace-normal break-all' : 'whitespace-nowrap'
                                }`}
                                style={rackStripCodeStyle(item.pickCode)}
                              >
                                {item.pickCode}
                              </p>
                              {showAlternateCode && item.alternateCode && (
                                <p className="mt-1 font-mono text-xs text-slate-500">
                                  Alt: {item.alternateCode}
                                </p>
                              )}
                              {showDescription && (
                                <p
                                  className={`rack-strip-description text-slate-700 ${
                                    wrapRackCode
                                      ? 'mt-[0.7mm] text-[3.3mm] font-semibold leading-[1.02]'
                                      : 'mt-[1.2mm] text-[3.8mm] font-semibold leading-tight'
                                  }`}
                                >
                                  {item.name}
                                </p>
                              )}
                            </div>
                            <p className="font-mono text-[3.5mm] leading-none tracking-[0.18em] text-slate-500">
                              {item.rack_no ?? 'NO-RACK'}
                            </p>
                          </div>

                          <div className="rack-strip-qr-shell">
                            {qrMarkup ? (
                              <div
                                className="rack-strip-qr"
                                aria-label={`QR for ${item.pickCode}`}
                                role="img"
                                dangerouslySetInnerHTML={{ __html: qrMarkup }}
                              />
                            ) : (
                              <div
                                className="flex items-center justify-center text-center text-xs text-slate-500"
                                style={{
                                  width: `${RACK_STRIP_QR_SIZE_MM}mm`,
                                  height: `${RACK_STRIP_QR_SIZE_MM}mm`,
                                }}
                              >
                                Rendering QR...
                              </div>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="flex h-full items-stretch gap-3">
                          <div className="flex min-w-0 flex-1 flex-col">
                            <div className="flex items-start justify-end">
                              <p className="font-mono text-2xl font-bold leading-none text-slate-500">
                                {item.rack_no ?? 'NO-RACK'}
                              </p>
                            </div>

                            <div className="min-w-0 mt-4 space-y-1">
                              <p className="mt-2 font-mono text-base font-black tracking-[-0.04em] text-slate-900">
                                {item.pickCode}
                              </p>
                              {showAlternateCode && item.alternateCode && (
                                <p className="mt-1 font-mono text-xs text-slate-500">
                                  Alt: {item.alternateCode}
                                </p>
                              )}
                              {showDescription && (
                                <p className="line-clamp-3 text-sm font-medium text-slate-800">
                                  {item.name}
                                </p>
                              )}
                            </div>
                          </div>

                          <div className="flex shrink-0 items-center justify-center">
                            <div className="flex h-28 w-28 items-center justify-center rounded-[22px] border border-slate-200 bg-slate-50 p-2">
                              {qrMarkup ? (
                                <img
                                  src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrMarkup)}`}
                                  alt={`QR for ${item.pickCode}`}
                                  className="h-24 w-24"
                                />
                              ) : (
                                <div className="text-center text-xs text-slate-500">Rendering QR...</div>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
