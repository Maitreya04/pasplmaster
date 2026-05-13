import { useCallback, useDeferredValue, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Camera,
  CaretLeft,
  CheckCircle,
  ClipboardText,
  QrCode,
  Warning,
} from '@phosphor-icons/react';
import { useItems } from '../../hooks/useItems';
import { useToast } from '../../context/ToastContext';
import { BigButton, LiveQrScanner, SearchInput, Skeleton } from '../../components/shared';
import type { Item, ItemPackDefinition, LicensePlatePackType, ScanResult } from '../../types';
import { appHaptics } from '../../lib/haptics';
import type { LiveQrScannerResolved } from '../../components/shared/LiveQrScanner';
import { itemPickCode } from '../../utils/itemCodes';
import {
  fetchItemPackDefinitions,
  PACK_DEFINITIONS_QUERY_KEY,
} from '../../lib/packLpn';
import { parsePackPickPayload } from '../../lib/scanner/qrPayload';

type ScanLabRecord = Item & {
  pickCode: string;
};

interface ScanLabQuantityResult {
  scanKind: 'sku' | 'pack' | 'unknown';
  packType: LicensePlatePackType | null;
  packQty: number | null;
  qtyAdded: number;
  targetQty: number;
  totalBefore: number;
  totalAfter: number;
  remainingBefore: number;
  remainingAfter: number;
  requiresBreakConfirmation: boolean;
}

type LabScannerMode = 'verify' | 'scan';

interface ScanOnlyResult {
  rawValue: string;
  recognizedItemName: string | null;
  recognizedBusyCode: number | null;
  matchedBy: string | null;
  codeType: LiveQrScannerResolved['codeType'];
  reason: string;
  timestamp: string;
}

function buildScanLabRecord(item: Item): ScanLabRecord | null {
  const pickCode = itemPickCode(item);
  if (!pickCode) return null;
  return { ...item, pickCode };
}

function matchesQuery(item: ScanLabRecord, query: string): boolean {
  if (!query) return true;
  const haystack = [
    item.name,
    item.pickCode,
    item.alias1,
    item.alias,
    item.rack_no,
    item.main_group,
    item.parent_group,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(query);
}

function packQtyForType(
  definition: ItemPackDefinition | null | undefined,
  packType: LicensePlatePackType,
): number | null {
  return packType === 'inner'
    ? definition?.inner_pack_qty ?? null
    : definition?.outer_pack_qty ?? null;
}

function packPayload(busyCode: number, packType: LicensePlatePackType): string {
  return `PASPL-PACK:${busyCode}:${packType}`;
}

function buildQuantityResult({
  item,
  rawValue,
  isMatch,
  targetQty,
  totalBefore,
  packDefinition,
}: {
  item: ScanLabRecord;
  rawValue: string;
  isMatch: boolean;
  targetQty: number;
  totalBefore: number;
  packDefinition: ItemPackDefinition | null | undefined;
}): ScanLabQuantityResult {
  const remainingBefore = Math.max(0, targetQty - totalBefore);
  const pack = parsePackPickPayload(rawValue);

  if (pack) {
    const packQty = packQtyForType(packDefinition, pack.packType);
    const packMatchesItem = item.busy_code != null && Number(item.busy_code) === pack.busyCode;
    const canAddPack = isMatch && packMatchesItem && packQty != null && packQty > 1 && remainingBefore > 0;
    const requiresBreakConfirmation = Boolean(canAddPack && packQty > remainingBefore);
    const qtyAdded = canAddPack && !requiresBreakConfirmation ? packQty : 0;
    const totalAfter = totalBefore + qtyAdded;

    return {
      scanKind: 'pack',
      packType: pack.packType,
      packQty,
      qtyAdded,
      targetQty,
      totalBefore,
      totalAfter,
      remainingBefore,
      remainingAfter: Math.max(0, targetQty - totalAfter),
      requiresBreakConfirmation,
    };
  }

  const qtyAdded = isMatch && remainingBefore > 0 ? 1 : 0;
  const totalAfter = totalBefore + qtyAdded;

  return {
    scanKind: isMatch ? 'sku' : 'unknown',
    packType: null,
    packQty: null,
    qtyAdded,
    targetQty,
    totalBefore,
    totalAfter,
    remainingBefore,
    remainingAfter: Math.max(0, targetQty - totalAfter),
    requiresBreakConfirmation: false,
  };
}

export default function PickScanLabPage(): React.JSX.Element {
  const navigate = useNavigate();
  const toast = useToast();
  const { data: items = [], isLoading, error, refetch, isFetching } = useItems();
  const { data: packDefinitions = [] } = useQuery({
    queryKey: PACK_DEFINITIONS_QUERY_KEY,
    queryFn: fetchItemPackDefinitions,
  });
  const [query, setQuery] = useState('');
  const [liveTarget, setLiveTarget] = useState<ScanLabRecord | null>(null);
  const [targetQty, setTargetQty] = useState(40);
  const [simulatedPickedQty, setSimulatedPickedQty] = useState(0);
  const [labScannerMode, setLabScannerMode] = useState<LabScannerMode>('verify');
  const [scanOnlyOpen, setScanOnlyOpen] = useState(false);
  const [lastResult, setLastResult] = useState<{
    item: ScanLabRecord;
    result: ScanResult;
    quantity: ScanLabQuantityResult;
  } | null>(null);
  const [lastScanOnlyResult, setLastScanOnlyResult] = useState<ScanOnlyResult | null>(null);
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());

  const labelableItems = useMemo(
    () => items.map(buildScanLabRecord).filter((item): item is ScanLabRecord => item !== null),
    [items],
  );

  const packDefinitionByBusyCode = useMemo(() => {
    const map = new Map<number, ItemPackDefinition>();
    for (const definition of packDefinitions) map.set(Number(definition.busy_code), definition);
    return map;
  }, [packDefinitions]);

  const filteredItems = useMemo(
    () =>
      labelableItems
        .filter((item) => matchesQuery(item, deferredQuery))
        .sort((a, b) => a.pickCode.localeCompare(b.pickCode, undefined, { numeric: true, sensitivity: 'base' }))
        .slice(0, 24),
    [deferredQuery, labelableItems],
  );

  const startScan = useCallback((item: ScanLabRecord) => {
    appHaptics.impactLight();
    setLiveTarget(item);
  }, []);

  const closeScan = useCallback(() => {
    setLiveTarget(null);
  }, []);

  const closeScanOnly = useCallback(() => {
    setScanOnlyOpen(false);
  }, []);

  const handleScanResolved = useCallback((scan: LiveQrScannerResolved) => {
    setLiveTarget((current) => {
      if (!current) return null;
      const packDefinition =
        current.busy_code == null ? null : packDefinitionByBusyCode.get(Number(current.busy_code));
      const quantity = buildQuantityResult({
        item: current,
        rawValue: scan.rawValue,
        isMatch: scan.matchesPickItem,
        targetQty,
        totalBefore: simulatedPickedQty,
        packDefinition,
      });

      const result: ScanResult = {
        scannedText: scan.rawValue,
        confidence: scan.matchedItem ? 100 : 0,
        isMatch: scan.matchesPickItem,
        matchedAgainst: scan.matchedBy ?? current.name,
        matchStrategy: scan.matchesPickItem
          ? 'qr_catalog_hit'
          : scan.matchedItem
            ? 'qr_expected_mismatch'
            : 'qr_catalog_miss',
        ocrExtracted: {
          partNumber: scan.lookupCode,
          mrp: current.mrp ?? null,
        },
        method: 'qr_scan',
        timestamp: new Date().toISOString(),
        extractedCode: scan.lookupCode ?? undefined,
        extractedDescription: scan.matchedItem?.name ?? undefined,
        reason: scan.reason,
      };

      setLastResult({ item: current, result, quantity });
      if (quantity.qtyAdded > 0) {
        setSimulatedPickedQty(quantity.totalAfter);
      }
      if (result.isMatch) appHaptics.success();
      else appHaptics.warning();

      return result.isMatch ? null : current;
    });
  }, [packDefinitionByBusyCode, simulatedPickedQty, targetQty]);

  const handleScanOnlyResolved = useCallback((scan: LiveQrScannerResolved) => {
    setLastScanOnlyResult({
      rawValue: scan.rawValue,
      recognizedItemName: scan.matchedItem?.name ?? null,
      recognizedBusyCode: scan.matchedItem?.busy_code != null
        ? Number(scan.matchedItem.busy_code)
        : null,
      matchedBy: scan.matchedBy ?? null,
      codeType: scan.codeType,
      reason: scan.reason,
      timestamp: new Date().toISOString(),
    });
  }, []);

  return (
    <div className="role-admin min-h-screen bg-[var(--bg-primary)]">
      <div className="mx-auto max-w-5xl p-4 lg:px-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/admin')}
            className="min-h-11 min-w-11 rounded-xl text-[var(--content-secondary)]"
          >
            <CaretLeft size={24} weight="bold" />
          </button>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-[var(--content-primary)]">Pick Scan Lab</h1>
            <p className="text-sm text-[var(--content-tertiary)]">
              Test verification mode or scan-only recognition using current barcode mapping and alias rules.
            </p>
          </div>
        </div>

        <div className="mt-5 flex items-center gap-1 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-1">
          <button
            type="button"
            onClick={() => setLabScannerMode('verify')}
            className={`flex-1 rounded-xl px-3 py-2.5 text-sm font-semibold transition-all ${
              labScannerMode === 'verify'
                ? 'bg-[var(--content-primary)] text-[var(--bg-primary)] shadow-sm'
                : 'text-[var(--content-secondary)] hover:text-[var(--content-primary)]'
            }`}
          >
            Verify Mode
          </button>
          <button
            type="button"
            onClick={() => setLabScannerMode('scan')}
            className={`flex-1 rounded-xl px-3 py-2.5 text-sm font-semibold transition-all ${
              labScannerMode === 'scan'
                ? 'bg-[var(--content-primary)] text-[var(--bg-primary)] shadow-sm'
                : 'text-[var(--content-secondary)] hover:text-[var(--content-primary)]'
            }`}
          >
            Scan Mode
          </button>
        </div>

        {labScannerMode === 'scan' && (
          <section className="mt-5 rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--content-tertiary)]">
              Scan-Only Recognition
            </p>
            <p className="mt-2 text-sm text-[var(--content-secondary)]">
              Scan any barcode/QR and the lab will recognize the product using the latest scan catalog +
              barcode mappings from the current verification pipeline.
            </p>
            <button
              type="button"
              onClick={() => setScanOnlyOpen(true)}
              className="mt-4 inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-[var(--bg-positive)] px-4 text-sm font-semibold text-[var(--content-on-color)]"
            >
              <QrCode size={18} weight="bold" />
              Start Scan Mode
            </button>

            {lastScanOnlyResult && (
              <div className="mt-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-4">
                <p className="text-sm font-semibold text-[var(--content-primary)]">Latest scan-only result</p>
                <div className="mt-3 space-y-1 text-sm text-[var(--content-secondary)]">
                  <p>Read: <span className="font-mono">{lastScanOnlyResult.rawValue}</span></p>
                  <p>
                    Recognized: {lastScanOnlyResult.recognizedItemName
                      ? `${lastScanOnlyResult.recognizedItemName}${lastScanOnlyResult.recognizedBusyCode ? ` (Busy ${lastScanOnlyResult.recognizedBusyCode})` : ''}`
                      : 'No mapped product'}
                  </p>
                  <p>Matched By: {lastScanOnlyResult.matchedBy ?? 'No match source'}</p>
                  <p>Code Type: {lastScanOnlyResult.codeType}</p>
                  <p>Reason: {lastScanOnlyResult.reason}</p>
                </div>
              </div>
            )}
          </section>
        )}

        {labScannerMode === 'verify' && (
          <>
        <div className="mt-6 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <section className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--content-tertiary)]">
              How To Test
            </p>
            <div className="mt-3 space-y-3 text-sm text-[var(--content-secondary)]">
              <p>1. Print the 35mm pack strip from Label Studio.</p>
              <p>2. Set a target quantity here, then search the SKU and tap `Test Scan`.</p>
              <p>3. Scan ITEM, INNER, and MASTER. The lab will show the decoded payload and simulated quantity added.</p>
              <p>4. If a pack is larger than remaining qty, the lab flags the same break-confirmation case as picking.</p>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--content-tertiary)]">
                  Target Qty
                </span>
                <input
                  type="number"
                  min="1"
                  inputMode="numeric"
                  value={targetQty}
                  onChange={(event) => {
                    const next = Math.max(1, Math.floor(Number(event.target.value) || 1));
                    setTargetQty(next);
                    setSimulatedPickedQty((current) => Math.min(current, next));
                  }}
                  className="h-11 w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 font-mono text-sm text-[var(--content-primary)]"
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--content-tertiary)]">
                  Picked So Far
                </span>
                <input
                  type="number"
                  min="0"
                  inputMode="numeric"
                  value={simulatedPickedQty}
                  onChange={(event) => {
                    const next = Math.max(0, Math.floor(Number(event.target.value) || 0));
                    setSimulatedPickedQty(Math.min(next, targetQty));
                  }}
                  className="h-11 w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 font-mono text-sm text-[var(--content-primary)]"
                />
              </label>
              <div className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--content-tertiary)]">
                  Remaining
                </span>
                <div className="flex h-11 items-center justify-between rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3">
                  <span className="font-mono text-sm font-semibold text-[var(--content-primary)]">
                    {Math.max(0, targetQty - simulatedPickedQty)}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setSimulatedPickedQty(0);
                      setLastResult(null);
                    }}
                    className="text-xs font-semibold text-[var(--content-accent)]"
                  >
                    Reset
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--content-tertiary)]">
              Latest Result
            </p>
            {lastResult ? (
              <div className="mt-3 space-y-3">
                <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-[var(--content-primary)]">
                        {lastResult.item.name}
                      </p>
                      <p className="mt-1 font-mono text-sm text-[var(--content-tertiary)]">
                        Expected: {lastResult.item.pickCode}
                      </p>
                    </div>
                    {lastResult.result.isMatch ? (
                      <CheckCircle size={22} weight="fill" className="text-[var(--content-positive)]" />
                    ) : (
                      <Warning size={22} weight="fill" className="text-[var(--content-warning)]" />
                    )}
                  </div>
                  <div className="mt-3 space-y-1 text-sm text-[var(--content-secondary)]">
                    <p>Read: <span className="font-mono">{lastResult.result.scannedText}</span></p>
                    <p>Reason: {lastResult.result.reason ?? 'No reason recorded'}</p>
                    <p>Confidence: {lastResult.result.confidence}%</p>
                    <p>Strategy: {lastResult.result.matchStrategy}</p>
                  </div>
                  <div className="mt-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3">
                    <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--content-tertiary)]">
                          Scan Kind
                        </p>
                        <p className="mt-1 font-mono font-semibold uppercase text-[var(--content-primary)]">
                          {lastResult.quantity.scanKind}
                          {lastResult.quantity.packType ? `:${lastResult.quantity.packType}` : ''}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--content-tertiary)]">
                          Pack Qty
                        </p>
                        <p className="mt-1 font-mono font-semibold text-[var(--content-primary)]">
                          {lastResult.quantity.packQty ?? '-'}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--content-tertiary)]">
                          Qty Added
                        </p>
                        <p className="mt-1 font-mono font-semibold text-[var(--content-primary)]">
                          {lastResult.quantity.qtyAdded}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--content-tertiary)]">
                          Remaining
                        </p>
                        <p className="mt-1 font-mono font-semibold text-[var(--content-primary)]">
                          {lastResult.quantity.remainingBefore} → {lastResult.quantity.remainingAfter}
                        </p>
                      </div>
                    </div>
                    {lastResult.quantity.requiresBreakConfirmation && (
                      <p className="mt-3 rounded-xl bg-[var(--bg-warning-subtle)] px-3 py-2 text-sm font-semibold text-[var(--content-warning)]">
                        This pack is bigger than the remaining quantity. Picking would ask for break-pack confirmation.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <p className="mt-3 text-sm text-[var(--content-tertiary)]">
                No scans yet. Run a test and the decoded payload will show up here.
              </p>
            )}
          </section>
        </div>

        <div className="mt-6">
          <SearchInput
            placeholder="Search by item name, alias, alias1, rack..."
            value={query}
            onChange={setQuery}
            loading={isFetching}
          />
        </div>

        {isLoading ? (
          <div className="mt-6 space-y-3">
            <Skeleton variant="card" count={6} />
          </div>
        ) : error ? (
          <div className="mt-6 rounded-3xl border border-[var(--border-negative)] bg-[var(--bg-negative-subtle)] p-5">
            <p className="font-semibold text-[var(--content-negative)]">Failed to load items</p>
            <BigButton
              variant="secondary"
              className="mt-4"
              onClick={() => void refetch()}
            >
              Retry
            </BigButton>
          </div>
        ) : (
          <div className="mt-6 grid gap-3">
            {filteredItems.length === 0 ? (
              <div className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-5 text-sm text-[var(--content-tertiary)]">
                No testable items found. Try a broader search or make sure the item has Alias 1 or Alias.
              </div>
            ) : (
              filteredItems.map((item) => {
                const busyCode = item.busy_code == null ? null : Number(item.busy_code);
                const packDefinition = busyCode == null ? null : packDefinitionByBusyCode.get(busyCode);
                const innerPayload =
                  busyCode != null && packDefinition?.inner_pack_qty
                    ? packPayload(busyCode, 'inner')
                    : null;
                const outerPayload =
                  busyCode != null && packDefinition?.outer_pack_qty
                    ? packPayload(busyCode, 'outer')
                    : null;

                return (
                  <article
                    key={item.id}
                    className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4"
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0">
                        <p className="font-semibold text-[var(--content-primary)]">{item.name}</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {[item.alias1, item.alias, item.pickCode]
                            .filter((code, index, values): code is string => Boolean(code) && values.indexOf(code) === index)
                            .map((code) => (
                            <span
                              key={code}
                              className="rounded-full bg-[var(--bg-tertiary)] px-3 py-1 font-mono text-xs text-[var(--content-secondary)]"
                            >
                              {code}
                            </span>
                          ))}
                          {item.rack_no && (
                            <span className="rounded-full bg-[var(--bg-warning-subtle)] px-3 py-1 text-xs text-[var(--content-warning)]">
                              Rack {item.rack_no}
                            </span>
                          )}
                          {packDefinition?.inner_pack_qty && (
                            <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
                              Inner {packDefinition.inner_pack_qty}
                            </span>
                          )}
                          {packDefinition?.outer_pack_qty && (
                            <span className="rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-800">
                              Master {packDefinition.outer_pack_qty}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard
                              .writeText(item.pickCode)
                              .then(() => toast.success('Pick code copied'))
                              .catch(() => toast.error('Could not copy pick code'));
                          }}
                          className="flex h-11 items-center justify-center gap-2 rounded-2xl bg-[var(--bg-tertiary)] px-4 text-sm font-medium text-[var(--content-secondary)]"
                        >
                          <ClipboardText size={18} weight="regular" />
                          Copy Code
                        </button>
                        {innerPayload && (
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard
                                .writeText(innerPayload)
                                .then(() => toast.success('Inner pack payload copied'))
                                .catch(() => toast.error('Could not copy pack payload'));
                            }}
                            className="flex h-11 items-center justify-center rounded-2xl bg-emerald-100 px-4 text-sm font-semibold text-emerald-800"
                          >
                            Copy Inner
                          </button>
                        )}
                        {outerPayload && (
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard
                                .writeText(outerPayload)
                                .then(() => toast.success('Master pack payload copied'))
                                .catch(() => toast.error('Could not copy pack payload'));
                            }}
                            className="flex h-11 items-center justify-center rounded-2xl bg-sky-100 px-4 text-sm font-semibold text-sky-800"
                          >
                            Copy Master
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => startScan(item)}
                          className="flex h-11 items-center justify-center gap-2 rounded-2xl bg-[var(--bg-positive)] px-4 text-sm font-semibold text-[var(--content-on-color)]"
                        >
                          <Camera size={18} weight="bold" />
                          Test Scan
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })
            )}
          </div>
        )}
          </>
        )}
      </div>

      {liveTarget && (
        <LiveQrScanner
          key={liveTarget.id}
          title={liveTarget.name}
          pickItem={{
            itemId: liveTarget.id,
            name: liveTarget.name,
            alias1: liveTarget.alias1,
            alias: liveTarget.alias,
            itemCode: liveTarget.pickCode,
            busyCode: liveTarget.busy_code ?? null,
          }}
          onClose={closeScan}
          onResolved={handleScanResolved}
          onError={(message) => {
            toast.error(message);
            closeScan();
          }}
        />
      )}
      {scanOnlyOpen && (
        <LiveQrScanner
          mode="collect"
          title="Product Scan Mode"
          eyebrow="Test Scan Lab"
          idleStatus="Point at product barcode or QR"
          helpText="This mode only scans and recognizes products based on current alias and barcode mappings."
          onClose={closeScanOnly}
          onResolved={handleScanOnlyResolved}
          onError={(message) => {
            toast.error(message);
            closeScanOnly();
          }}
        />
      )}
    </div>
  );
}
