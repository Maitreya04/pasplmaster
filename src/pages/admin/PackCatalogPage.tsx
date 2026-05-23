import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  MagnifyingGlass,
  MapPin,
  Printer,
  UploadSimple,
  DownloadSimple,
  PencilSimple,
} from '@phosphor-icons/react';
import * as XLSX from 'xlsx';
import { useItems } from '../../hooks/useItems';
import { useToast } from '../../context/ToastContext';
import {
  fetchItemPackDefinitions,
  PACK_DEFINITIONS_QUERY_KEY,
} from '../../lib/packLpn';
import {
  importPackDefinitions,
  type PackDefinitionImportResult,
} from '../../lib/import/packDefinitionsImporter';
import { detectFileType } from '../../lib/import/fileDetector';
import {
  buildPackCatalogRows,
  uniqueBrands,
  type PackCatalogRow,
} from '../../lib/packCatalog/buildPackCatalogRows';
import {
  filterPackCatalogRows,
  sortPackCatalogRows,
} from '../../lib/packCatalog/filterPackCatalogRows';
import { derivePackFromCatalog } from '../../lib/packCatalog/derivePackHint';
import {
  INDIVIDUAL_RADIO_OPTIONS,
  sellUnitDisplay,
  sellUnitFromRadio,
  statusBadgeLabel,
} from '../../lib/packCatalog/operatorLabels';
import {
  quickSavePackQty,
  savePackDefinition,
  validatePackQtys,
} from '../../lib/packCatalog/savePackDefinition';
import type { SellUnit } from '../../lib/packCatalog/operatorLabels';
import {
  downloadCsv,
  exportPackCatalogRowsCsv,
  formatImportSummary,
  packCatalogTemplateCsv,
} from '../../lib/packCatalog/exportPackCatalogCsv';
import { openPackCatalogLabelsPrint, openPackCatalogPrintWindow } from '../../lib/packCatalog/printPackLabels';
import { openRackLabelsPrint, openRackLabelsPrintWindow } from '../../lib/packCatalog/printRackLabels';
import { normalizeRackNo, saveItemRackNo } from '../../lib/packCatalog/saveItemRack';
import { ITEMS_QUERY_KEY } from '../../hooks/useItems';
import type { Item } from '../../types';
import {
  loadPrecutPrintOffsets,
  PRECUT_SHEET,
  precutSheetSummary,
  savePrecutPrintOffsets,
  type PrecutPrintOffsets,
} from '../../lib/packCatalog/precutSheetLayout';
import { PrecutSheetPreview } from '../../components/packCatalog/PrecutSheetPreview';
import { BottomSheet, BigButton } from '../../components/shared';

function RackInlineCell({
  value,
  disabled,
  onSave,
}: {
  value: string | null;
  disabled?: boolean;
  onSave: (next: string | null) => Promise<void>;
}): React.JSX.Element {
  const [draft, setDraft] = useState(value?.trim() ?? '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(value?.trim() ?? '');
  }, [value]);

  const commit = async () => {
    const next = normalizeRackNo(draft);
    const current = normalizeRackNo(value);
    if (next === current) return;
    setSaving(true);
    try {
      await onSave(next);
    } finally {
      setSaving(false);
    }
  };

  return (
    <input
      type="text"
      disabled={disabled || saving}
      value={draft}
      placeholder="52R-49C"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          void commit();
        }
      }}
      className="min-w-[7rem] max-w-[10rem] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2 py-1 font-mono text-xs uppercase disabled:opacity-50"
      title="Type rack location, then click away to save"
    />
  );
}

function PackQtyInlineCell({
  value,
  placeholder,
  disabled,
  onSave,
}: {
  value: number | null;
  placeholder: string;
  disabled?: boolean;
  onSave: (next: number | null) => Promise<void>;
}): React.JSX.Element {
  const [draft, setDraft] = useState(value != null ? String(value) : '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(value != null ? String(value) : '');
  }, [value]);

  const commit = async () => {
    const trimmed = draft.trim();
    const next = trimmed === '' ? null : Math.floor(Number(trimmed));
    if (trimmed !== '' && (!Number.isFinite(next) || (next ?? 0) < 1)) return;
    if (next === value) return;
    setSaving(true);
    try {
      await onSave(next);
    } finally {
      setSaving(false);
    }
  };

  return (
    <input
      type="number"
      min={1}
      disabled={disabled || saving}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          void commit();
        }
      }}
      className="w-16 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2 py-1 text-sm tabular-nums disabled:opacity-50"
      title="Enter pieces per carton, then click away to save"
    />
  );
}

/** Keeps status + edit/print visible when the table scrolls horizontally. */
const STICKY_STATUS_CELL =
  'sticky right-[7.75rem] z-10 min-w-[6.5rem] border-l border-[var(--border-subtle)] bg-[var(--bg-primary)] group-hover:bg-[var(--bg-secondary)]';
const STICKY_ACTIONS_CELL =
  'sticky right-0 z-20 min-w-[7.75rem] border-l border-[var(--border-subtle)] bg-[var(--bg-primary)] shadow-[-6px_0_10px_-6px_rgba(0,0,0,0.12)] group-hover:bg-[var(--bg-secondary)]';
const STICKY_STATUS_HEAD =
  'sticky right-[7.75rem] z-10 min-w-[6.5rem] border-l border-[var(--border-subtle)] bg-[var(--bg-secondary)]';
const STICKY_ACTIONS_HEAD =
  'sticky right-0 z-20 min-w-[7.75rem] border-l border-[var(--border-subtle)] bg-[var(--bg-secondary)]';

function StatusBadge({ status }: { status: PackCatalogRow['status'] }): React.JSX.Element {
  const tone =
    status === 'ready'
      ? 'bg-[var(--bg-positive-subtle)] text-[var(--content-positive)]'
      : status === 'incomplete'
        ? 'bg-[var(--bg-warning-subtle)] text-[var(--content-warning)]'
        : 'bg-[var(--bg-tertiary)] text-[var(--content-tertiary)]';
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}>
      {statusBadgeLabel(status)}
    </span>
  );
}

export default function PackCatalogPage(): React.JSX.Element {
  const toast = useToast();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const { data: items = [], isLoading: itemsLoading } = useItems();

  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query.trim());
  const [brand, setBrand] = useState<string>('');
  const [incompleteOnly, setIncompleteOnly] = useState(false);
  const [hasRackOnly, setHasRackOnly] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<PackDefinitionImportResult | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const [editRow, setEditRow] = useState<PackCatalogRow | null>(null);
  const [editOuter, setEditOuter] = useState('');
  const [editInner, setEditInner] = useState('');
  const [editIndividual, setEditIndividual] = useState<string>(INDIVIDUAL_RADIO_OPTIONS[0]);
  const [saving, setSaving] = useState(false);

  const [printRow, setPrintRow] = useState<PackCatalogRow | null>(null);
  const [printOuterCount, setPrintOuterCount] = useState(1);
  const [printInnerCount, setPrintInnerCount] = useState(1);
  const [printIndividualCount, setPrintIndividualCount] = useState(1);
  const [printing, setPrinting] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [precutOffsets, setPrecutOffsets] = useState<PrecutPrintOffsets>(loadPrecutPrintOffsets);

  const [rackPrintRow, setRackPrintRow] = useState<PackCatalogRow | null>(null);
  const [rackPrintCount, setRackPrintCount] = useState(1);
  const [rackPrinting, setRackPrinting] = useState(false);

  const packQuery = useQuery({
    queryKey: PACK_DEFINITIONS_QUERY_KEY,
    queryFn: fetchItemPackDefinitions,
  });

  const allRows = useMemo(
    () => buildPackCatalogRows(items, packQuery.data ?? []),
    [items, packQuery.data],
  );

  const brands = useMemo(() => uniqueBrands(allRows), [allRows]);

  const filteredRows = useMemo(() => {
    const filtered = filterPackCatalogRows(allRows, {
      query: deferredQuery,
      brand: brand || null,
      incompleteOnly,
      hasRackOnly,
    });
    return sortPackCatalogRows(filtered);
  }, [allRows, deferredQuery, brand, incompleteOnly, hasRackOnly]);

  const incompleteCount = useMemo(
    () => allRows.filter((r) => r.status === 'incomplete').length,
    [allRows],
  );

  const openEdit = useCallback((row: PackCatalogRow) => {
    setEditRow(row);
    setEditOuter(row.outerQty != null ? String(row.outerQty) : '');
    setEditInner(row.innerQty != null ? String(row.innerQty) : '');
    setEditIndividual(sellUnitDisplay(row.sellUnit));
  }, []);

  const openPrint = useCallback((row: PackCatalogRow) => {
    setPrintRow(row);
    setPrintOuterCount(row.outerQty != null ? 1 : 0);
    setPrintInnerCount(row.innerQty != null ? 1 : 0);
    setPrintIndividualCount(row.sellUnit !== 'PACK' ? 1 : 0);
  }, []);

  const openRackPrint = useCallback((row: PackCatalogRow) => {
    setRackPrintRow(row);
    setRackPrintCount(1);
  }, []);

  const editStructure = useMemo(() => {
    if (!editRow) return null;
    const outer = editOuter.trim() ? Math.floor(Number(editOuter)) : null;
    const inner = editInner.trim() ? Math.floor(Number(editInner)) : null;
    return derivePackFromCatalog({
      busy_code: editRow.busyCode ?? 0,
      item_id_snapshot: editRow.item.id,
      item_name_snapshot: editRow.item.name,
      inner_pack_qty: inner,
      outer_pack_qty: outer,
      sell_unit: sellUnitFromRadio(editIndividual),
      source_file: null,
      updated_at: '',
    }).label;
  }, [editRow, editOuter, editInner, editIndividual]);

  const handleSaveEdit = async () => {
    if (!editRow || editRow.busyCode == null) return;
    const outer = editOuter.trim() ? Math.floor(Number(editOuter)) : null;
    const inner = editInner.trim() ? Math.floor(Number(editInner)) : null;
    const err = validatePackQtys(inner, outer);
    if (err) {
      toast.error(err);
      return;
    }
    setSaving(true);
    try {
      await savePackDefinition({
        busyCode: editRow.busyCode,
        itemId: editRow.item.id,
        itemName: editRow.item.name,
        innerPackQty: inner,
        outerPackQty: outer,
        sellUnit: sellUnitFromRadio(editIndividual),
      });
      await queryClient.invalidateQueries({ queryKey: PACK_DEFINITIONS_QUERY_KEY });
      toast.success('Pack sizes saved');
      setEditRow(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const handlePrecutOffsetsChange = useCallback((next: PrecutPrintOffsets) => {
    setPrecutOffsets(next);
    savePrecutPrintOffsets(next);
  }, []);

  const openLabelsWindow = async (autoPrint: boolean) => {
    if (!printRow || printRow.busyCode == null) return;
    const printWindow = openPackCatalogPrintWindow();
    if (!printWindow) {
      toast.error('Allow pop-ups to preview or print labels');
      return;
    }
    const setBusy = autoPrint ? setPrinting : setPreviewing;
    setBusy(true);
    try {
      const result = await openPackCatalogLabelsPrint({
        item: printRow.item,
        busyCode: printRow.busyCode,
        outerPackQty: printRow.outerQty,
        innerPackQty: printRow.innerQty,
        sellUnit: printRow.sellUnit ?? 'EACH',
        structure: printRow.structure,
        selection: {
          outerCount: printOuterCount,
          innerCount: printInnerCount,
          individualCount: printIndividualCount,
        },
        offsets: precutOffsets,
        autoPrint,
        targetWindow: printWindow,
      });
      if (result.blocked) {
        toast.error('Allow pop-ups to preview or print labels');
      } else if (result.cardCount === 0) {
        toast.info('Select at least one sticker type with a valid pack size');
      } else if (autoPrint) {
        toast.success(`Opened print for ${result.cardCount} label${result.cardCount === 1 ? '' : 's'}`);
      } else {
        toast.success(`Preview opened (${result.cardCount} label${result.cardCount === 1 ? '' : 's'})`);
      }
    } finally {
      setBusy(false);
    }
  };

  const handlePrint = () => openLabelsWindow(true);
  const handleFullPreview = () => openLabelsWindow(false);

  const handleRackPrint = () => {
    if (!rackPrintRow) return;
    const binId = normalizeRackNo(rackPrintRow.item.rack_no);
    if (!binId) {
      toast.error('Set a rack number before printing rack labels');
      return;
    }
    const printWindow = openRackLabelsPrintWindow();
    if (!printWindow) {
      toast.error('Allow pop-ups to print rack labels');
      return;
    }
    setRackPrinting(true);
    void (async () => {
      try {
        const fpq = rackPrintRow.packDef?.bin_forward_pick_qty;
        const label = {
          binId,
          itemName: rackPrintRow.item.name?.trim() || rackPrintRow.alias1Display,
          pickCode: rackPrintRow.pickCode,
          busyCode: rackPrintRow.busyCode,
          forwardPickQty: fpq != null && fpq >= 1 ? fpq : null,
        };
        const labels = Array.from({ length: Math.max(1, rackPrintCount) }, () => label);
        const result = await openRackLabelsPrint({
          labels,
          autoPrint: true,
          targetWindow: printWindow,
        });
        if (result.blocked) {
          toast.error('Allow pop-ups to print rack labels');
        } else if (result.labelCount === 0) {
          toast.info('No rack labels to print');
        } else {
          toast.success(
            `Opened print for ${result.labelCount} rack label${result.labelCount === 1 ? '' : 's'}`,
          );
          setRackPrintRow(null);
        }
      } catch (e) {
        printWindow.close();
        toast.error(e instanceof Error ? e.message : 'Could not print rack labels');
      } finally {
        setRackPrinting(false);
      }
    })();
  };

  const handleFileImport = async (file: File) => {
    setImporting(true);
    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array' });
      const detection = detectFileType(wb);
      if (detection.type !== 'item_pack_definitions') {
        toast.error('Expected Pack defination.csv format (Itemname, MAST.BOX, INNER.BOX)');
        return;
      }
      const result = await importPackDefinitions(
        wb,
        file.name,
        detection.headerRowIndex,
        () => {},
      );
      await queryClient.invalidateQueries({ queryKey: PACK_DEFINITIONS_QUERY_KEY });
      setImportResult(result);
      toast.success(formatImportSummary(result));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const saveInlineRack = useCallback(
    async (row: PackCatalogRow, value: string | null) => {
      try {
        await saveItemRackNo(row.item.id, value);
        queryClient.setQueryData<Item[]>(ITEMS_QUERY_KEY, (prev) =>
          (prev ?? []).map((item) =>
            item.id === row.item.id ? { ...item, rack_no: value } : item,
          ),
        );
        await queryClient.invalidateQueries({ queryKey: ITEMS_QUERY_KEY });
        toast.success(value ? 'Rack saved' : 'Rack cleared');
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Could not save rack');
        throw e;
      }
    },
    [queryClient, toast],
  );

  const saveInlineQty = useCallback(
    async (row: PackCatalogRow, field: 'outer' | 'inner', value: number | null) => {
      if (row.busyCode == null) return;
      try {
        await quickSavePackQty(
          {
            busyCode: row.busyCode,
            itemId: row.item.id,
            itemName: row.item.name,
            outerQty: row.outerQty,
            innerQty: row.innerQty,
            sellUnit: (row.sellUnit ?? 'EACH') as SellUnit,
          },
          field,
          value,
        );
        await queryClient.invalidateQueries({ queryKey: PACK_DEFINITIONS_QUERY_KEY });
        toast.success(field === 'outer' ? 'Outer box saved' : 'Inner box saved');
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Could not save');
        throw e;
      }
    },
    [queryClient, toast],
  );

  const loading = itemsLoading || packQuery.isLoading;

  return (
    <div className="role-admin min-h-screen bg-[var(--bg-primary)]">
      <div className="mx-auto max-w-6xl p-4 lg:px-6 pb-24">
        <div className="mb-4 flex items-center gap-3">
          <Link
            to="/admin"
            className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--bg-secondary)] text-[var(--content-secondary)]"
            aria-label="Back to admin"
          >
            <ArrowLeft size={20} />
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold text-[var(--content-primary)]">Pack catalog</h1>
            <p className="text-sm text-[var(--content-tertiary)]">
              Find a part, see outer / inner / piece sizes, print three QR sticker types
            </p>
          </div>
        </div>

        {incompleteCount > 0 && (
          <button
            type="button"
            onClick={() => setIncompleteOnly(true)}
            className="mb-4 w-full rounded-xl border border-[var(--border-warning)] bg-[var(--bg-warning-subtle)] px-4 py-3 text-left text-sm text-[var(--content-warning)]"
          >
            <strong>{incompleteCount}</strong> items missing pack sizes — tap to filter
          </button>
        )}

        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="relative min-w-0 flex-1">
            <MagnifyingGlass
              size={18}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--content-tertiary)]"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Alias 1, name, or rack…"
              className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] py-3 pl-10 pr-3 text-sm text-[var(--content-primary)]"
            />
          </div>
          <select
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
            className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-3 text-sm"
          >
            <option value="">All brands</option>
            {brands.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </div>

        <div className="mb-4 flex flex-wrap gap-2 text-sm">
          <label className="flex items-center gap-2 rounded-lg bg-[var(--bg-secondary)] px-3 py-2">
            <input
              type="checkbox"
              checked={incompleteOnly}
              onChange={(e) => setIncompleteOnly(e.target.checked)}
            />
            Incomplete pack
          </label>
          <label className="flex items-center gap-2 rounded-lg bg-[var(--bg-secondary)] px-3 py-2">
            <input
              type="checkbox"
              checked={hasRackOnly}
              onChange={(e) => setHasRackOnly(e.target.checked)}
            />
            Has rack only
          </label>
        </div>

        <div
          className={`mb-4 rounded-2xl border-2 border-dashed p-5 transition-colors ${
            dragOver
              ? 'border-[var(--role-primary)] bg-[var(--role-primary-subtle)]'
              : 'border-[var(--border-subtle)] bg-[var(--bg-secondary)]'
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) void handleFileImport(f);
          }}
        >
          <p className="text-sm font-semibold text-[var(--content-primary)]">
            Upload outer &amp; inner definitions
          </p>
          <p className="mt-1 text-xs text-[var(--content-tertiary)] leading-relaxed">
            Use your <strong>Pack defination.csv</strong> (or Excel). Column{' '}
            <strong>MAST.BOX</strong> = pieces in one outer carton, <strong>INNER.BOX</strong> = pieces in
            one inner carton. Rows with both empty are skipped — type sizes in the table below.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={importing}
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-2 rounded-xl bg-[var(--role-primary)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              <UploadSimple size={18} />
              {importing ? 'Importing…' : 'Choose file'}
            </button>
          </div>
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => downloadCsv('pack-definition-template.csv', packCatalogTemplateCsv())}
            className="inline-flex items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-2.5 text-sm font-semibold"
          >
            <DownloadSimple size={18} />
            CSV template
          </button>
          <button
            type="button"
            onClick={() =>
              downloadCsv(
                `pack-catalog-export-${new Date().toISOString().slice(0, 10)}.csv`,
                exportPackCatalogRowsCsv(filteredRows),
              )
            }
            className="inline-flex items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-2.5 text-sm font-semibold"
          >
            <DownloadSimple size={18} />
            Export list ({filteredRows.length})
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFileImport(f);
            }}
          />
        </div>

        <p className="mb-3 text-xs text-[var(--content-tertiary)]">
          Tip: click Rack, Outer box, or Inner box cells to edit inline when the spreadsheet row was
          empty.
        </p>

        {loading ? (
          <p className="text-sm text-[var(--content-tertiary)]">Loading catalog…</p>
        ) : (
          <>
            <p className="mb-2 text-sm text-[var(--content-secondary)]">
              {filteredRows.length.toLocaleString('en-IN')} SKUs
            </p>

            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto rounded-2xl border border-[var(--border-subtle)]">
              <table className="w-full min-w-[960px] border-separate border-spacing-0 text-left text-sm">
                <thead className="bg-[var(--bg-secondary)] text-xs text-[var(--content-tertiary)]">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Alias 1</th>
                    <th className="px-3 py-2 font-semibold">Part description</th>
                    <th className="px-3 py-2 font-semibold">Rack</th>
                    <th className="px-3 py-2 font-semibold">
                      Outer box
                      <div className="font-normal">pieces per outer</div>
                    </th>
                    <th className="px-3 py-2 font-semibold">
                      Inner box
                      <div className="font-normal">pieces per inner</div>
                    </th>
                    <th className="px-3 py-2 font-semibold">
                      Individual
                      <div className="font-normal">pieces per unit</div>
                    </th>
                    <th className={`px-3 py-2 font-semibold ${STICKY_STATUS_HEAD}`}>Status</th>
                    <th className={`px-3 py-2 font-semibold ${STICKY_ACTIONS_HEAD}`}>Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {filteredRows.slice(0, 500).map((row) => (
                    <tr
                      key={row.item.id}
                      className="group bg-[var(--bg-primary)] hover:bg-[var(--bg-secondary)]"
                    >
                      <td className="px-3 py-2 font-mono text-xs font-semibold">{row.alias1Display}</td>
                      <td className="max-w-[280px] px-3 py-2 text-[var(--content-secondary)]">
                        {row.item.name?.trim() || '—'}
                      </td>
                      <td className="px-3 py-2">
                        <RackInlineCell
                          value={row.item.rack_no}
                          onSave={(v) => saveInlineRack(row, v)}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <PackQtyInlineCell
                          value={row.outerQty}
                          placeholder="200"
                          disabled={row.busyCode == null}
                          onSave={(v) => saveInlineQty(row, 'outer', v)}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <PackQtyInlineCell
                          value={row.innerQty}
                          placeholder="25"
                          disabled={row.busyCode == null}
                          onSave={(v) => saveInlineQty(row, 'inner', v)}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min={1}
                          value={1}
                          readOnly
                          className="w-16 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2 py-1 text-sm tabular-nums"
                          title="Piece scan always adds 1 pc"
                        />
                      </td>
                      <td className={`px-3 py-2 ${STICKY_STATUS_CELL}`}>
                        <StatusBadge status={row.status} />
                      </td>
                      <td className={`px-3 py-2 ${STICKY_ACTIONS_CELL}`}>
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={() => openEdit(row)}
                            className="rounded-lg p-2 hover:bg-[var(--bg-tertiary)]"
                            title="Edit pack"
                          >
                            <PencilSimple size={18} />
                          </button>
                          <button
                            type="button"
                            onClick={() => openRackPrint(row)}
                            disabled={!row.item.rack_no?.trim()}
                            className="rounded-lg p-2 hover:bg-[var(--bg-tertiary)] disabled:opacity-40"
                            title="Print rack label"
                          >
                            <MapPin size={18} />
                          </button>
                          <button
                            type="button"
                            onClick={() => openPrint(row)}
                            disabled={row.busyCode == null}
                            className="rounded-lg p-2 hover:bg-[var(--bg-tertiary)] disabled:opacity-40"
                            title="Print pack labels"
                          >
                            <Printer size={18} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredRows.length > 500 && (
                <p className="border-t border-[var(--border-subtle)] px-3 py-2 text-xs text-[var(--content-tertiary)]">
                  Showing first 500 — narrow search to see more
                </p>
              )}
            </div>

            {/* Mobile cards */}
            <div className="md:hidden space-y-3">
              {filteredRows.slice(0, 200).map((row) => (
                <div
                  key={row.item.id}
                  className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4"
                >
                  <p className="font-mono text-sm font-bold">{row.alias1Display}</p>
                  <p className="mt-1 text-sm text-[var(--content-secondary)] line-clamp-2">
                    {row.item.name?.trim() || '—'}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-xs text-[var(--content-tertiary)]">Rack</span>
                    <RackInlineCell
                      value={row.item.rack_no}
                      onSave={(v) => saveInlineRack(row, v)}
                    />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-xs text-[var(--content-tertiary)]">Outer</span>
                    <PackQtyInlineCell
                      value={row.outerQty}
                      placeholder="200"
                      disabled={row.busyCode == null}
                      onSave={(v) => saveInlineQty(row, 'outer', v)}
                    />
                    <span className="text-xs text-[var(--content-tertiary)]">Inner</span>
                    <PackQtyInlineCell
                      value={row.innerQty}
                      placeholder="25"
                      disabled={row.busyCode == null}
                      onSave={(v) => saveInlineQty(row, 'inner', v)}
                    />
                    <span className="text-xs text-[var(--content-tertiary)]">Individual</span>
                    <input
                      type="number"
                      min={1}
                      value={1}
                      readOnly
                      className="w-16 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2 py-1 text-sm tabular-nums"
                      title="Piece scan always adds 1 pc"
                    />
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <StatusBadge status={row.status} />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => openEdit(row)}
                        className="rounded-lg bg-[var(--bg-tertiary)] px-3 py-2 text-xs font-semibold"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => openRackPrint(row)}
                        disabled={!row.item.rack_no?.trim()}
                        className="rounded-lg bg-[var(--bg-tertiary)] px-3 py-2 text-xs font-semibold disabled:opacity-40"
                      >
                        Rack
                      </button>
                      <button
                        type="button"
                        onClick={() => openPrint(row)}
                        disabled={row.busyCode == null}
                        className="rounded-lg bg-[var(--role-primary)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
                      >
                        Pack
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <BottomSheet
        isOpen={importResult != null}
        onClose={() => setImportResult(null)}
        title="Import finished"
      >
        {importResult && (
          <div className="space-y-3 px-4 pb-6 text-sm">
            <p>{formatImportSummary(importResult)}</p>
            <ul className="list-disc space-y-1 pl-5 text-[var(--content-secondary)]">
              <li>
                <strong>{importResult.newCount + importResult.updatedCount}</strong> SKUs got outer/inner
                sizes from the file
              </li>
              {importResult.skippedNoPackQty > 0 && (
                <li>
                  <strong>{importResult.skippedNoPackQty}</strong> file rows had empty MAST.BOX and
                  INNER.BOX — fill them in Excel and re-import, or type in the table
                </li>
              )}
              {importResult.failedCount > 0 && (
                <li>
                  <strong>{importResult.failedCount}</strong> rows could not match Itemname / Part No. to
                  catalog
                </li>
              )}
            </ul>
            <BigButton onClick={() => setImportResult(null)}>Done</BigButton>
          </div>
        )}
      </BottomSheet>

      <BottomSheet isOpen={editRow != null} onClose={() => setEditRow(null)} title="Edit pack sizes">
        {editRow && (
          <div className="space-y-4 px-4 pb-6">
            <p className="text-sm font-semibold">{editRow.item.name}</p>
            <p className="text-xs text-[var(--content-tertiary)]">
              Alias 1: {editRow.alias1Display} · Rack: {editRow.item.rack_no ?? '—'}
            </p>
            <label className="block">
              <span className="text-sm font-semibold">Outer box — pieces in one outer carton</span>
              <input
                type="number"
                min={1}
                value={editOuter}
                onChange={(e) => setEditOuter(e.target.value)}
                className="mt-1 w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 py-3"
                placeholder="MAST.BOX e.g. 200"
              />
            </label>
            <label className="block">
              <span className="text-sm font-semibold">Inner box — pieces in one inner carton</span>
              <input
                type="number"
                min={1}
                value={editInner}
                onChange={(e) => setEditInner(e.target.value)}
                className="mt-1 w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 py-3"
                placeholder="INNER.BOX e.g. 25"
              />
            </label>
            <fieldset>
              <legend className="text-sm font-semibold">Individual — loose pieces when picking?</legend>
              <div className="mt-2 space-y-2">
                {INDIVIDUAL_RADIO_OPTIONS.map((opt) => (
                  <label key={opt} className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="sellUnit"
                      checked={editIndividual === opt}
                      onChange={() => setEditIndividual(opt)}
                    />
                    {opt}
                  </label>
                ))}
              </div>
              <p className="mt-1 text-xs text-[var(--content-tertiary)]">Piece scan always adds 1 pc</p>
            </fieldset>
            {editStructure && (
              <p className="rounded-lg bg-[var(--bg-tertiary)] px-3 py-2 text-sm text-[var(--content-secondary)]">
                {editStructure}
              </p>
            )}
            <BigButton onClick={() => void handleSaveEdit()} disabled={saving}>
              {saving ? 'Saving…' : 'Save pack sizes'}
            </BigButton>
          </div>
        )}
      </BottomSheet>

      <BottomSheet
        isOpen={rackPrintRow != null}
        onClose={() => setRackPrintRow(null)}
        title="Print rack label"
      >
        {rackPrintRow && (
          <div className="space-y-4 px-4 pb-6">
            <p className="text-sm font-semibold">{rackPrintRow.item.name}</p>
            <p className="text-xs text-[var(--content-tertiary)]">
              Rack <strong className="font-mono">{normalizeRackNo(rackPrintRow.item.rack_no) ?? '—'}</strong>{' '}
              · {rackPrintRow.pickCode}
            </p>
            <p className="text-xs text-[var(--content-tertiary)]">
              1.2″ rack strip with location, description, pick code, and bin QR (same as Label Studio
              bin labels).
            </p>
            <label className="flex items-center gap-2 text-sm">
              Labels to print
              <input
                type="number"
                min={1}
                max={99}
                value={rackPrintCount}
                onChange={(e) => setRackPrintCount(Math.max(1, Number(e.target.value) || 1))}
                className="w-20 rounded-lg border px-2 py-1"
              />
            </label>
            <BigButton onClick={() => void handleRackPrint()} disabled={rackPrinting}>
              {rackPrinting ? 'Preparing…' : 'Print rack labels'}
            </BigButton>
          </div>
        )}
      </BottomSheet>

      <BottomSheet
        isOpen={printRow != null}
        onClose={() => setPrintRow(null)}
        title="Print pack labels"
      >
        {printRow && printRow.busyCode != null && (
          <div className="space-y-4 px-4 pb-6">
            <p className="text-sm font-semibold">{printRow.item.name}</p>
            <p className="text-xs text-[var(--content-tertiary)]">
              {printRow.structure ?? 'Set pack sizes to print'}
            </p>
            <p className="text-xs text-[var(--content-tertiary)]">
              <strong>{PRECUT_SHEET.name}</strong> · {precutSheetSummary(PRECUT_SHEET)}. Print at
              100% scale, no fit-to-page.
            </p>

            <PrecutSheetPreview
              spec={PRECUT_SHEET}
              outerCount={printOuterCount}
              innerCount={printInnerCount}
              individualCount={printIndividualCount}
              offsets={precutOffsets}
              onOffsetsChange={handlePrecutOffsetsChange}
            />

            {printRow.outerQty != null && printRow.outerQty >= 1 && (
              <div className="rounded-xl border border-[var(--border-subtle)] p-3">
                <p className="text-sm font-bold">Outer box sticker</p>
                <p className="text-xs text-[var(--content-tertiary)]">
                  Scan adds {printRow.outerQty} pcs · PASPL-PACK outer QR only
                </p>
                <label className="mt-2 flex items-center gap-2 text-sm">
                  Labels to print
                  <input
                    type="number"
                    min={0}
                    max={99}
                    value={printOuterCount}
                    onChange={(e) => setPrintOuterCount(Math.max(0, Number(e.target.value) || 0))}
                    className="w-20 rounded-lg border px-2 py-1"
                  />
                </label>
              </div>
            )}

            {printRow.innerQty != null && printRow.innerQty >= 1 && (
              <div className="rounded-xl border border-[var(--border-subtle)] p-3">
                <p className="text-sm font-bold">Inner box sticker</p>
                <p className="text-xs text-[var(--content-tertiary)]">
                  Scan adds {printRow.innerQty} pcs · PASPL-PACK inner QR only
                </p>
                <label className="mt-2 flex items-center gap-2 text-sm">
                  Labels to print
                  <input
                    type="number"
                    min={0}
                    max={99}
                    value={printInnerCount}
                    onChange={(e) => setPrintInnerCount(Math.max(0, Number(e.target.value) || 0))}
                    className="w-20 rounded-lg border px-2 py-1"
                  />
                </label>
              </div>
            )}

            {printRow.sellUnit !== 'PACK' && (
              <div className="rounded-xl border border-[var(--border-subtle)] p-3">
                <p className="text-sm font-bold">Individual sticker</p>
                <p className="text-xs text-[var(--content-tertiary)]">
                  Scan adds 1 pc · Individual / piece QR ({printRow.alias1Display})
                </p>
                <label className="mt-2 flex items-center gap-2 text-sm">
                  Labels to print
                  <input
                    type="number"
                    min={0}
                    max={99}
                    value={printIndividualCount}
                    onChange={(e) =>
                      setPrintIndividualCount(Math.max(0, Number(e.target.value) || 0))
                    }
                    className="w-20 rounded-lg border px-2 py-1"
                  />
                </label>
              </div>
            )}

            {printRow.sellUnit === 'PACK' && (
              <p className="text-xs text-[var(--content-warning)]">
                Cartons only — no individual piece stickers for this SKU
              </p>
            )}

            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => void handleFullPreview()}
                disabled={printing || previewing}
                className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-3 text-sm font-semibold text-[var(--content-primary)] disabled:opacity-50"
              >
                {previewing ? 'Opening preview…' : 'Open full-size preview'}
              </button>
              <BigButton onClick={() => void handlePrint()} disabled={printing || previewing}>
                {printing ? 'Preparing…' : 'Print selected stickers'}
              </BigButton>
            </div>
          </div>
        )}
      </BottomSheet>
    </div>
  );
}
