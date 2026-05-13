import { useCallback, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeftIcon,
  BarcodeIcon,
  CameraIcon,
  CheckCircleIcon,
  DatabaseIcon,
  MagnifyingGlassIcon,
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
  fetchBarcodeCoverage,
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
import { classifyScanPayload, normalizeScanCode, parseRackPayload } from '../../lib/scanner/qrPayload';
import { resolveScannedCatalogItem } from '../../stores/itemScanIndex';

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
        </div>
      </div>
    </div>
  );
}

export default function BarcodeMappingPage(): React.JSX.Element {
  const navigate = useNavigate();
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

  const manufacturer = useMemo(
    () => selectedSku?.mainGroup ?? selectedSku?.parentGroup ?? null,
    [selectedSku],
  );

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
      toast.info('Multiple SKUs found in this bin. Choose the one you are mapping.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not load this bin.';
      toast.error(message);
      setStep('scan_bin');
    } finally {
      setLoadingBin(false);
    }
  }, [toast]);

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
      const result = await saveBarcodeMapping({
        barcodeRaw: pendingBarcode.raw,
        barcodeKey: pendingBarcode.key,
        matchStrategy: pendingBarcode.strategy,
        skuBusyCode: selectedSku.skuBusyCode,
        binId: currentBinId,
        manufacturer,
        mappedByUserId: userId,
        mappedByName: userName,
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
    selectedSku,
    toast,
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
    <div className="role-admin min-h-screen bg-[var(--bg-primary)]">
      <div className="mx-auto max-w-3xl px-4 py-4 lg:px-6">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <button
              type="button"
              onClick={() => navigate('/admin')}
              className="mb-3 inline-flex min-h-11 items-center gap-2 rounded-xl px-1 text-sm font-semibold text-[var(--content-secondary)] hover:text-[var(--content-primary)]"
            >
              <ArrowLeftIcon size={18} weight="bold" />
              Admin
            </button>
            <h1 className="text-2xl font-bold leading-tight text-[var(--content-primary)]">
              Barcode Mapping
            </h1>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-[var(--content-secondary)]">
              Map manufacturer barcodes to Busy SKUs so future scans can verify the physical item.
            </p>
          </div>
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
              <div className="mt-4 space-y-2">
                {skuOptions.map((option) => (
                  <button
                    key={`${option.binId}-${option.skuBusyCode}`}
                    type="button"
                    onClick={() => {
                      setSelectedSku(option);
                      setStep('bin_loaded');
                    }}
                    className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4 text-left transition-colors hover:bg-[var(--bg-tertiary)]"
                  >
                    <p className="font-semibold leading-snug text-[var(--content-primary)]">
                      {option.itemName}
                    </p>
                    <p className="mt-1 text-sm text-[var(--content-secondary)]">
                      Busy {option.skuBusyCode} · {option.mainGroup || option.parentGroup || 'No group'}
                    </p>
                  </button>
                ))}
              </div>
              <button type="button" onClick={resetForNextBin} className={`${secondaryButton} mt-4 w-full`}>
                Scan another bin
              </button>
            </section>
          )}

          {(step === 'bin_loaded' || step === 'barcode_detected' || step === 'saving') && selectedSku && (
            <section className="space-y-4">
              <ItemSummary sku={selectedSku} />

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
                        Saved key: {pendingBarcode.key}
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
