import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ArrowLeftIcon, UploadSimpleIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useItems } from '../../hooks/useItems';
import {
  saveBarcodeMapping,
} from '../../lib/barcodeMapping';
import { searchItems } from '../../lib/search/itemSearch';
import { buildSearchIndex } from '../../lib/search/searchIndex';
import {
  buildSaveInputFromVarrocChallan,
  normalizeVarrocChallanRow,
  rowHasBlockingChallanIssues,
  type VarrocChallanCsvRow,
} from '../../lib/scanner/oemBarcodeEngine';
import type { Item } from '../../types';
import { initializeItemScanIndex, getScanCatalogItemById, patchBarcodeMappingEntry } from '../../stores/itemScanIndex';
import { itemPickCode } from '../../utils/itemCodes';

function itemDisplayCode(item: Item): string {
  const busy = item.busy_code;
  if (busy != null && String(busy).trim() !== '') return `Busy ${busy}`;
  const pick = itemPickCode(item);
  return pick || `id ${item.id}`;
}

const BARCODE_COVERAGE_QUERY_KEY = ['barcode-coverage'] as const;
const BARCODE_RACK_COVERAGE_QUERY_KEY = ['barcode-rack-coverage'] as const;
const MAPPED_SKUS_QUERY_KEY = ['barcode-mapped-skus'] as const;

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (c === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && c === ',') {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function parseVarrocChallanCsv(text: string): VarrocChallanCsvRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const headers = parseCsvLine(lines[0]!).map((h) => h.toLowerCase());
  const col = (cols: string[], name: string): string => {
    const i = headers.indexOf(name.toLowerCase());
    return i >= 0 && i < cols.length ? cols[i]! : '';
  };
  const rows: VarrocChallanCsvRow[] = [];
  for (let li = 1; li < lines.length; li++) {
    const cols = parseCsvLine(lines[li]!);
    rows.push({
      line_no: col(cols, 'line_no'),
      varroc_part_code: col(cols, 'varroc_part_code'),
      sap_item_code: col(cols, 'sap_item_code'),
      hsn_code: col(cols, 'hsn_code'),
      description: col(cols, 'description'),
      confidence: col(cols, 'confidence'),
      handwritten_mrp: col(cols, 'handwritten_mrp'),
    });
  }
  return rows;
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface ProcessRowState {
  lineNo: string;
  csvRow: VarrocChallanCsvRow;
  description: string;
  normal: ReturnType<typeof normalizeVarrocChallanRow>;
  skuQuery: string;
  selectedItem: Item | null;
  /** User must acknowledge blocking issues before this row can be saved */
  acknowledged: boolean;
  saveStatus: SaveStatus;
  saveMessage?: string;
}

const primaryButton =
  'inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[var(--content-primary)] px-4 py-3 text-sm font-semibold text-[var(--bg-primary)] transition-opacity hover:opacity-90 disabled:opacity-50';

export default function ProcessChallanPage(): React.JSX.Element {
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { userId, userName } = useAuth();
  const { data: items = [] } = useItems();
  const searchIndex = useMemo(() => buildSearchIndex(items), [items]);

  const [rows, setRows] = useState<ProcessRowState[]>([]);
  const [bulkSaving, setBulkSaving] = useState(false);

  useEffect(() => {
    void initializeItemScanIndex();
  }, []);

  const hydrateRows = useCallback((csvRows: VarrocChallanCsvRow[]) => {
    setRows(
      csvRows.map((csvRow, i) => {
        const normal = normalizeVarrocChallanRow(csvRow);
        const blocking = rowHasBlockingChallanIssues(normal.issues);
        return {
          lineNo: (csvRow.line_no ?? '').trim() || String(i + 1),
          csvRow,
          description: (csvRow.description ?? '').trim(),
          normal,
          skuQuery:
            [(csvRow.description ?? '').trim(), (csvRow.sap_item_code ?? '').trim(), (csvRow.varroc_part_code ?? '').trim()]
              .filter(Boolean)
              .join(' ')
              .slice(0, 120) ?? '',
          selectedItem: null,
          acknowledged: !blocking,
          saveStatus: 'idle' as SaveStatus,
        };
      }),
    );
  }, []);

  const handleFile = useCallback(
    async (file: File) => {
      const text = await file.text();
      const parsed = parseVarrocChallanCsv(text);
      if (parsed.length === 0) {
        toast.warning('No data rows found in that file.');
        return;
      }
      hydrateRows(parsed);
      toast.success(`Loaded ${parsed.length} challan lines.`);
    },
    [hydrateRows, toast],
  );

  const updateRow = useCallback((lineNo: string, patch: Partial<ProcessRowState>) => {
    setRows((prev) => prev.map((r) => (r.lineNo === lineNo ? { ...r, ...patch } : r)));
  }, []);

  const rowSearchResults = useCallback(
    (query: string) => {
      if (!query || query.trim().length < 2) return [];
      return searchItems(query.trim(), searchIndex).slice(0, 8);
    },
    [searchIndex],
  );

  const saveableRows = rows.filter((r) => {
    const sugg = r.normal.mappingSuggestions[0];
    if (!sugg || r.selectedItem == null || r.selectedItem.busy_code == null) return false;
    if (rowHasBlockingChallanIssues(r.normal.issues) && !r.acknowledged) return false;
    if (r.saveStatus === 'saved') return false;
    return true;
  });

  const handleBulkSave = useCallback(async () => {
    if (saveableRows.length === 0) {
      toast.warning('Nothing to save — pick a SKU for each row and acknowledge warnings.');
      return;
    }
    setBulkSaving(true);
    let ok = 0;
    let fail = 0;
    for (const r of saveableRows) {
      const sugg = r.normal.mappingSuggestions[0];
      const busy = Number(r.selectedItem!.busy_code);
      if (!sugg || !Number.isFinite(busy)) continue;
      updateRow(r.lineNo, { saveStatus: 'saving' });
      try {
        const input = buildSaveInputFromVarrocChallan(sugg, {
          skuBusyCode: busy,
          mappedByUserId: userId,
          mappedByName: userName,
        });
        const result = await saveBarcodeMapping(input);
        if (!result.success) {
          fail++;
          updateRow(r.lineNo, {
            saveStatus: 'error',
            saveMessage: result.message ?? result.status,
          });
          continue;
        }
        ok++;
        updateRow(r.lineNo, {
          saveStatus: 'saved',
          saveMessage: result.status === 'already_mapped' ? 'Already mapped' : undefined,
        });
        const live = getScanCatalogItemById(r.selectedItem!.id);
        if (live) patchBarcodeMappingEntry(sugg.barcodeKey, live);
      } catch (e) {
        fail++;
        updateRow(r.lineNo, {
          saveStatus: 'error',
          saveMessage: e instanceof Error ? e.message : 'Save failed',
        });
      }
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: BARCODE_COVERAGE_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: BARCODE_RACK_COVERAGE_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: MAPPED_SKUS_QUERY_KEY }),
    ]);
    toast.success(`Saved ${ok} mapping(s). ${fail ? `${fail} failed.` : ''}`);
    setBulkSaving(false);
  }, [saveableRows, toast, queryClient, updateRow, userId, userName]);

  return (
    <div className="role-admin min-h-screen bg-[var(--bg-primary)]">
      <div className="mx-auto max-w-6xl px-4 py-4 lg:px-6">
        <button
          type="button"
          onClick={() => navigate('/admin/barcode-mapping')}
          className="mb-3 inline-flex min-h-11 items-center gap-2 rounded-xl px-1 text-sm font-semibold text-[var(--content-secondary)] hover:text-[var(--content-primary)]"
        >
          <ArrowLeftIcon size={18} weight="bold" />
          Barcode mapping
        </button>

        <h1 className="text-2xl font-bold text-[var(--content-primary)]">Process challan (Varroc)</h1>
        <p className="mt-1 max-w-3xl text-sm text-[var(--content-secondary)]">
          Upload a Varroc challan CSV. Each line maps one canonical barcode key (SAP K preferred) to a Busy SKU. Rows with SAP
          typos — e.g. <span className="font-mono">K3420106MK</span>, <span className="font-mono">K353A10400</span> — fix in
          the source file or Busy before saving. After applying migrations, run import on production data (operational step).
        </p>

        <div className="mt-6 rounded-xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-6">
          <label className="flex cursor-pointer flex-col items-center gap-2">
            <UploadSimpleIcon size={32} className="text-[var(--content-accent)]" />
            <span className="text-sm font-semibold text-[var(--content-primary)]">Drop CSV or click to upload</span>
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
                e.target.value = '';
              }}
            />
          </label>
        </div>

        {rows.length > 0 && (
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button type="button" disabled={bulkSaving || saveableRows.length === 0} onClick={() => void handleBulkSave()} className={primaryButton}>
              {bulkSaving ? 'Saving…' : `Save ${saveableRows.length} ready row(s)`}
            </button>
            <span className="text-sm text-[var(--content-tertiary)]">
              {rows.filter((r) => r.saveStatus === 'saved').length} / {rows.length} saved
            </span>
          </div>
        )}

        {rows.length > 0 && (
          <div className="mt-4 max-h-[70vh] overflow-auto rounded-xl border border-[var(--border-subtle)]">
            <table className="w-full min-w-[720px] border-collapse text-left text-sm">
              <thead className="sticky top-0 z-[1] bg-[var(--bg-secondary)] text-xs font-semibold uppercase tracking-wide text-[var(--content-tertiary)]">
                <tr>
                  <th className="px-2 py-2">#</th>
                  <th className="px-2 py-2">SAP / printed</th>
                  <th className="px-2 py-2">Description</th>
                  <th className="px-2 py-2">Issues</th>
                  <th className="px-2 py-2 min-w-[200px]">SKU</th>
                  <th className="px-2 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)] text-[var(--content-primary)]">
                {rows.map((r) => {
                  const sugg = r.normal.mappingSuggestions[0];
                  const blocking = rowHasBlockingChallanIssues(r.normal.issues);
                  const results = rowSearchResults(r.skuQuery);
                  return (
                    <tr key={r.lineNo} className="align-top bg-[var(--bg-primary)]">
                      <td className="px-2 py-2 font-mono text-xs">{r.lineNo}</td>
                      <td className="px-2 py-2 font-mono text-xs">
                        {sugg ? (
                          <>
                            <div className="font-semibold">{sugg.barcodeKey}</div>
                            <div className="text-[var(--content-tertiary)]">{sugg.matchStrategy}</div>
                          </>
                        ) : (
                          <span className="text-[var(--content-warning)]">No key</span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-xs text-[var(--content-secondary)] max-w-[220px]">{r.description}</td>
                      <td className="px-2 py-2 text-xs">
                        {r.normal.issues.length === 0 ? (
                          '—'
                        ) : (
                          <ul className="list-inside list-disc space-y-1 text-[var(--content-warning)]">
                            {r.normal.issues.map((iss) => (
                              <li key={iss}>{iss}</li>
                            ))}
                            {r.normal.sapFixSuggestions.length > 0 && (
                              <li className="text-[var(--content-tertiary)]">
                                Try: {r.normal.sapFixSuggestions.join(', ')}
                              </li>
                            )}
                          </ul>
                        )}
                        {blocking && (
                          <label className="mt-2 flex cursor-pointer items-center gap-2 text-[var(--content-primary)]">
                            <input
                              type="checkbox"
                              checked={r.acknowledged}
                              onChange={(e) => updateRow(r.lineNo, { acknowledged: e.target.checked })}
                            />
                            <span>Acknowledge warnings</span>
                          </label>
                        )}
                      </td>
                      <td className="px-2 py-2">
                        <input
                          value={r.skuQuery}
                          onChange={(e) => updateRow(r.lineNo, { skuQuery: e.target.value })}
                          placeholder="Search Busy item…"
                          className="mb-1 w-full min-h-9 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-2 font-sans text-xs outline-none focus:border-[var(--content-accent)]"
                        />
                        {r.selectedItem && (
                          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-positive-subtle)] px-2 py-1 text-xs">
                            <span className="font-semibold tabular-nums">{itemDisplayCode(r.selectedItem)}</span>
                            <span className="text-[var(--content-secondary)]"> · {r.selectedItem.name}</span>
                          </div>
                        )}
                        {results.length > 0 && (
                          <ul className="mt-1 max-h-32 overflow-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] text-xs">
                            {results.map((res) => (
                              <li key={res.item.id}>
                                <button
                                  type="button"
                                  className="w-full px-2 py-1.5 text-left hover:bg-[var(--bg-tertiary)]"
                                  onClick={() => updateRow(r.lineNo, { selectedItem: res.item })}
                                >
                                  <span className="font-mono font-semibold">{itemDisplayCode(res.item)}</span> {res.item.name}
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                      <td className="px-2 py-2 text-xs">
                        {r.saveStatus === 'saved' && <span className="text-[var(--content-positive)]">Saved</span>}
                        {r.saveStatus === 'error' && (
                          <span className="flex items-start gap-1 text-[var(--content-negative)]">
                            <WarningCircleIcon size={16} className="shrink-0" />
                            {r.saveMessage ?? 'Error'}
                          </span>
                        )}
                        {r.saveStatus === 'idle' && '—'}
                        {r.saveStatus === 'saving' && '…'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-6 text-xs text-[var(--content-tertiary)]">
          Tip: apply Supabase migrations <span className="font-mono">044_extend_match_strategy_oem</span> then{' '}
          <span className="font-mono">045_wipe_item_barcodes</span> in order on your project before the first production import.
        </p>
      </div>
    </div>
  );
}
