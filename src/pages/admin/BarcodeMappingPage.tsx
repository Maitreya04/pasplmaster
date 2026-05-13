import { useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeftIcon,
  BarcodeIcon,
  CameraIcon,
  CheckCircleIcon,
  DatabaseIcon,
  SealWarningIcon,
  SkipForwardIcon,
  XCircleIcon,
} from '@phosphor-icons/react';
import { LiveQrScanner } from '../../components/shared';
import type { LiveQrScannerResolved } from '../../components/shared/LiveQrScanner';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import {
  fetchBarcodeCoverage,
  loadSkuOptionsFromBin,
  normalizeBinCode,
  saveBarcodeMapping,
  type BarcodeCoverage,
  type BarcodeSkuOption,
  type SaveBarcodeMappingResult,
} from '../../lib/barcodeMapping';
import {
  parseManufacturerBarcode,
  type ParsedBarcode,
} from '../../lib/scanner/barcodeParser';
import { classifyScanPayload, parseRackPayload } from '../../lib/scanner/qrPayload';

type MappingStep =
  | 'scan_bin'
  | 'choose_sku'
  | 'bin_loaded'
  | 'barcode_detected'
  | 'saving'
  | 'saved'
  | 'conflict'
  | 'already_mapped'
  | 'no_barcode';

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

  const { data: coverage } = useQuery({
    queryKey: BARCODE_COVERAGE_QUERY_KEY,
    queryFn: fetchBarcodeCoverage,
    staleTime: 30_000,
  });

  const manufacturer = useMemo(
    () => selectedSku?.mainGroup ?? selectedSku?.parentGroup ?? null,
    [selectedSku],
  );

  const resetForNextBin = useCallback(() => {
    setStep('scan_bin');
    setScannerMode('bin');
    setCurrentBinId(null);
    setSkuOptions([]);
    setSelectedSku(null);
    setPendingBarcode(null);
    setConflict(null);
    setManualBarcode('');
  }, []);

  const finishSoon = useCallback(() => {
    window.setTimeout(resetForNextBin, 1200);
  }, [resetForNextBin]);

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
    setStep('barcode_detected');
  }, [handleLoadBin, scannerMode, toast]);

  const handleManualBarcodePreview = () => {
    const parsed = parseManufacturerBarcode(manualBarcode);
    if (!parsed.key) {
      toast.warning('Enter a manufacturer barcode first.');
      return;
    }
    setPendingBarcode(parsed);
    setStep('barcode_detected');
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
    toast.info('Skipped this bin.');
    finishSoon();
  };

  const openBinScanner = () => {
    setScannerMode('bin');
    setScannerOpen(true);
  };

  const openBarcodeScanner = () => {
    if (!selectedSku) return;
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

        <div className="space-y-4">
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
                        setStep('bin_loaded');
                        openBarcodeScanner();
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
              <p className="mt-1 text-sm text-[var(--content-secondary)]">Returning to the next bin...</p>
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
