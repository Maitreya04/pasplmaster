import { useCallback, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowLeftIcon,
  BarcodeIcon,
  CameraIcon,
  CheckCircleIcon,
  DatabaseIcon,
  MagnifyingGlassIcon,
  MapPinIcon,
  SealWarningIcon,
  SkipForwardIcon,
  XCircleIcon,
} from '@phosphor-icons/react';
import { LiveQrScanner, SearchInput } from '../../components/shared';

import type { LiveQrScannerResolved } from '../../components/shared/LiveQrScanner';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useItems } from '../../hooks/useItems';
import {
  fetchMappedSkuSummaries,
  fetchBarcodeCoverage,
  fetchBarcodeRackCoverage,
  loadSkuFromBusyCode,
  loadSkuOptionsFromBin,
  normalizeBinCode,
  saveBarcodeMapping,
  type BarcodeCoverage,
  type BarcodeSkuOption,
  type SaveBarcodeMappingResult,
} from '../../lib/barcodeMapping';
import { searchItems } from '../../lib/search/itemSearch';
import { buildSearchIndex } from '../../lib/search/searchIndex';
import {
  parseManufacturerBarcode,
  type ParsedBarcode,
} from '../../lib/scanner/barcodeParser';
import { buildSaveInputForScan } from '../../lib/scanner/oemBarcodeEngine';
import { classifyScanPayload, normalizeScanCode, parseRackPayload } from '../../lib/scanner/qrPayload';
import { resolveScannedCatalogItem, getScanCatalogItemById, patchBarcodeMappingEntry } from '../../stores/itemScanIndex';

type MappingDirection = 'bin_first' | 'scan_first';

type MappingStep =
  | 'scan_bin'
  | 'choose_sku'
  | 'bin_loaded'
  | 'barcode_detected'
  | 'saving'
  | 'saved'
  | 'conflict'
  | 'already_mapped'
  | 'no_barcode'
  | 'scan_barcode_first'
  | 'search_sku';

type ScannerMode = 'bin' | 'barcode';

interface SessionStats {
  mapped: number;
  alreadyMapped: number;
  skipped: number;
  conflictsResolved: number;
}

const BARCODE_COVERAGE_QUERY_KEY = ['barcode-coverage'] as const;
const BARCODE_RACK_COVERAGE_QUERY_KEY = ['barcode-rack-coverage'] as const;
const MAPPED_SKUS_QUERY_KEY = ['barcode-mapped-skus'] as const;

const EMPTY_STATS: SessionStats = {
  mapped: 0,
  alreadyMapped: 0,
  skipped: 0,
  conflictsResolved: 0,
};

const primaryButton =
  'inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[var(--content-primary)] px-4 py-3 text-sm font-semibold text-[var(--bg-primary)] transition-opacity hover:opacity-90 disabled:opacity-50';
const secondaryButton =
  'inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-3 text-sm font-semibold text-[var(--content-primary)] transition-colors hover:bg-[var(--bg-tertiary)] disabled:opacity-50';
const dangerButton =
  'inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[var(--bg-negative)] px-4 py-3 text-sm font-semibold text-[var(--content-inverse-primary)] transition-opacity hover:opacity-90 disabled:opacity-50';

function formatNumber(value: number | null | undefined): string {
  return Number(value ?? 0).toLocaleString('en-IN');
}

function formatCoverage(coverage: BarcodeCoverage | undefined): string {
  if (!coverage) return 'Loading coverage...';
  return `${formatNumber(coverage.mapped_skus)} / ${formatNumber(coverage.total_active_skus)} active SKUs (${coverage.coverage_pct}%)`;
}

function rackStatusLabel(row: { mapped_skus: number; total_skus: number }): string {
  if (row.total_skus <= 0) return '—';
  if (row.mapped_skus >= row.total_skus) return 'Complete';
  if (row.mapped_skus > 0) return 'In progress';
  return 'Not started';
}

function rackStatusClass(row: { mapped_skus: number; total_skus: number }): string {
  if (row.total_skus <= 0) {
    return 'bg-[var(--bg-tertiary)] text-[var(--content-tertiary)]';
  }
  if (row.mapped_skus >= row.total_skus) {
    return 'bg-[var(--bg-positive-subtle)] text-[var(--content-positive)]';
  }
  if (row.mapped_skus > 0) {
    return 'bg-[var(--bg-warning-subtle)] text-[var(--content-warning)]';
  }
  return 'bg-[var(--bg-negative-subtle)] text-[var(--content-negative)]';
}

function isLikelyManufacturerPartKey(value: string): boolean {
  const key = value.trim().toUpperCase();
  if (!key) return false;
  if (key.length < 4 || key.length > 36) return false;
  if (/\n/.test(key)) return false;
  if (/\b(?:MRP|QTY|COMMODITY|NUMBER OF|PACKED)\b/.test(key)) return false;
  if (/^[A-Z0-9][A-Z0-9.\-/]{3,}$/.test(key) && /[A-Z]/.test(key) && /\d/.test(key)) return true;
  if (/^\d{6,18}$/.test(key)) return true;
  return false;
}

function StatTile({ label, value }: { label: string; value: number }): React.JSX.Element {
  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3">
      <p className="text-xs font-medium text-[var(--content-tertiary)]">{label}</p>
      <p className="mt-1 text-2xl font-bold leading-none text-[var(--content-primary)] tabular-nums">
        {formatNumber(value)}
      </p>
    </div>
  );
}

function ItemSummary({ sku }: { sku: BarcodeSkuOption }): React.JSX.Element {
  const aliasDisplay = sku.alias1 || sku.alias
    ? `Alias 1 ${sku.alias1 ?? '—'} · Alias ${sku.alias ?? '—'}`
    : 'Alias 1 — · Alias —';
  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--bg-accent-subtle)]">
          <DatabaseIcon size={20} weight="regular" className="text-[var(--content-accent)]" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--content-tertiary)]">
            Bin {sku.binId}
          </p>
          <p className="mt-1 text-lg font-bold leading-snug text-[var(--content-primary)]">
            {sku.itemName}
          </p>
          <p className="mt-1 text-sm text-[var(--content-secondary)]">
            {sku.mainGroup || sku.parentGroup || 'No group'} · Busy {sku.skuBusyCode}
          </p>
          <p className="mt-1 text-xs font-mono text-[var(--content-tertiary)]">
            {aliasDisplay}
          </p>
        </div>
      </div>
    </div>
  );
}

export default function BarcodeMappingPage(): React.JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const isPickingContext = location.pathname.startsWith('/picking/');
  const toast = useToast();
  const queryClient = useQueryClient();
  const { userId, userName } = useAuth();

  const [direction, setDirection] = useState<MappingDirection>('bin_first');
  const [step, setStep] = useState<MappingStep>('scan_bin');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerMode, setScannerMode] = useState<ScannerMode>('bin');
  const [loadingBin, setLoadingBin] = useState(false);
  const [saving, setSaving] = useState(false);
  const [manualBin, setManualBin] = useState('');
  const [manualBarcode, setManualBarcode] = useState('');
  const [currentBinId, setCurrentBinId] = useState<string | null>(null);
  const [skuOptions, setSkuOptions] = useState<BarcodeSkuOption[]>([]);
  const [selectedSku, setSelectedSku] = useState<BarcodeSkuOption | null>(null);
  const [pendingBarcode, setPendingBarcode] = useState<ParsedBarcode | null>(null);
  const [conflict, setConflict] = useState<SaveBarcodeMappingResult | null>(null);
  const [stats, setStats] = useState<SessionStats>(EMPTY_STATS);
  const [rackFilter, setRackFilter] = useState('');

  // Scan-first search state
  const [skuQuery, setSkuQuery] = useState('');
  const [loadingSkuLookup, setLoadingSkuLookup] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const { data: items = [] } = useItems();
  const searchIndex = useMemo(() => buildSearchIndex(items), [items]);

  const skuSearchResults = useMemo(() => {
    if (!skuQuery || skuQuery.length < 2) return [];
    return searchItems(skuQuery, searchIndex).slice(0, 20);
  }, [skuQuery, searchIndex]);

  // Auto-suggest: try to resolve the barcode against alias1/alias/itemCode maps,
  // then fall back to search index for code-like part numbers.
  const autoSuggestedItem = useMemo(() => {
    if (!pendingBarcode?.key) return null;

    // 1. Try every candidate the barcode parser extracted (best-first order)
    const allCandidates = [
      ...pendingBarcode.candidates,
      // Also always include raw if not already covered
      ...(pendingBarcode.candidates.includes(pendingBarcode.raw) ? [] : [pendingBarcode.raw]),
    ];
    for (const candidate of allCandidates) {
      const lookup = resolveScannedCatalogItem(candidate);
      if (lookup) return lookup;
    }

    // 2. Try each candidate through the search index
    for (const candidate of allCandidates) {
      const normalized = normalizeScanCode(candidate);
      if (normalized.length < 3) continue;

      const codeResults = searchItems(candidate, searchIndex);
      if (codeResults.length === 0) continue;

      // Exact single high-confidence match
      if (codeResults.length === 1 && codeResults[0].score >= 80) {
        return {
          code: normalized,
          item: { ...codeResults[0].item, itemCode: '' } as import('../../stores/itemScanIndex').ScanCatalogItem,
          source: 'alias1' as const,
        };
      }

      // Top result is significantly better than second (dominant match)
      if (
        codeResults.length >= 2 &&
        codeResults[0].score >= 85 &&
        codeResults[0].score - codeResults[1].score >= 10
      ) {
        return {
          code: normalized,
          item: { ...codeResults[0].item, itemCode: '' } as import('../../stores/itemScanIndex').ScanCatalogItem,
          source: 'alias1' as const,
        };
      }

      // Check if the top result's alias1 contains the part number (normalized)
      if (codeResults[0].score >= 80) {
        const topItem = codeResults[0].item;
        const topAlias1Norm = normalizeScanCode(topItem.alias1);
        if (topAlias1Norm && (topAlias1Norm === normalized || topAlias1Norm.includes(normalized) || normalized.includes(topAlias1Norm))) {
          return {
            code: normalized,
            item: { ...topItem, itemCode: '' } as import('../../stores/itemScanIndex').ScanCatalogItem,
            source: 'alias1' as const,
          };
        }
      }
    }

    return null;
  }, [pendingBarcode, searchIndex]);

  const { data: coverage } = useQuery({
    queryKey: BARCODE_COVERAGE_QUERY_KEY,
    queryFn: fetchBarcodeCoverage,
    staleTime: 30_000,
  });
  const { data: rackCoverage, isLoading: rackCoverageLoading } = useQuery({
    queryKey: BARCODE_RACK_COVERAGE_QUERY_KEY,
    queryFn: fetchBarcodeRackCoverage,
    staleTime: 30_000,
  });
  const { data: mappedSkuSummaries = [] } = useQuery({
    queryKey: MAPPED_SKUS_QUERY_KEY,
    queryFn: fetchMappedSkuSummaries,
    staleTime: 30_000,
  });
  const mappedSkuSet = useMemo(
    () => new Set(mappedSkuSummaries.map((entry) => entry.skuBusyCode)),
    [mappedSkuSummaries],
  );

  /** Per-bin progress for the SKU picker (same definition as rack coverage: SKU has ≥1 row in item_barcodes). */
  const binSkuMappingProgress = useMemo(() => {
    if (skuOptions.length === 0) return { mapped: 0, total: 0 };
    let mapped = 0;
    for (const opt of skuOptions) {
      if (mappedSkuSet.has(opt.skuBusyCode)) mapped += 1;
    }
    return { mapped, total: skuOptions.length };
  }, [skuOptions, mappedSkuSet]);

  const filteredRackRows = useMemo(() => {
    const rows = rackCoverage?.racks ?? [];
    const q = normalizeBinCode(rackFilter);
    if (!q) return rows;
    return rows.filter((row) => row.rack_id.includes(q));
  }, [rackCoverage, rackFilter]);

  const manufacturer = useMemo(
    () => selectedSku?.mainGroup ?? selectedSku?.parentGroup ?? null,
    [selectedSku],
  );
  const selectedSkuAlreadyMapped = selectedSku ? mappedSkuSet.has(selectedSku.skuBusyCode) : false;

  const resetForNext = useCallback((dir: MappingDirection) => {
    setStep(dir === 'scan_first' ? 'scan_barcode_first' : 'scan_bin');
    setScannerMode(dir === 'scan_first' ? 'barcode' : 'bin');
    setCurrentBinId(null);
    setSkuOptions([]);
    setSelectedSku(null);
    setPendingBarcode(null);
    setConflict(null);
    setManualBarcode('');
    setSkuQuery('');
  }, []);

  const resetForNextBin = useCallback(() => {
    resetForNext(direction);
  }, [direction, resetForNext]);

  const finishSoon = useCallback(() => {
    window.setTimeout(resetForNextBin, 1200);
  }, [resetForNextBin]);

  const handleDirectionChange = useCallback((dir: MappingDirection) => {
    setDirection(dir);
    resetForNext(dir);
  }, [resetForNext]);

  const handleLoadBin = useCallback(async (value: string) => {
    const binId = normalizeBinCode(value);
    if (!binId) {
      toast.warning('Enter or scan a bin code first.');
      return;
    }

    setLoadingBin(true);
    setScannerOpen(false);
    setCurrentBinId(binId);
    setManualBin(binId);
    setConflict(null);
    setPendingBarcode(null);

    try {
      const options = await loadSkuOptionsFromBin(binId);
      setSkuOptions(options);

      if (options.length === 0) {
        setSelectedSku(null);
        setStep('scan_bin');
        toast.error(`No active SKU found for bin ${binId}.`);
        return;
      }

      if (options.length === 1) {
        setSelectedSku(options[0]);
        setStep('bin_loaded');
        toast.success('Bin loaded.');
        return;
      }

      setSelectedSku(null);
      setStep('choose_sku');
      void queryClient.invalidateQueries({ queryKey: MAPPED_SKUS_QUERY_KEY });
      toast.info('Multiple SKUs found in this bin. Choose the one you are mapping.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not load this bin.';
      toast.error(message);
      setStep('scan_bin');
    } finally {
      setLoadingBin(false);
    }
  }, [queryClient, toast]);

  const handleScannerResolved = useCallback((scan: LiveQrScannerResolved) => {
    if (scannerMode === 'bin') {
      const rack = parseRackPayload(scan.rawValue);
      if (!rack?.rackCode) {
        toast.warning('Scan the bin or rack QR first.');
        return;
      }
      void handleLoadBin(rack.rackCode);
      return;
    }

    const classified = classifyScanPayload(scan.rawValue);
    if (classified.kind === 'rack') {
      toast.warning('That is another bin QR. Scan the manufacturer barcode on the item.');
      return;
    }

    const parsed = parseManufacturerBarcode(scan.rawValue);
    if (!parsed.key) {
      toast.warning('Barcode was empty after trimming. Please rescan.');
      return;
    }

    if (!isLikelyManufacturerPartKey(parsed.key)) {
      toast.warning('That scan looked like damaged/noisy QR data. Please point at the printed part-number barcode.');
      return;
    }

    setPendingBarcode(parsed);
    setManualBarcode(parsed.raw);
    setScannerOpen(false);
    // In scan-first mode, pre-fill the search box with the extracted key
    if (direction === 'scan_first') {
      setSkuQuery(parsed.key);
    }
    setStep(direction === 'scan_first' ? 'search_sku' : 'barcode_detected');
  }, [direction, handleLoadBin, scannerMode, toast]);

  const handleManualBarcodePreview = () => {
    const parsed = parseManufacturerBarcode(manualBarcode);
    if (!parsed.key) {
      toast.warning('Enter a manufacturer barcode first.');
      return;
    }
    setPendingBarcode(parsed);
    // In scan-first mode, pre-fill the search box with the extracted key
    if (direction === 'scan_first') {
      setSkuQuery(parsed.key);
    }
    setStep(direction === 'scan_first' ? 'search_sku' : 'barcode_detected');
  };

  const handleSave = useCallback(async (force = false) => {
    if (!selectedSku || !pendingBarcode) return;

    setSaving(true);
    setStep('saving');
    try {
      const input = buildSaveInputForScan(pendingBarcode, {
        skuBusyCode: selectedSku.skuBusyCode,
        binId: currentBinId,
        manufacturer,
        mappedByUserId: userId,
        mappedByName: userName,
      });
      const result = await saveBarcodeMapping({
        ...input,
        force,
      });

      if (!result.success && result.status === 'conflict') {
        setConflict(result);
        setStep('conflict');
        toast.warning('Barcode already belongs to another SKU.');
        return;
      }

      if (!result.success) {
        setStep('barcode_detected');
        toast.error(result.message ?? 'Could not save this barcode.');
        return;
      }

      if (result.status === 'already_mapped') {
        setStats((current) => ({ ...current, alreadyMapped: current.alreadyMapped + 1 }));
        setStep('already_mapped');
        toast.success('Already recorded.');
        finishSoon();
        return;
      }

      setStats((current) => ({
        ...current,
        mapped: current.mapped + 1,
        conflictsResolved: result.status === 'overridden'
          ? current.conflictsResolved + 1
          : current.conflictsResolved,
      }));
      setStep('saved');
      toast.success(result.status === 'overridden' ? 'Mapping updated.' : 'Barcode mapped.');
      void queryClient.invalidateQueries({ queryKey: BARCODE_COVERAGE_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: BARCODE_RACK_COVERAGE_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: MAPPED_SKUS_QUERY_KEY });

      // Patch the live scan index so the scanner resolves this barcode immediately
      // in the current browser session without waiting for a full index reload.
      if (pendingBarcode?.key && selectedSku.itemId != null) {
        const liveItem = getScanCatalogItemById(selectedSku.itemId);
        if (liveItem) {
          patchBarcodeMappingEntry(pendingBarcode.key, liveItem);
        }
      }

      finishSoon();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not save barcode mapping.';
      setStep('barcode_detected');
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }, [
    currentBinId,
    finishSoon,
    manufacturer,
    pendingBarcode,
    queryClient,
    userId,
    userName,
  ]);

  const handleSkip = () => {
    setStats((current) => ({ ...current, skipped: current.skipped + 1 }));
    setStep('no_barcode');
    toast.info('Skipped this item.');
    finishSoon();
  };

  const handleSelectSkuFromSearch = useCallback(async (busyCode: number) => {
    setLoadingSkuLookup(true);
    try {
      const sku = await loadSkuFromBusyCode(busyCode);
      if (!sku) {
        toast.error('Could not find that item in the catalog.');
        return;
      }
      setSelectedSku(sku);
      setCurrentBinId(sku.rackNo);
      setStep('barcode_detected');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not load item.';
      toast.error(message);
    } finally {
      setLoadingSkuLookup(false);
    }
  }, [toast]);

  const openBinScanner = () => {
    setScannerMode('bin');
    setScannerOpen(true);
  };

  const openBarcodeScanner = () => {
    if (direction === 'bin_first' && !selectedSku) return;
    setScannerMode('barcode');
    setScannerOpen(true);
  };

  const scannerTitle = scannerMode === 'bin'
    ? 'Scan bin QR'
    : selectedSku
      ? `Scan barcode for Busy ${selectedSku.skuBusyCode}`
      : 'Scan manufacturer barcode';

  return (
    <div className={`${isPickingContext ? 'role-picking' : 'role-admin'} min-h-screen bg-[var(--bg-primary)]`}>
      <div className="mx-auto max-w-3xl px-4 py-4 lg:px-6">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <button
              type="button"
              onClick={() => navigate(isPickingContext ? '/picking' : '/admin')}
              className="mb-3 inline-flex min-h-11 items-center gap-2 rounded-xl px-1 text-sm font-semibold text-[var(--content-secondary)] hover:text-[var(--content-primary)]"
            >
              <ArrowLeftIcon size={18} weight="bold" />
              {isPickingContext ? 'Picking' : 'Admin'}
            </button>
            <h1 className="text-2xl font-bold leading-tight text-[var(--content-primary)]">
              Barcode Mapping
            </h1>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-[var(--content-secondary)]">
              Map manufacturer barcodes to Busy SKUs so future scans can verify the physical item.
            </p>
          </div>
          {!isPickingContext && (
            <button
              type="button"
              onClick={() => navigate('/admin/barcode-mapping/import')}
              className={`${secondaryButton} shrink-0`}
            >
              <DatabaseIcon size={18} weight="bold" />
              Import from challan
            </button>
          )}
        </div>

        <div className="mb-5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--bg-positive-subtle)]">
              <BarcodeIcon size={20} weight="regular" className="text-[var(--content-positive)]" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[var(--content-primary)]">
                Barcode coverage: {formatCoverage(coverage)}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-[var(--content-tertiary)]">
                Each saved key can be reused by picking, break-pack, and verification screens later.
              </p>
            </div>
          </div>
        </div>

        <details className="group mb-5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] [&_summary::-webkit-details-marker]:hidden">
          <summary className="flex cursor-pointer list-none items-center gap-3 p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--bg-accent-subtle)]">
              <MapPinIcon size={20} weight="regular" className="text-[var(--content-accent)]" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-[var(--content-primary)]">Rack-wise mapping progress</p>
              <p className="mt-1 text-xs leading-relaxed text-[var(--content-tertiary)]">
                Built from each SKU&apos;s rack location on file plus WMS bin slots. Complete means every SKU in that
                rack or bin has at least one manufacturer barcode saved.
              </p>
            </div>
            <span className="shrink-0 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--content-secondary)] group-open:hidden">
              Expand
            </span>
            <span className="hidden shrink-0 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--content-secondary)] group-open:inline">
              Collapse
            </span>
          </summary>
          <div className="border-t border-[var(--border-subtle)] px-4 pb-4 pt-3">
            {rackCoverageLoading ? (
              <p className="text-sm text-[var(--content-secondary)]">Loading rack breakdown…</p>
            ) : (
              <>
                {rackCoverage?.summary ? (
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-[var(--content-primary)]">
                      <span>
                        <span className="font-bold tabular-nums text-[var(--content-positive)]">
                          {formatNumber(rackCoverage.summary.racks_complete)}
                        </span>{' '}
                        <span className="text-[var(--content-secondary)]">racks complete</span>
                      </span>
                      <span className="text-[var(--content-tertiary)]">·</span>
                      <span>
                        <span className="font-bold tabular-nums text-[var(--content-warning)]">
                          {formatNumber(rackCoverage.summary.racks_in_progress)}
                        </span>{' '}
                        <span className="text-[var(--content-secondary)]">in progress</span>
                      </span>
                      <span className="text-[var(--content-tertiary)]">·</span>
                      <span>
                        <span className="font-bold tabular-nums text-[var(--content-negative)]">
                          {formatNumber(rackCoverage.summary.racks_without_mappings)}
                        </span>{' '}
                        <span className="text-[var(--content-secondary)]">not started</span>
                      </span>
                      <span className="text-[var(--content-tertiary)]">·</span>
                      <span className="text-[var(--content-secondary)]">
                        <span className="font-semibold tabular-nums text-[var(--content-primary)]">
                          {formatNumber(rackCoverage.summary.rack_count)}
                        </span>{' '}
                        racks tracked
                      </span>
                    </div>
                    {rackCoverage.summary.rack_count > 0 && (
                      <div
                        className="h-2 overflow-hidden rounded-full bg-[var(--bg-tertiary)]"
                        title="Share of racks that are fully mapped"
                      >
                        <div
                          className="h-full rounded-full bg-[var(--content-positive)] transition-[width] duration-300"
                          style={{
                            width: `${Math.min(
                              100,
                              (rackCoverage.summary.racks_complete / rackCoverage.summary.rack_count) * 100,
                            )}%`,
                          }}
                        />
                      </div>
                    )}
                  </div>
                ) : null}
                <div className="mt-4">
                  <input
                    value={rackFilter}
                    onChange={(event) => setRackFilter(event.target.value)}
                    placeholder="Filter racks (e.g. GGR-1E)"
                    className="min-h-11 w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 font-mono text-sm text-[var(--content-primary)] outline-none focus:border-[var(--content-accent)]"
                  />
                </div>
                <div className="mt-3 max-h-80 overflow-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)]">
                  <table className="w-full min-w-[320px] border-collapse text-left text-sm">
                    <thead className="sticky top-0 z-[1] bg-[var(--bg-secondary)] text-xs font-semibold uppercase tracking-wide text-[var(--content-tertiary)]">
                      <tr>
                        <th className="px-3 py-2">Rack / bin</th>
                        <th className="px-3 py-2 text-right tabular-nums">Mapped</th>
                        <th className="px-3 py-2 text-right tabular-nums">%</th>
                        <th className="px-3 py-2 text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border-subtle)] text-[var(--content-primary)]">
                      {filteredRackRows.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="px-3 py-6 text-center text-sm text-[var(--content-secondary)]">
                            {rackCoverage?.summary?.rack_count === 0
                              ? 'No rack or bin locations found yet. Stock import (rack column) or bin inventory will populate this list.'
                              : 'No racks match your filter.'}
                          </td>
                        </tr>
                      ) : (
                        filteredRackRows.map((row) => (
                          <tr key={row.rack_id} className="bg-[var(--bg-primary)]">
                            <td className="px-3 py-2.5 font-mono text-xs font-semibold">{row.rack_id}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-[var(--content-secondary)]">
                              {formatNumber(row.mapped_skus)} / {formatNumber(row.total_skus)}
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-[var(--content-secondary)]">
                              {row.coverage_pct}%
                            </td>
                            <td className="px-3 py-2.5 text-right">
                              <span
                                className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${rackStatusClass(row)}`}
                              >
                                {rackStatusLabel(row)}
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </details>

        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Mapped" value={stats.mapped} />
          <StatTile label="Already" value={stats.alreadyMapped} />
          <StatTile label="Skipped" value={stats.skipped} />
          <StatTile label="Conflicts" value={stats.conflictsResolved} />
        </div>
        {/* ── Direction toggle ── */}
        <div className="mb-5 flex items-center gap-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-1">
          <button
            type="button"
            onClick={() => handleDirectionChange('bin_first')}
            className={`flex-1 rounded-lg px-3 py-2.5 text-sm font-semibold transition-all ${
              direction === 'bin_first'
                ? 'bg-[var(--content-primary)] text-[var(--bg-primary)] shadow-sm'
                : 'text-[var(--content-secondary)] hover:text-[var(--content-primary)]'
            }`}
          >
            Bin First
          </button>
          <button
            type="button"
            onClick={() => handleDirectionChange('scan_first')}
            className={`flex-1 rounded-lg px-3 py-2.5 text-sm font-semibold transition-all ${
              direction === 'scan_first'
                ? 'bg-[var(--content-primary)] text-[var(--bg-primary)] shadow-sm'
                : 'text-[var(--content-secondary)] hover:text-[var(--content-primary)]'
            }`}
          >
            Scan First
          </button>
        </div>

        <div className="space-y-4">
          {/* ── Scan-first: Step 1 — scan barcode ── */}
          {step === 'scan_barcode_first' && (
            <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--bg-accent-subtle)]">
                  <BarcodeIcon size={20} weight="regular" className="text-[var(--content-accent)]" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--content-tertiary)]">
                    Step 1 of 2
                  </p>
                  <h2 className="mt-1 text-lg font-bold text-[var(--content-primary)]">
                    Scan the manufacturer barcode
                  </h2>
                  <p className="mt-1 text-sm leading-relaxed text-[var(--content-secondary)]">
                    Scan or type the barcode printed on the item, then search to find the matching SKU.
                  </p>
                </div>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto]">
                <input
                  value={manualBarcode}
                  onChange={(event) => setManualBarcode(event.target.value)}
                  placeholder="Manufacturer barcode"
                  className="min-h-12 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 font-mono text-sm text-[var(--content-primary)] outline-none focus:border-[var(--content-accent)]"
                />
                <button type="button" onClick={handleManualBarcodePreview} className={secondaryButton}>
                  Preview
                </button>
              </div>

              <button
                type="button"
                onClick={openBarcodeScanner}
                className={`${primaryButton} mt-3 w-full`}
              >
                <CameraIcon size={18} weight="bold" />
                Scan barcode
              </button>
            </section>
          )}

          {/* ── Scan-first: Step 2 — search SKU ── */}
          {step === 'search_sku' && pendingBarcode && (
            <section className="space-y-4">
              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--bg-positive-subtle)]">
                    <CheckCircleIcon size={20} weight="fill" className="text-[var(--content-positive)]" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--content-tertiary)]">
                      Barcode captured
                    </p>
                    <p className="mt-1 break-all font-mono text-sm font-semibold text-[var(--content-primary)]">
                      {pendingBarcode.key}
                    </p>
                  </div>
                </div>
              </div>

              {/* ── Auto-suggested match ── */}
              {autoSuggestedItem && (
                <div className="rounded-xl border-2 border-[var(--border-positive)] bg-[var(--bg-positive-subtle)] p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--content-positive)]">
                    Suggested match · via {autoSuggestedItem.source}
                  </p>
                  <p className="mt-2 text-lg font-bold leading-snug text-[var(--content-primary)]">
                    {autoSuggestedItem.item.name}
                  </p>
                  <p className="mt-1 text-sm text-[var(--content-secondary)]">
                    Busy {autoSuggestedItem.item.busy_code}
                    {autoSuggestedItem.item.main_group ? ` · ${autoSuggestedItem.item.main_group}` : ''}
                    {autoSuggestedItem.item.rack_no ? ` · Bin ${autoSuggestedItem.item.rack_no}` : ''}
                  </p>
                  <p className="mt-1 text-xs font-mono text-[var(--content-tertiary)]">
                    Alias 1 {autoSuggestedItem.item.alias1 ?? '—'} · Alias {autoSuggestedItem.item.alias ?? '—'}
                  </p>
                  {mappedSkuSet.has(Number(autoSuggestedItem.item.busy_code)) && (
                    <p className="mt-2 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--content-warning)]">
                      Already mapped
                    </p>
                  )}
                  <button
                    type="button"
                    disabled={loadingSkuLookup}
                    onClick={() => void handleSelectSkuFromSearch(Number(autoSuggestedItem.item.busy_code))}
                    className={`${primaryButton} mt-3 w-full`}
                  >
                    <CheckCircleIcon size={18} weight="bold" />
                    {loadingSkuLookup ? 'Loading...' : 'Use this match'}
                  </button>
                </div>
              )}

              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-4 shadow-sm">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--bg-accent-subtle)]">
                    <MagnifyingGlassIcon size={20} weight="regular" className="text-[var(--content-accent)]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--content-tertiary)]">
                      {autoSuggestedItem ? 'Or search manually' : 'Step 2 of 2'}
                    </p>
                    <h2 className="mt-1 text-lg font-bold text-[var(--content-primary)]">
                      {autoSuggestedItem ? 'Search for a different SKU' : 'Find the matching SKU'}
                    </h2>
                  </div>
                </div>

                <div className="mt-4">
                  <SearchInput
                    placeholder="Search by item name, code, or alias…"
                    value={skuQuery}
                    onChange={setSkuQuery}
                    loading={loadingSkuLookup}
                    autoFocus
                    inputRef={searchInputRef}
                  />
                </div>

                {skuSearchResults.length > 0 && (
                  <div className="mt-3 max-h-80 space-y-2 overflow-y-auto">
                    {skuSearchResults.map((result) => (
                      <button
                        key={result.item.id}
                        type="button"
                        disabled={loadingSkuLookup}
                        onClick={() => void handleSelectSkuFromSearch(Number(result.item.busy_code))}
                        className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3 text-left transition-colors hover:bg-[var(--bg-tertiary)] disabled:opacity-50"
                      >
                        <p className="font-semibold leading-snug text-[var(--content-primary)]">
                          {result.item.name}
                        </p>
                        <p className="mt-1 text-sm text-[var(--content-secondary)]">
                          Busy {result.item.busy_code}
                          {result.item.main_group ? ` · ${result.item.main_group}` : ''}
                          {result.item.rack_no ? ` · Bin ${result.item.rack_no}` : ''}
                        </p>
                        <p className="mt-1 text-xs font-mono text-[var(--content-tertiary)]">
                          Alias 1 {result.item.alias1 ?? '—'} · Alias {result.item.alias ?? '—'}
                        </p>
                        {mappedSkuSet.has(Number(result.item.busy_code)) && (
                          <p className="mt-1 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--content-warning)]">
                            Already mapped
                          </p>
                        )}
                      </button>
                    ))}
                  </div>
                )}

                {skuQuery.length >= 2 && skuSearchResults.length === 0 && !loadingSkuLookup && (
                  <p className="mt-4 text-center text-sm text-[var(--content-tertiary)]">
                    No items found for "{skuQuery}"
                  </p>
                )}

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => {
                      setPendingBarcode(null);
                      setManualBarcode('');
                      setSkuQuery('');
                      setStep('scan_barcode_first');
                    }}
                    className={secondaryButton}
                  >
                    Rescan barcode
                  </button>
                  <button type="button" onClick={handleSkip} className={secondaryButton}>
                    <SkipForwardIcon size={18} weight="bold" />
                    Skip
                  </button>
                </div>
              </div>
            </section>
          )}

          {/* ── Bin-first: Step 1 — scan bin ── */}
          {step === 'scan_bin' && (
            <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--bg-accent-subtle)]">
                  <CameraIcon size={20} weight="regular" className="text-[var(--content-accent)]" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--content-tertiary)]">
                    Step 1 of 2
                  </p>
                  <h2 className="mt-1 text-lg font-bold text-[var(--content-primary)]">
                    Scan the bin QR label
                  </h2>
                  <p className="mt-1 text-sm leading-relaxed text-[var(--content-secondary)]">
                    This loads the SKU context before you scan the manufacturer barcode.
                  </p>
                </div>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto]">
                <input
                  value={manualBin}
                  onChange={(event) => setManualBin(event.target.value)}
                  placeholder="Bin or rack code"
                  className="min-h-12 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 text-sm font-semibold text-[var(--content-primary)] outline-none focus:border-[var(--content-accent)]"
                />
                <button
                  type="button"
                  onClick={() => void handleLoadBin(manualBin)}
                  disabled={loadingBin}
                  className={secondaryButton}
                >
                  Load bin
                </button>
              </div>

              <button
                type="button"
                onClick={openBinScanner}
                disabled={loadingBin}
                className={`${primaryButton} mt-3 w-full`}
              >
                <CameraIcon size={18} weight="bold" />
                {loadingBin ? 'Loading bin...' : 'Scan bin QR'}
              </button>
            </section>
          )}

          {step === 'choose_sku' && (
            <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--content-tertiary)]">
                Bin {currentBinId}
              </p>
              <h2 className="mt-1 text-lg font-bold text-[var(--content-primary)]">
                Choose the SKU to map
              </h2>
              {binSkuMappingProgress.total > 0 && (
                <div className="mt-3 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <p className="text-[var(--content-secondary)]">
                      <span className="font-semibold tabular-nums text-[var(--content-primary)]">
                        {formatNumber(binSkuMappingProgress.mapped)}
                      </span>
                      {' / '}
                      <span className="tabular-nums">{formatNumber(binSkuMappingProgress.total)}</span>
                      <span className="text-[var(--content-tertiary)]"> SKUs already have a barcode</span>
                    </p>
                    {binSkuMappingProgress.total > 0 && (
                      <span className="shrink-0 rounded-full bg-[var(--bg-tertiary)] px-2.5 py-0.5 text-xs font-semibold tabular-nums text-[var(--content-secondary)]">
                        {Math.round((binSkuMappingProgress.mapped / binSkuMappingProgress.total) * 100)}% done
                      </span>
                    )}
                  </div>
                  <div
                    className="h-1.5 overflow-hidden rounded-full bg-[var(--bg-tertiary)]"
                    aria-hidden
                  >
                    <div
                      className="h-full rounded-full bg-[var(--content-positive)] transition-[width] duration-300"
                      style={{
                        width: `${Math.min(
                          100,
                          (binSkuMappingProgress.mapped / binSkuMappingProgress.total) * 100,
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              )}
              <div className="mt-4 space-y-2">
                {skuOptions.map((option) => {
                  const isMapped = mappedSkuSet.has(option.skuBusyCode);
                  return (
                    <button
                      key={`${option.binId}-${option.skuBusyCode}`}
                      type="button"
                      onClick={() => {
                        setSelectedSku(option);
                        setStep('bin_loaded');
                      }}
                      className={`w-full rounded-xl border p-4 text-left transition-colors hover:bg-[var(--bg-tertiary)] ${
                        isMapped
                          ? 'border-[var(--border-positive)] bg-[var(--bg-positive-subtle)] hover:bg-[var(--bg-positive-subtle)]'
                          : 'border-[var(--border-subtle)] bg-[var(--bg-secondary)]'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold leading-snug text-[var(--content-primary)]">
                            {option.itemName}
                          </p>
                          <p className="mt-1 text-sm text-[var(--content-secondary)]">
                            Busy {option.skuBusyCode} · {option.mainGroup || option.parentGroup || 'No group'}
                          </p>
                          <p className="mt-1 text-xs font-mono text-[var(--content-tertiary)]">
                            Alias 1 {option.alias1 ?? '—'} · Alias {option.alias ?? '—'}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1 pt-0.5">
                          {isMapped ? (
                            <>
                              <CheckCircleIcon
                                size={26}
                                weight="fill"
                                className="text-[var(--content-positive)]"
                                aria-hidden
                              />
                              <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--content-positive)]">
                                Mapped
                              </span>
                            </>
                          ) : (
                            <span className="rounded-md border border-dashed border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--content-tertiary)]">
                              To map
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
              <button type="button" onClick={resetForNextBin} className={`${secondaryButton} mt-4 w-full`}>
                Scan another bin
              </button>
            </section>
          )}

          {(step === 'bin_loaded' || step === 'barcode_detected' || step === 'saving') && selectedSku && (
            <section className="space-y-4">
              <ItemSummary sku={selectedSku} />
              {selectedSkuAlreadyMapped && (
                <div className="rounded-xl border border-[var(--border-accent)] bg-[var(--bg-accent-subtle)] p-4">
                  <p className="text-sm font-semibold text-[var(--content-accent)]">
                    Busy {selectedSku.skuBusyCode} already has a barcode.
                  </p>
                  <p className="mt-1 text-sm text-[var(--content-secondary)]">
                    You can still add this barcode — multiple barcodes per SKU are supported (different batches, manufacturers, etc).
                  </p>
                </div>
              )}

              {step === 'bin_loaded' && (
                <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-4 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--content-tertiary)]">
                    Step 2 of 2
                  </p>
                  <h2 className="mt-1 text-lg font-bold text-[var(--content-primary)]">
                    Scan manufacturer barcode
                  </h2>
                  <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto]">
                    <input
                      value={manualBarcode}
                      onChange={(event) => setManualBarcode(event.target.value)}
                      placeholder="Manufacturer barcode"
                      className="min-h-12 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 font-mono text-sm text-[var(--content-primary)] outline-none focus:border-[var(--content-accent)]"
                    />
                    <button type="button" onClick={handleManualBarcodePreview} className={secondaryButton}>
                      Preview
                    </button>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <button type="button" onClick={openBarcodeScanner} className={primaryButton}>
                      <BarcodeIcon size={18} weight="bold" />
                      Scan item barcode
                    </button>
                    <button type="button" onClick={handleSkip} className={secondaryButton}>
                      <SkipForwardIcon size={18} weight="bold" />
                      No barcode, skip
                    </button>
                  </div>
                </div>
              )}

              {(step === 'barcode_detected' || step === 'saving') && pendingBarcode && (
                <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-4 shadow-sm">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--bg-positive-subtle)]">
                      <CheckCircleIcon size={20} weight="fill" className="text-[var(--content-positive)]" />
                    </div>
                    <div className="min-w-0">
                      <h2 className="text-lg font-bold text-[var(--content-primary)]">
                        Barcode detected
                      </h2>
                      <p className="mt-1 break-all font-mono text-sm text-[var(--content-secondary)]">
                        Raw: {pendingBarcode.raw}
                      </p>
                      <p className="mt-1 break-all font-mono text-sm font-semibold text-[var(--content-primary)]">
                        Saved key (canonical): {pendingBarcode.key}
                      </p>
                      <p className="mt-1 break-all font-mono text-xs text-[var(--content-tertiary)]">
                        Lookup-only candidates (not saved as separate rows):{' '}
                        {pendingBarcode.candidates.filter((c) => c !== pendingBarcode.key).length > 0
                          ? pendingBarcode.candidates.filter((c) => c !== pendingBarcode.key).join(', ')
                          : '—'}
                      </p>
                      <p className="mt-2 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--content-tertiary)]">
                        Part Number {'->'} Alias Mapping
                      </p>
                      <p className="mt-1 break-all font-mono text-xs text-[var(--content-secondary)]">
                        {pendingBarcode.key} {'->'} {selectedSku.alias1 ?? selectedSku.alias ?? 'No alias configured'}
                      </p>
                    </div>
                  </div>

                  {pendingBarcode.looksSerialised && (
                    <div className="mt-4 rounded-xl border border-[var(--border-warning)] bg-[var(--bg-warning-subtle)] p-3 text-sm text-[var(--content-warning)]">
                      Serial detected and stripped. Future scans with this part prefix will match this SKU.
                    </div>
                  )}

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => void handleSave(false)}
                      disabled={saving}
                      className={primaryButton}
                    >
                      <CheckCircleIcon size={18} weight="bold" />
                      {saving ? 'Saving...' : 'Confirm and save'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPendingBarcode(null);
                        if (direction === 'scan_first') {
                          setStep('scan_barcode_first');
                        } else {
                          setStep('bin_loaded');
                          openBarcodeScanner();
                        }
                      }}
                      disabled={saving}
                      className={secondaryButton}
                    >
                      Rescan
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}

          {step === 'conflict' && selectedSku && pendingBarcode && conflict && (
            <section className="rounded-xl border border-[var(--border-warning)] bg-[var(--bg-warning-subtle)] p-4">
              <div className="flex items-start gap-3">
                <SealWarningIcon size={24} weight="fill" className="mt-0.5 shrink-0 text-[var(--content-warning)]" />
                <div className="min-w-0">
                  <h2 className="text-lg font-bold text-[var(--content-primary)]">
                    Barcode already mapped
                  </h2>
                  <p className="mt-2 text-sm leading-relaxed text-[var(--content-secondary)]">
                    Key <span className="font-mono font-semibold">{pendingBarcode.key}</span> is mapped to{' '}
                    <span className="font-semibold">
                      {conflict.existing_item_name ?? `Busy ${conflict.existing_sku}`}
                    </span>
                    {conflict.existing_bin_id ? ` at bin ${conflict.existing_bin_id}` : ''}. You scanned it for{' '}
                    <span className="font-semibold">{selectedSku.itemName}</span>.
                  </p>
                </div>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={resetForNextBin}
                  disabled={saving}
                  className={secondaryButton}
                >
                  Keep existing
                </button>
                <button
                  type="button"
                  onClick={() => void handleSave(true)}
                  disabled={saving}
                  className={dangerButton}
                >
                  Use this SKU instead
                </button>
              </div>
            </section>
          )}

          {(step === 'saved' || step === 'already_mapped' || step === 'no_barcode') && (
            <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-5 text-center">
              {step === 'saved' && (
                <>
                  <CheckCircleIcon size={36} weight="fill" className="mx-auto text-[var(--content-positive)]" />
                  <p className="mt-3 text-lg font-bold text-[var(--content-primary)]">Mapping saved</p>
                </>
              )}
              {step === 'already_mapped' && (
                <>
                  <CheckCircleIcon size={36} weight="fill" className="mx-auto text-[var(--content-positive)]" />
                  <p className="mt-3 text-lg font-bold text-[var(--content-primary)]">Already recorded</p>
                </>
              )}
              {step === 'no_barcode' && (
                <>
                  <XCircleIcon size={36} weight="fill" className="mx-auto text-[var(--content-tertiary)]" />
                  <p className="mt-3 text-lg font-bold text-[var(--content-primary)]">Skipped</p>
                </>
              )}
              <p className="mt-1 text-sm text-[var(--content-secondary)]">Returning to the next item...</p>
            </section>
          )}
        </div>
      </div>

      {scannerOpen && (
        <LiveQrScanner
          key={`${scannerMode}-${selectedSku?.skuBusyCode ?? 'bin'}`}
          mode="collect"
          title={scannerTitle}
          eyebrow={scannerMode === 'bin' ? 'Barcode Mapping' : 'Manufacturer Barcode'}
          idleStatus={scannerMode === 'bin' ? 'Point at the bin QR' : 'Point at the item barcode'}
          helpText={
            scannerMode === 'bin'
              ? 'Scan the bin or rack QR label first so the mapping has the right SKU context.'
              : 'Scan the manufacturer barcode printed on the physical item or its smallest pack.'
          }
          onClose={() => setScannerOpen(false)}
          onResolved={handleScannerResolved}
          onError={(message) => toast.error(message)}
        />
      )}
    </div>
  );
}
