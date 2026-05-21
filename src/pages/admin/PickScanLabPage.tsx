import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Camera,
  CaretLeft,
  CheckCircle,
  ClipboardText,
  Package,
  QrCode,
  Warning,
  X,
} from '@phosphor-icons/react';
import { useItems } from '../../hooks/useItems';
import { useToast } from '../../context/ToastContext';
import { BigButton, BottomSheet, LiveQrScanner, SearchInput, Skeleton } from '../../components/shared';
import type { Item, ItemPackDefinition, LicensePlatePackType, ScanResult } from '../../types';
import { appHaptics } from '../../lib/haptics';
import type { LiveQrScannerResolved } from '../../components/shared/LiveQrScanner';
import {
  computePickScanQuantity,
  partNoFromPickItem,
  type PickScanQuantityResult,
} from '../../lib/scanner/pickScanQuantity';
import { barcodeMatchesExpected } from '../../lib/scanner/pickBarcodeSelection';
import { isTafeLine } from '../../lib/picking/tafeBrand';
import { itemPickCode } from '../../utils/itemCodes';
import {
  fetchItemPackDefinitions,
  PACK_DEFINITIONS_QUERY_KEY,
} from '../../lib/packLpn';
import { initializeItemScanIndex, useItemScanIndexStore } from '../../stores/itemScanIndex';

type ScanLabRecord = Item & {
  pickCode: string;
};

type LabScannerMode = 'verify' | 'scan';

interface ScanOnlyResult {
  rawValue: string;
  recognizedItemName: string | null;
  recognizedBusyCode: number | null;
  matchedBy: string | null;
  codeType: LiveQrScannerResolved['codeType'];
  reason: string;
  timestamp: string;
  uomTier: LiveQrScannerResolved['uomTier'];
  baseQtyEa: number | null;
  packetQtyEa: number | null;
}

function buildScanLabRecord(item: Item): ScanLabRecord | null {
  const pickCode = itemPickCode(item);
  if (!pickCode) return null;
  return { ...item, pickCode };
}

function isLikelyVarrocLine(item: Pick<Item, 'main_group' | 'parent_group' | 'name'>): boolean {
  const blob = `${item.main_group ?? ''} ${item.parent_group ?? ''} ${item.name ?? ''}`.toUpperCase();
  return blob.includes('VARROC');
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

function packPayload(busyCode: number, packType: LicensePlatePackType): string {
  return `PASPL-PACK:${busyCode}:${packType}`;
}

function expectedCodesForItem(item: ScanLabRecord): string[] {
  return [item.alias1, item.alias, item.pickCode].filter(
    (code, index, values): code is string => Boolean(code) && values.indexOf(code) === index,
  );
}

function buildManualLabQuantity(
  targetQty: number,
  totalBefore: number,
  qtyToApply: number,
): PickScanQuantityResult {
  const remainingBefore = Math.max(0, targetQty - totalBefore);
  const floored = Math.max(0, Math.floor(qtyToApply));
  const requiresBreakConfirmation = floored > remainingBefore && remainingBefore > 0;
  const qtyAdded = floored <= 0 ? 0 : Math.min(remainingBefore, floored);
  const totalAfter = totalBefore + qtyAdded;
  return {
    scanKind: 'unknown',
    packType: null,
    packQty: null,
    tierLabel: 'Manual code verify',
    qtyAdded,
    targetQty,
    totalBefore,
    totalAfter,
    remainingBefore,
    remainingAfter: Math.max(0, targetQty - totalAfter),
    requiresBreakConfirmation,
  };
}

export default function PickScanLabPage(): React.JSX.Element {
  const navigate = useNavigate();
  const toast = useToast();
  const [searchParams] = useSearchParams();
  const preloadItemIdParam = searchParams.get('itemId');
  const scrollTargetIdRef = useRef<number | null>(null);
  const didApplyDeepLinkRef = useRef(false);
  const barcodeMappingMap = useItemScanIndexStore((s) => s.barcodeMappingMap);
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
    quantity: PickScanQuantityResult;
  } | null>(null);
  const [scanOnlyHistory, setScanOnlyHistory] = useState<ScanOnlyResult[]>([]);
  const [manualCodeVerifyItem, setManualCodeVerifyItem] = useState<ScanLabRecord | null>(null);
  const [manualCodeInput, setManualCodeInput] = useState('');
  const [manualCodeQtyInput, setManualCodeQtyInput] = useState('1');
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const [focusedFromStudioItemId, setFocusedFromStudioItemId] = useState<number | null>(null);
  const [studioHintVisible, setStudioHintVisible] = useState(false);

  const oemBarcodeCountByItemId = useMemo(() => {
    const counts = new Map<number, number>();
    for (const sku of barcodeMappingMap.values()) {
      counts.set(sku.id, (counts.get(sku.id) ?? 0) + 1);
    }
    return counts;
  }, [barcodeMappingMap]);

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

  const pickLabContext = useMemo(() => {
    if (!liveTarget) return undefined;
    const packDefinition =
      liveTarget.busy_code == null
        ? null
        : (packDefinitionByBusyCode.get(Number(liveTarget.busy_code)) ?? null);
    return {
      targetQty,
      pickedSoFar: simulatedPickedQty,
      partNo: partNoFromPickItem({
        alias1: liveTarget.alias1,
        alias: liveTarget.alias,
        pickCode: liveTarget.pickCode,
      }),
      busyCode: liveTarget.busy_code != null ? Number(liveTarget.busy_code) : null,
      packDefinition,
    };
  }, [liveTarget, targetQty, simulatedPickedQty, packDefinitionByBusyCode]);

  const startScan = useCallback((item: ScanLabRecord) => {
    appHaptics.impactLight();
    setSimulatedPickedQty(0);
    setLastResult(null);
    setLiveTarget(item);
  }, []);

  const closeScan = useCallback(() => {
    setLiveTarget(null);
  }, []);

  const openManualCodeVerify = useCallback((item: ScanLabRecord) => {
    appHaptics.selection();
    setLiveTarget(null);
    const remaining = Math.max(1, targetQty - simulatedPickedQty);
    setManualCodeVerifyItem(item);
    setManualCodeInput('');
    setManualCodeQtyInput(String(remaining));
  }, [simulatedPickedQty, targetQty]);

  const confirmManualCodeVerify = useCallback(() => {
    const item = manualCodeVerifyItem;
    if (!item) return;

    const entered = manualCodeInput.trim();
    if (!entered) {
      toast.error('Enter the product code printed on the box');
      return;
    }

    if (!barcodeMatchesExpected(entered, expectedCodesForItem(item))) {
      appHaptics.warning();
      toast.error('Product code does not match this SKU. Check the label and try again.');
      return;
    }

    const parsedQty = Number(manualCodeQtyInput);
    if (!Number.isFinite(parsedQty) || parsedQty <= 0) {
      toast.error('Enter a valid quantity');
      return;
    }

    setSimulatedPickedQty((pickedBefore) => {
      const quantity = buildManualLabQuantity(targetQty, pickedBefore, parsedQty);
      const result: ScanResult = {
        scannedText: entered,
        confidence: 100,
        isMatch: true,
        matchedAgainst: item.pickCode,
        matchStrategy: 'manual_code_verify',
        ocrExtracted: { partNumber: entered, mrp: item.mrp ?? null },
        method: 'manual',
        timestamp: new Date().toISOString(),
        extractedCode: entered,
        extractedDescription: item.name,
        reason: 'Product code verified manually (barcode unreadable)',
        suggestedQty: Math.floor(parsedQty),
        requiresBreakConfirmation: quantity.requiresBreakConfirmation,
        operatorContext: {
          pickerName: null,
          pickerUserId: null,
          source: 'manual',
        },
      };
      setLastResult({ item, result, quantity });
      if (quantity.qtyAdded > 0) appHaptics.success();
      else appHaptics.warning();
      return quantity.qtyAdded > 0 ? quantity.totalAfter : pickedBefore;
    });

    setManualCodeVerifyItem(null);
    setManualCodeInput('');
    setManualCodeQtyInput('1');
  }, [manualCodeInput, manualCodeQtyInput, manualCodeVerifyItem, targetQty, toast]);

  const closeScanOnly = useCallback(() => {
    setScanOnlyOpen(false);
  }, []);

  useEffect(() => {
    void initializeItemScanIndex().catch(() => {});
  }, []);

  useEffect(() => {
    if (didApplyDeepLinkRef.current || !preloadItemIdParam || isLoading || !labelableItems.length) return;
    const idNum = Number(preloadItemIdParam.trim());
    if (!Number.isFinite(idNum) || idNum <= 0) {
      didApplyDeepLinkRef.current = true;
      return;
    }
    const row = labelableItems.find((i) => i.id === idNum) ?? null;
    const record = row ? buildScanLabRecord(row) : null;
    if (!record) {
      toast.error('Could not find this item for verification.');
      didApplyDeepLinkRef.current = true;
      return;
    }
    const code = record.pickCode || record.name.trim();
    setQuery(code.slice(0, 120));
    setLabScannerMode('verify');
    setFocusedFromStudioItemId(record.id);
    setStudioHintVisible(true);
    scrollTargetIdRef.current = record.id;
    toast.success('Ready to verify this SKU from Label Studio.');
    didApplyDeepLinkRef.current = true;
  }, [preloadItemIdParam, isLoading, labelableItems, toast]);

  useLayoutEffect(() => {
    const id = scrollTargetIdRef.current;
    if (id == null) return;
    if (!filteredItems.some((item) => item.id === id)) return;
    scrollTargetIdRef.current = null;
    window.requestAnimationFrame(() => {
      document.getElementById(`pick-scan-sku-${id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }, [filteredItems]);

  const handleScanResolved = useCallback((scan: LiveQrScannerResolved) => {
    setLiveTarget((current) => {
      if (!current) return null;
      const packDefinition =
        current.busy_code == null ? null : packDefinitionByBusyCode.get(Number(current.busy_code)) ?? null;

      setSimulatedPickedQty((pickedBefore) => {
        const quantity = computePickScanQuantity({
          rawValue: scan.rawValue,
          isMatch: scan.matchesPickItem,
          busyCode: current.busy_code != null ? Number(current.busy_code) : null,
          targetQty,
          totalBefore: pickedBefore,
          packDefinition,
          resolvedEa: scan.baseQtyEa,
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
        if (scan.matchesPickItem) appHaptics.success();
        else appHaptics.warning();
        return quantity.qtyAdded > 0 ? quantity.totalAfter : pickedBefore;
      });

      return current;
    });
  }, [packDefinitionByBusyCode, targetQty]);

  const handleScanOnlyResolved = useCallback((scan: LiveQrScannerResolved) => {
    const entry: ScanOnlyResult = {
      rawValue: scan.rawValue,
      recognizedItemName: scan.matchedItem?.name ?? null,
      recognizedBusyCode: scan.matchedItem?.busy_code != null
        ? Number(scan.matchedItem.busy_code)
        : null,
      matchedBy: scan.matchedBy ?? null,
      codeType: scan.codeType,
      reason: scan.reason,
      timestamp: new Date().toISOString(),
      uomTier: scan.uomTier,
      baseQtyEa: scan.baseQtyEa,
      packetQtyEa: scan.packetQtyEa,
    };
    setScanOnlyHistory((prev) => [entry, ...prev].slice(0, 20));
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
              Test the same scan rules as live picking: OEM multi-barcode selection, TAFE label hints,
              PASPL pack QRs, and manual product-code fallback.
            </p>
          </div>
        </div>

        {studioHintVisible && preloadItemIdParam ? (
          <div className="mt-5 flex flex-col gap-2 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-accent-subtle)] px-4 py-3 text-sm text-[var(--content-primary)]">
            <p>
              SKU opened from Label Studio (deep link). Search is narrowed to pick code; tap{' '}
              <span className="font-semibold">Test Scan</span> after printing stickers.
            </p>
            <button
              type="button"
              className="self-start rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 py-1 text-xs font-semibold text-[var(--content-secondary)]"
              onClick={() => setStudioHintVisible(false)}
            >
              Dismiss
            </button>
          </div>
        ) : null}

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

        <p className="mt-3 text-xs leading-relaxed text-[var(--content-tertiary)]">
          {labScannerMode === 'verify'
            ? 'Verify Mode mirrors the pick screen: expected SKU is known, OEM labels prefer the part-number QR/top 1D, and you can fall back to typed product code + qty.'
            : 'Scan Mode is open recognition only (no expected SKU) — useful to see what a raw barcode resolves to before mapping.'}
        </p>

        {labScannerMode === 'scan' && (
          <section className="mt-5 space-y-4">
            {/* CTA card */}
            <div className="flex items-center justify-between gap-4 rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[var(--content-primary)]">
                  Product recognition
                </p>
                <p className="mt-0.5 text-xs text-[var(--content-tertiary)]">
                  Scans resolve via alias, alias1, and barcode mapping — same as live picking.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setScanOnlyOpen(true)}
                className="inline-flex shrink-0 h-10 items-center justify-center gap-2 rounded-2xl bg-[var(--bg-positive)] px-4 text-sm font-semibold text-[var(--content-on-color)] active:scale-[0.97]"
                style={{ transition: 'transform 120ms ease-out' }}
              >
                <QrCode size={16} weight="bold" />
                Open Scanner
              </button>
            </div>

            {/* History */}
            {scanOnlyHistory.length > 0 && (
              <div className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--content-tertiary)]">
                    Scan history · {scanOnlyHistory.length}
                  </p>
                  <button
                    type="button"
                    onClick={() => setScanOnlyHistory([])}
                    className="flex items-center gap-1 text-xs font-semibold text-[var(--content-tertiary)] hover:text-[var(--content-primary)]"
                  >
                    <X size={12} weight="bold" />
                    Clear
                  </button>
                </div>
                <div className="space-y-2">
                  {scanOnlyHistory.map((entry, index) => (
                    <div
                      key={`${entry.timestamp}-${index}`}
                      className="flex items-start gap-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-3"
                    >
                      <div
                        className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                          entry.recognizedItemName
                            ? 'bg-[var(--bg-positive-subtle)]'
                            : 'bg-[var(--bg-warning-subtle)]'
                        }`}
                      >
                        {entry.recognizedItemName ? (
                          <CheckCircle size={15} weight="fill" className="text-[var(--content-positive)]" />
                        ) : (
                          <Package size={15} weight="fill" className="text-[var(--content-warning)]" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold leading-snug text-[var(--content-primary)] text-sm">
                          {entry.recognizedItemName ?? 'Not in catalog'}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          {entry.recognizedBusyCode != null && (
                            <span className="rounded-full border border-[var(--border-subtle)] px-2 py-0.5 font-mono text-[11px] text-[var(--content-tertiary)]">
                              Busy {entry.recognizedBusyCode}
                            </span>
                          )}
                          {entry.baseQtyEa != null && entry.baseQtyEa >= 1 && (
                            <span className="rounded-full border border-[var(--border-subtle)] px-2 py-0.5 font-mono text-[11px] text-[var(--content-tertiary)]">
                              UoM EA {entry.baseQtyEa}
                              {entry.uomTier ? ` · ${entry.uomTier}` : ''}
                            </span>
                          )}
                          {entry.matchedBy && (
                            <span className="rounded-full border border-[var(--border-subtle)] px-2 py-0.5 text-[11px] font-medium text-[var(--content-tertiary)]">
                              {entry.matchedBy}
                            </span>
                          )}
                        </div>
                        <p className="mt-1.5 break-all font-mono text-[11px] text-[var(--content-tertiary)]">
                          {entry.rawValue.length > 60
                            ? `${entry.rawValue.slice(0, 60)}…`
                            : entry.rawValue}
                        </p>
                      </div>
                      <p className="shrink-0 text-[10px] tabular-nums text-[var(--content-tertiary)]">
                        {new Date(entry.timestamp).toLocaleTimeString('en-IN', {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </p>
                    </div>
                  ))}
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
              <p>1. Search a SKU and tap <span className="font-semibold">Test Scan</span> — same engine as live picking.</p>
              <p>
                2. <span className="font-semibold">OEM box labels</span> (e.g. TAFE): scanner reads all barcodes in frame
                and picks the one matching this SKU&apos;s part code — not the bottom serial stamp.
              </p>
              <p>3. Scan PASPL ITEM, INNER, or MASTER pack strips; qty added follows UoM / pack definitions.</p>
              <p>
                4. If the camera won&apos;t read the label, use{' '}
                <span className="font-semibold">Enter product code</span> in the scanner or on the SKU row — type the
                printed alias and qty (same as pick screen).
              </p>
              <p>5. Break-pack cases (scan qty &gt; remaining) show the same confirmation flag as picking.</p>
              <p>
                6. From Label Studio:{' '}
                <span className="font-mono text-xs">/admin/pick-scan-lab?itemId=…</span> deep-links a printed SKU here.
              </p>
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
                        Part no: {partNoFromPickItem(lastResult.item)}
                        {lastResult.quantity.tierLabel ? ` · ${lastResult.quantity.tierLabel}` : ''}
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
                const oemMapCount = oemBarcodeCountByItemId.get(item.id) ?? 0;
                const varrocLikely = isLikelyVarrocLine(item);
                const tafeLikely = isTafeLine({
                  item_name: item.name,
                  main_group: item.main_group,
                  parent_group: item.parent_group,
                });

                return (
                  <article
                    id={`pick-scan-sku-${item.id}`}
                    key={item.id}
                    className={`rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4 transition-shadow ${
                      focusedFromStudioItemId === item.id ? 'shadow-[inset_0_0_0_2px_var(--bg-accent)]' : ''
                    }`}
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
                          {oemMapCount > 0 && (
                            <span className="rounded-full border border-[var(--border-subtle)] px-3 py-1 text-xs font-medium text-[var(--content-tertiary)]">
                              OEM barcode keys ×{oemMapCount}
                            </span>
                          )}
                          {tafeLikely && (
                            <span className="rounded-full bg-orange-100 px-3 py-1 text-xs font-semibold text-orange-900">
                              TAFE — use QR or top part barcode
                            </span>
                          )}
                          {varrocLikely && oemMapCount === 0 ? (
                            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900">
                              Varroc hint: map SAP codes in Barcode Mapping for carton scans
                            </span>
                          ) : null}
                          {packDefinition?.inner_pack_qty && (
                            <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
                              Inner {packDefinition.inner_pack_qty} pcs
                            </span>
                          )}
                          {packDefinition?.outer_pack_qty && (
                            <span className="rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-800">
                              Outer {packDefinition.outer_pack_qty} pcs
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
                                .then(() => toast.success('Outer pack payload copied'))
                                .catch(() => toast.error('Could not copy pack payload'));
                            }}
                            className="flex h-11 items-center justify-center rounded-2xl bg-sky-100 px-4 text-sm font-semibold text-sky-800"
                          >
                            Copy Outer
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
                        <button
                          type="button"
                          onClick={() => openManualCodeVerify(item)}
                          className="flex h-11 items-center justify-center rounded-2xl bg-[var(--bg-accent-subtle)] px-4 text-sm font-semibold text-[var(--content-accent)]"
                        >
                          Manual code
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

      {liveTarget && pickLabContext && (
        <LiveQrScanner
          key={liveTarget.id}
          mode="pickLab"
          title={liveTarget.name}
          eyebrow="Pick Scan Lab"
          idleStatus="Scan OEM box, PASPL pack strip, or piece QR"
          pickItem={{
            itemId: liveTarget.id,
            name: liveTarget.name,
            alias1: liveTarget.alias1,
            alias: liveTarget.alias,
            itemCode: liveTarget.pickCode,
            busyCode: liveTarget.busy_code ?? null,
            mainGroup: liveTarget.main_group,
            parentGroup: liveTarget.parent_group,
          }}
          pickLabContext={pickLabContext}
          onManualVerify={() => openManualCodeVerify(liveTarget)}
          onClose={closeScan}
          onResolved={handleScanResolved}
          onError={(message) => {
            toast.error(message);
            closeScan();
          }}
        />
      )}
      <BottomSheet
        isOpen={manualCodeVerifyItem !== null}
        onClose={() => {
          setManualCodeVerifyItem(null);
          setManualCodeInput('');
          setManualCodeQtyInput('1');
        }}
        title="Verify product code (lab)"
      >
        {manualCodeVerifyItem && (
          <div className="space-y-4">
            <p className="text-sm text-[var(--content-secondary)]">
              Same fallback as live picking for{' '}
              <span className="font-semibold text-[var(--content-primary)]">{manualCodeVerifyItem.name}</span>.
              Type the printed code and qty to simulate a manual verify pick.
            </p>
            <div className="rounded-xl border border-[var(--border-accent)] bg-[var(--bg-accent-subtle)] px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--content-accent)]">
                Expected code
              </p>
              <p className="font-mono text-base font-bold text-[var(--content-primary)] break-all">
                {manualCodeVerifyItem.pickCode}
              </p>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-[var(--content-secondary)]">
                Product code on box
              </label>
              <input
                type="text"
                inputMode="text"
                autoCapitalize="characters"
                autoComplete="off"
                value={manualCodeInput}
                onChange={(e) => setManualCodeInput(e.target.value)}
                placeholder="Enter printed code"
                className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] px-4 py-3 font-mono text-[var(--content-primary)]"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-[var(--content-secondary)]">
                Quantity
                <span className="text-[var(--content-tertiary)] font-normal">
                  {' '}
                  ({Math.max(0, targetQty - simulatedPickedQty)} remaining)
                </span>
              </label>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                value={manualCodeQtyInput}
                onChange={(e) => setManualCodeQtyInput(e.target.value)}
                className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] px-4 py-3 text-[var(--content-primary)]"
              />
            </div>
            <BigButton
              variant="primary"
              onClick={confirmManualCodeVerify}
              disabled={!manualCodeInput.trim()}
              className="bg-[var(--bg-accent)] text-[var(--content-on-color)]"
            >
              Verify &amp; apply qty
            </BigButton>
          </div>
        )}
      </BottomSheet>
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
