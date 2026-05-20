import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Barcode,
  CaretLeft,
  CaretRight,
  CheckCircle,
  MapPin,
  Package,
  Scales,
  Sparkle,
  Star,
} from '@phosphor-icons/react';
import { BigButton, LiveQrScanner, Skeleton } from '../../components/shared';
import type { LiveQrScannerResolved } from '../../components/shared/LiveQrScanner';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { supabase } from '../../lib/supabase/client';
import {
  fetchBarcodeCoverage,
  fetchMappedSkuSummaries,
  fetchPackDefsForBusyCodes,
  fetchShelfSiblingBinIds,
  inferShelfRowPrefix,
  loadSkuOptionsFromBin,
  normalizeBinCode,
  type BarcodeSkuOption,
  type SaveBarcodeMappingResult,
  type ShelfSiblingBinsPayload,
} from '../../lib/barcodeMapping';
import { classifyScanPayload, parseRackPayload } from '../../lib/scanner/qrPayload';
import { parseManufacturerBarcode } from '../../lib/scanner/barcodeParser';
import { fetchUomCoverageGaps, registerBarcodeWithTier, type UomTier } from '../../lib/scanner/uomMapper';
import { PACK_DEFINITIONS_QUERY_KEY, fetchItemPackDefinitions } from '../../lib/packLpn';
import { BIN_INVENTORY_QUERY_KEY, submitBinCount } from '../../lib/wms';
import { StagingPromotePanel } from '../../components/admin/StagingPromotePanel';
import { ITEMS_QUERY_KEY, useItems } from '../../hooks/useItems';
import type { ItemPackDefinition } from '../../types';
import { initializeItemScanIndex } from '../../stores/itemScanIndex';
import {
  applyTierScanToDraft,
  computeDerivedPieces,
  defaultHierarchyDraft,
  derivedSellingUnit,
  formatLayerLabel,
  hydrateHierarchyDraftFromCatalog,
  validateLayer1,
  validateLayer2,
  validateOuterScanGate,
  validatePacketScanGate,
  type HierarchyDraft,
  type HierarchyStep,
} from './binOnboardingHierarchy';

const MAPPED_SKUS_KEY = ['mapped-sku-summaries'] as const;
const BARCODE_COV_KEY = ['barcode-coverage-global'] as const;
const UOM_GAPS_KEY = ['uom-coverage-gaps-bin-wizard'] as const;
const SHELF_ROW_QUERY_KEY = 'bin-onboarding-shelf-row' as const;

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

function formatPct(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return `${Math.round(n)}%`;
}

function SkuAliasBlock({ sku }: { sku: BarcodeSkuOption }): ReactElement {
  const a1 = sku.alias1?.trim();
  const a = sku.alias?.trim();
  if (!a1 && !a) {
    return (
      <p className="mt-1 text-sm text-[var(--content-warning)]">
        No Alias 1 / Alias on file yet — add in catalog for faster shelf ID.
      </p>
    );
  }
  return (
    <div className="mt-1 space-y-1">
      {a1 ? (
        <p className="text-sm leading-snug">
          <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--content-accent)]">
            Alias 1
          </span>{' '}
          <span className="font-mono font-semibold text-[var(--content-primary)]">{a1}</span>
        </p>
      ) : null}
      {a ? (
        <p className="text-sm leading-snug">
          <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--content-accent)]">
            Alias
          </span>{' '}
          <span className="font-mono font-semibold text-[var(--content-primary)]">{a}</span>
        </p>
      ) : null}
    </div>
  );
}

/** One-line floor ID for “next SKU” preview (aliases first; falls back to truncated name). */
function skuQuickLabel(o: BarcodeSkuOption): string {
  const a1 = o.alias1?.trim();
  const a = o.alias?.trim();
  if (a1 && a) return `${a1} · ${a}`;
  if (a1) return a1;
  if (a) return a;
  return o.itemName.length > 44 ? `${o.itemName.slice(0, 42)}…` : o.itemName;
}

interface ShelfRowTourStripProps {
  payload: ShelfSiblingBinsPayload | undefined;
  loading: boolean;
  currentBinNorm: string;
  nextShelfBinId: string | null;
  prevShelfBinId: string | null;
  onLoadShelf: (id: string) => void;
  variant?: 'default' | 'compact';
}

function ShelfRowTourStrip({
  payload,
  loading,
  currentBinNorm,
  nextShelfBinId,
  prevShelfBinId,
  onLoadShelf,
  variant = 'default',
}: ShelfRowTourStripProps): ReactElement | null {
  if (loading) {
    return (
      <Skeleton className={`w-full rounded-2xl ${variant === 'compact' ? 'h-14' : 'h-[4.5rem]'}`} />
    );
  }
  if (!payload?.rowPrefix || payload.binIds.length < 2) return null;

  const { rowPrefix, binIds } = payload;
  const compact = variant === 'compact';

  return (
    <div
      className={`rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] ${
        compact ? 'p-2.5' : 'p-3'
      }`}
    >
      <div className="flex items-start gap-2">
        <MapPin
          size={compact ? 18 : 20}
          weight="bold"
          className="mt-0.5 shrink-0 text-[var(--content-accent)]"
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--content-accent)]">
            Shelf tour · rack row <span className="font-mono">{rowPrefix}</span>
          </p>
          {!compact ? (
            <p className="mt-1 text-xs leading-snug text-[var(--content-secondary)]">
              Same aisle slots ending with a letter after digits (e.g. …1E, …1F). Tap a label or use Prev /
              Next shelf — wraps around.
            </p>
          ) : (
            <p className="mt-1 text-[11px] leading-snug text-[var(--content-secondary)]">
              Same rack row (<span className="font-mono">{rowPrefix}</span>) — tap a code or Prev / Next.
            </p>
          )}
          <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
            {binIds.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => onLoadShelf(id)}
                className={`shrink-0 rounded-full border px-3 py-1.5 font-mono text-xs font-semibold transition-colors ${
                  id === currentBinNorm
                    ? 'border-[var(--border-accent)] bg-[var(--bg-accent)] text-[var(--content-on-color)]'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-secondary)] text-[var(--content-primary)] hover:bg-[var(--bg-tertiary)]'
                }`}
              >
                {id}
              </button>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <BigButton
              type="button"
              variant="secondary"
              className="min-h-11 shrink-0"
              disabled={!prevShelfBinId}
              onClick={() => prevShelfBinId && onLoadShelf(prevShelfBinId)}
            >
              <CaretLeft size={20} weight="bold" className="mr-1 inline align-middle" aria-hidden />
              Prev shelf
            </BigButton>
            <BigButton
              type="button"
              variant="primary"
              className="min-h-11 flex-1 bg-[var(--bg-accent)] text-[var(--content-on-color)]"
              disabled={!nextShelfBinId}
              onClick={() => nextShelfBinId && onLoadShelf(nextShelfBinId)}
            >
              Next shelf
              <CaretRight size={20} weight="bold" className="ml-1 inline align-middle" aria-hidden />
              {nextShelfBinId ? (
                <span className="ml-1 font-mono text-sm opacity-95">{nextShelfBinId}</span>
              ) : null}
            </BigButton>
          </div>
        </div>
      </div>
    </div>
  );
}

type ScanTarget = 'bin' | 'box' | 'packet' | 'piece';

type SessionTierLabels = Partial<Record<'box' | 'packet' | 'piece', string>>;

export default function BinOnboardingPage(): ReactElement {
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { userId, userName } = useAuth();
  const { data: items = [] } = useItems();

  const [binInput, setBinInput] = useState('');
  const [currentBinId, setCurrentBinId] = useState<string | null>(null);
  const [skuOptions, setSkuOptions] = useState<BarcodeSkuOption[]>([]);
  const [selectedBusyCode, setSelectedBusyCode] = useState<number | null>(null);

  const [scannerOpen, setScannerOpen] = useState<ScanTarget | null>(null);

  const [hierarchyDraft, setHierarchyDraft] = useState<HierarchyDraft>(() => defaultHierarchyDraft());
  const [hierarchyStep, setHierarchyStep] = useState<HierarchyStep>(1);

  const [tierConflict, setTierConflict] = useState<{
    tier: UomTier;
    raw: string;
    result: SaveBarcodeMappingResult;
  } | null>(null);

  const [sessionTierLabels, setSessionTierLabels] = useState<
    Record<number, SessionTierLabels>
  >({});

  const [sessionStats, setSessionStats] = useState({
    skusFullyOnboarded: 0,
    barcodesAdded: 0,
    uomConfirmed: 0,
    skipped: 0,
  });

  const [celebrateOpen, setCelebrateOpen] = useState(false);
  const prevBinCompleteRef = useRef(false);

  const [quickPlaceBin, setQuickPlaceBin] = useState('');
  const [quickPlaceSkuBusy, setQuickPlaceSkuBusy] = useState('');
  const [quickInnerPackQty, setQuickInnerPackQty] = useState('25');

  const quickPlaceMutation = useMutation({
    mutationFn: async () => {
      const binId = normalizeBinCode(quickPlaceBin);
      const bc = Number(quickPlaceSkuBusy);
      if (!binId || !Number.isFinite(bc)) throw new Error('bin_and_busy_required');

      let innerPackQty = Number(quickInnerPackQty);
      if (!Number.isFinite(innerPackQty) || innerPackQty < 1) innerPackQty = 25;

      let packs = queryClient.getQueryData<ItemPackDefinition[]>(PACK_DEFINITIONS_QUERY_KEY) ?? [];
      if (packs.length === 0) {
        packs = await fetchItemPackDefinitions();
        queryClient.setQueryData(PACK_DEFINITIONS_QUERY_KEY, packs);
      }
      const defRow = packs.find((p) => Number(p.busy_code) === bc);
      const fromDef =
        defRow?.inner_pack_qty != null && defRow.inner_pack_qty >= 1 ? defRow.inner_pack_qty : null;
      if (fromDef != null) innerPackQty = fromDef;

      return submitBinCount({
        binId,
        skuBusyCode: bc,
        innerPacks: 0,
        looseEaQty: 0,
        innerPackQty,
        dailyTarget: null,
        reorderPoint: null,
        countType: 'initial_setup',
        userId: userId ?? null,
        userName: userName ?? null,
        note: 'Quick place SKU',
      });
    },
    onSuccess: async (result) => {
      if (!result.success) {
        toast.error(result.reason ?? 'Could not assign bin.');
        return;
      }
      toast.success('SKU placed at bin.');
      await queryClient.invalidateQueries({ queryKey: PACK_DEFINITIONS_QUERY_KEY });
      await queryClient.invalidateQueries({ queryKey: BIN_INVENTORY_QUERY_KEY });
      setQuickPlaceBin('');
      setQuickPlaceSkuBusy('');
    },
    onError: () => toast.error('Could not assign bin.'),
  });

  const busyCodeOptions = useMemo(() => {
    return [...items]
      .filter((i) => i.busy_code != null && Number(i.busy_code) > 0)
      .sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }));
  }, [items]);

  useEffect(() => {
    void initializeItemScanIndex().catch(() => {
      toast.error('Could not load scan index. Refresh and try again.');
    });
  }, [toast]);

  const busyCodesInBin = useMemo(
    () => skuOptions.map((o) => o.skuBusyCode).filter((c) => Number.isFinite(c)),
    [skuOptions],
  );

  const currentBinNorm = useMemo(
    () => (currentBinId ? normalizeBinCode(currentBinId) : ''),
    [currentBinId],
  );

  const shelfRowPatternMatched = Boolean(currentBinNorm && inferShelfRowPrefix(currentBinNorm));

  const {
    data: packDefMap = new Map<number, ItemPackDefinition>(),
    isLoading: packDefsLoading,
  } = useQuery({
    queryKey: ['bin-pack-defs', currentBinId, busyCodesInBin.slice().sort().join(',')],
    queryFn: () => fetchPackDefsForBusyCodes(busyCodesInBin),
    enabled: busyCodesInBin.length > 0,
  });

  const {
    data: shelfRowPayload,
    isLoading: shelfRowLoading,
  } = useQuery({
    queryKey: [SHELF_ROW_QUERY_KEY, currentBinId],
    queryFn: () => fetchShelfSiblingBinIds(currentBinId!),
    enabled: shelfRowPatternMatched,
    staleTime: 120_000,
  });

  const nextShelfBinId = useMemo(() => {
    if (!shelfRowPayload || shelfRowPayload.binIds.length < 2 || !currentBinNorm) return null;
    const idx = shelfRowPayload.binIds.indexOf(currentBinNorm);
    if (idx < 0) return shelfRowPayload.binIds[0] ?? null;
    return shelfRowPayload.binIds[(idx + 1) % shelfRowPayload.binIds.length] ?? null;
  }, [shelfRowPayload, currentBinNorm]);

  const prevShelfBinId = useMemo(() => {
    if (!shelfRowPayload || shelfRowPayload.binIds.length < 2 || !currentBinNorm) return null;
    const n = shelfRowPayload.binIds.length;
    const idx = shelfRowPayload.binIds.indexOf(currentBinNorm);
    if (idx < 0) return shelfRowPayload.binIds[n - 1] ?? null;
    return shelfRowPayload.binIds[(idx - 1 + n) % n] ?? null;
  }, [shelfRowPayload, currentBinNorm]);

  const { data: mappedRows = [], isLoading: mappedLoading } = useQuery({
    queryKey: MAPPED_SKUS_KEY,
    queryFn: fetchMappedSkuSummaries,
    staleTime: 60_000,
  });

  const mappedSkuSet = useMemo(() => {
    const s = new Set<number>();
    for (const r of mappedRows) {
      if (Number.isFinite(r.skuBusyCode)) s.add(r.skuBusyCode);
    }
    return s;
  }, [mappedRows]);

  const { data: barcodeCoverage } = useQuery({
    queryKey: BARCODE_COV_KEY,
    queryFn: fetchBarcodeCoverage,
    staleTime: 60_000,
  });

  const { data: uomGaps = [] } = useQuery({
    queryKey: UOM_GAPS_KEY,
    queryFn: () => fetchUomCoverageGaps(5000),
    staleTime: 60_000,
  });

  const activeBusyCodesTotal = useMemo(() => {
    let n = 0;
    for (const it of items) {
      if (it.is_active === false) continue;
      if (it.busy_code == null) continue;
      n += 1;
    }
    return n;
  }, [items]);

  const uomCoverageApprox = useMemo(() => {
    const gapsCount = uomGaps.length;
    const total = activeBusyCodesTotal;
    if (total <= 0) return { pct: 0 as number | null, truncated: false };
    const truncated = gapsCount >= 5000;
    const confirmedApprox = Math.max(0, total - gapsCount);
    const pct = (confirmedApprox / total) * 100;
    return { pct, truncated };
  }, [uomGaps.length, activeBusyCodesTotal]);

  const selectedSku = useMemo(
    () => skuOptions.find((o) => o.skuBusyCode === selectedBusyCode) ?? null,
    [skuOptions, selectedBusyCode],
  );

  const worksheetOpen = selectedSku != null;

  const worksheetBinNav = useMemo(() => {
    if (!selectedSku || skuOptions.length === 0) return null;
    const idx = skuOptions.findIndex((o) => o.skuBusyCode === selectedSku.skuBusyCode);
    if (idx < 0) return null;
    const total = skuOptions.length;
    const nextIdx = total > 1 ? (idx + 1) % total : idx;
    return {
      position: idx + 1,
      total,
      nextSku: skuOptions[nextIdx],
      canAdvance: total > 1,
    };
  }, [selectedSku, skuOptions]);

  const manufacturer = useMemo(
    () => selectedSku?.mainGroup ?? selectedSku?.parentGroup ?? null,
    [selectedSku],
  );

  /** Next SKU in bin order that still needs barcode or UoM confirmation */
  const nextIncompleteBusyCode = useCallback(
    (
      afterBusyCode: number | null,
      defsOverride?: Map<number, ItemPackDefinition>,
    ): number | null => {
      const defs = defsOverride ?? packDefMap;
      if (skuOptions.length === 0) return null;
      const idx =
        afterBusyCode != null ? skuOptions.findIndex((o) => o.skuBusyCode === afterBusyCode) : -1;
      const rotated =
        idx >= 0
          ? [...skuOptions.slice(idx + 1), ...skuOptions.slice(0, idx + 1)]
          : [...skuOptions];

      for (const o of rotated) {
        const bc = o.skuBusyCode;
        const barcodeOk = mappedSkuSet.has(bc);
        const def = defs.get(bc);
        const uomOk = Boolean(def?.confirmed_at);
        if (!barcodeOk || !uomOk) return bc;
      }
      return null;
    },
    [skuOptions, mappedSkuSet, packDefMap],
  );

  const binComplete = useMemo(() => {
    if (skuOptions.length === 0) return false;
    return skuOptions.every((o) => {
      const bc = o.skuBusyCode;
      return mappedSkuSet.has(bc) && Boolean(packDefMap.get(bc)?.confirmed_at);
    });
  }, [skuOptions, mappedSkuSet, packDefMap]);

  useEffect(() => {
    if (binComplete && !prevBinCompleteRef.current && skuOptions.length > 0) {
      setCelebrateOpen(true);
    }
    prevBinCompleteRef.current = binComplete;
  }, [binComplete, skuOptions.length]);

  const loadBinMutation = useMutation({
    mutationFn: async (rawBin: string) => {
      const binId = normalizeBinCode(rawBin);
      if (!binId) throw new Error('Enter or scan a bin code.');
      const rows = await loadSkuOptionsFromBin(binId);
      return { binId, rows };
    },
    onSuccess: ({ binId, rows }) => {
      setCurrentBinId(binId);
      setSkuOptions(rows);
      setSelectedBusyCode(null);
      setTierConflict(null);
      setBinInput(binId);
      if (rows.length === 0) {
        toast.warning(`No SKUs found for bin ${binId}.`);
        return;
      }
      toast.success(`Loaded ${rows.length} SKU(s) for ${binId}.`);
    },
    onError: (e: Error) => toast.error(e.message || 'Could not load bin.'),
  });

  const handleLoadShelfBin = useCallback(
    (id: string) => {
      setCelebrateOpen(false);
      setSelectedBusyCode(null);
      loadBinMutation.mutate(id);
    },
    [loadBinMutation],
  );

  const handleResolveBinFromScan = useCallback((raw: string): string => {
    const trimmed = raw.trim();
    const classified = classifyScanPayload(trimmed);
    if (classified.kind === 'rack' && classified.rackPayload?.rackCode) {
      return normalizeBinCode(classified.rackPayload.rackCode);
    }
    const rack = parseRackPayload(trimmed);
    if (rack?.rackCode) return normalizeBinCode(rack.rackCode);
    return normalizeBinCode(trimmed);
  }, []);

  const handleBinScanResolved = useCallback(
    (scan: LiveQrScannerResolved) => {
      const code = handleResolveBinFromScan(scan.rawValue);
      setScannerOpen(null);
      loadBinMutation.mutate(code);
    },
    [handleResolveBinFromScan, loadBinMutation],
  );

  const handleTierScanResolved = useCallback(
    async (scan: LiveQrScannerResolved, tier: UomTier) => {
      if (!selectedSku || tierConflict) return;

      const classified = classifyScanPayload(scan.rawValue);
      if (classified.kind === 'rack') {
        toast.warning('Scan a manufacturer barcode, not a bin/rack label.');
        return;
      }

      const parsed = parseManufacturerBarcode(scan.rawValue);
      if (!parsed.key?.trim() || !isLikelyManufacturerPartKey(parsed.key)) {
        toast.error('That scan does not look like a manufacturer part barcode.');
        return;
      }

      const res = await registerBarcodeWithTier({
        rawValue: scan.rawValue,
        skuBusyCode: selectedSku.skuBusyCode,
        binId: selectedSku.binId,
        manufacturer,
        mappedByUserId: userId,
        mappedByName: userName,
        tier,
        force: false,
      });

      if (res.ok === false && res.kind === 'wrong_sku') {
        toast.warning(
          `Scanned label belongs to Busy ${res.resolvedBusyCode}${
            res.resolvedItemName ? ` (${res.resolvedItemName})` : ''
          }. Move to that SKU first.`,
        );
        return;
      }

      if (res.ok === false && res.kind === 'conflict') {
        setTierConflict({ tier, raw: scan.rawValue, result: res.result });
        setScannerOpen(null);
        return;
      }

      if (res.ok === false && res.kind === 'invalid') {
        toast.error(res.message);
        return;
      }

      if (res.ok && res.barcodeStatus === 'saved') {
        setSessionStats((s) => ({ ...s, barcodesAdded: s.barcodesAdded + 1 }));
      }

      const displayKey = parsed.key.trim().toUpperCase();
      setSessionTierLabels((prev) => ({
        ...prev,
        [selectedSku.skuBusyCode]: {
          ...(prev[selectedSku.skuBusyCode] ?? {}),
          [tier === 'box' ? 'box' : tier === 'packet' ? 'packet' : 'piece']: displayKey,
        },
      }));

      setHierarchyDraft((d) => applyTierScanToDraft(d, tier, scan.rawValue));

      void queryClient.invalidateQueries({ queryKey: MAPPED_SKUS_KEY });
      setScannerOpen(null);
      toast.success(`${tier} label saved (${displayKey}).`);
    },
    [
      selectedSku,
      tierConflict,
      manufacturer,
      userId,
      userName,
      toast,
      queryClient,
    ],
  );

  const handleConflictForce = useCallback(async () => {
    if (!tierConflict || !selectedSku) return;
    const { tier, raw } = tierConflict;
    const parsed = parseManufacturerBarcode(raw);
    const res = await registerBarcodeWithTier({
      rawValue: raw,
      skuBusyCode: selectedSku.skuBusyCode,
      binId: selectedSku.binId,
      manufacturer,
      mappedByUserId: userId,
      mappedByName: userName,
      tier,
      force: true,
    });

    setTierConflict(null);

    if (res.ok === false && res.kind === 'wrong_sku') {
      toast.warning(
        `Scanned label belongs to Busy ${res.resolvedBusyCode}. Move to that SKU first.`,
      );
      return;
    }
    if (res.ok === false && res.kind === 'invalid') {
      toast.error(res.message);
      return;
    }
    if (res.ok === false && res.kind === 'conflict') {
      toast.error(res.result.message ?? 'Still conflicted.');
      return;
    }

    if (!res.ok) {
      toast.error('Could not save barcode.');
      return;
    }

    if (res.barcodeStatus === 'saved') {
      setSessionStats((s) => ({ ...s, barcodesAdded: s.barcodesAdded + 1 }));
    }

    const displayKey = parsed.key.trim().toUpperCase();
    setSessionTierLabels((prev) => ({
      ...prev,
      [selectedSku.skuBusyCode]: {
        ...(prev[selectedSku.skuBusyCode] ?? {}),
        [tier === 'box' ? 'box' : tier === 'packet' ? 'packet' : 'piece']: displayKey,
      },
    }));

    setHierarchyDraft((d) => applyTierScanToDraft(d, tier, raw));

    void queryClient.invalidateQueries({ queryKey: MAPPED_SKUS_KEY });
    toast.success(`${tier} label forced for this SKU (${displayKey}).`);
  }, [tierConflict, selectedSku, manufacturer, userId, userName, toast, queryClient]);

  useEffect(() => {
    if (!selectedSku) return;
    const bc = selectedSku.skuBusyCode;
    const def = packDefMap.get(bc);
    const itemRow = items.find((i) => Number(i.busy_code) === bc);
    const su = itemRow?.selling_unit;
    const normalizedSu =
      su === 'packet' || su === 'box' || su === 'piece' ? su : undefined;
    setHierarchyDraft(
      hydrateHierarchyDraftFromCatalog({
        def,
        sellingUnit: normalizedSu,
      }),
    );
    setHierarchyStep(1);
  }, [selectedSku?.skuBusyCode, packDefMap, items]);

  const saveSkuMutation = useMutation({
    mutationFn: async (draft: HierarchyDraft) => {
      if (!selectedSku) throw new Error('Pick a SKU first.');

      const err1 = validateLayer1(draft);
      if (err1) throw new Error(err1);
      const err2 = validateLayer2(draft);
      if (err2) throw new Error(err2);

      const derived = computeDerivedPieces(draft);
      if (!derived) throw new Error('Could not derive pack math — check inner counts.');

      const innerN = derived.piecesPerPacket;
      const outerN = derived.piecesPerBox;
      const sellingUnit = derivedSellingUnit(draft);

      if (sellingUnit !== 'piece' && innerN <= 1) {
        throw new Error('Selling in packs requires pieces-per-packet > 1.');
      }

      const packetLabel = formatLayerLabel(draft.packet.labelPreset, draft.packet.labelCustom);
      const boxLabel = formatLayerLabel(draft.box.labelPreset, draft.box.labelCustom);

      const bc = selectedSku.skuBusyCode;
      const hadBarcodeAtSaveStart = mappedSkuSet.has(bc);
      const wasConfirmed = Boolean(packDefMap.get(bc)?.confirmed_at);

      const { data, error } = await supabase.rpc('upsert_uom_definition', {
        p_busy_code: bc,
        p_inner_pack_qty: Math.floor(innerN),
        p_outer_pack_qty: Math.floor(outerN),
        p_packet_label: packetLabel.trim() || null,
        p_box_label: boxLabel.trim() || null,
        p_selling_unit: sellingUnit,
        p_barcode_raw: null,
        p_barcode_tier: null,
        p_user_id: userId,
      });

      if (error) throw error;
      const payload = data as { success?: boolean; reason?: string };
      if (!payload?.success) {
        throw new Error(payload?.reason ?? 'save_failed');
      }

      return { bc, hadBarcodeAtSaveStart, wasConfirmed };
    },
    onSuccess: async ({ bc, hadBarcodeAtSaveStart, wasConfirmed }) => {
      toast.success('SKU saved — UoM confirmed.');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: PACK_DEFINITIONS_QUERY_KEY }),
        queryClient.invalidateQueries({
          queryKey: ['bin-pack-defs', currentBinId, busyCodesInBin.slice().sort().join(',')],
        }),
        queryClient.invalidateQueries({ queryKey: ITEMS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: UOM_GAPS_KEY }),
        queryClient.invalidateQueries({ queryKey: MAPPED_SKUS_KEY }),
      ]);

      setSessionStats((s) => ({
        ...s,
        uomConfirmed: s.uomConfirmed + (wasConfirmed ? 0 : 1),
        skusFullyOnboarded:
          s.skusFullyOnboarded + (!wasConfirmed && hadBarcodeAtSaveStart ? 1 : 0),
      }));

      const defsAfterSave = new Map(packDefMap);
      const prevRow = defsAfterSave.get(bc);
      const skuMeta = skuOptions.find((o) => o.skuBusyCode === bc);
      defsAfterSave.set(bc, {
        ...(prevRow ?? {
          busy_code: bc,
          item_id_snapshot: skuMeta?.itemId ?? null,
          item_name_snapshot: skuMeta?.itemName ?? '',
          inner_pack_qty: null,
          outer_pack_qty: null,
          packet_label: null,
          box_label: null,
          source_file: null,
          updated_at: new Date().toISOString(),
        }),
        busy_code: bc,
        confirmed_at: new Date().toISOString(),
      });

      const next = nextIncompleteBusyCode(bc, defsAfterSave);
      setSelectedBusyCode(next);
      setTierConflict(null);
      setHierarchyStep(1);
      setHierarchyDraft(defaultHierarchyDraft());
    },
    onError: (e: Error) => toast.error(e.message || 'Could not save.'),
  });

  const handleSaveSku = useCallback(() => {
    saveSkuMutation.mutate(hierarchyDraft);
  }, [saveSkuMutation, hierarchyDraft]);

  const handleHierarchyContinue = useCallback(() => {
    if (hierarchyStep === 1) {
      const a = validateOuterScanGate(hierarchyDraft);
      if (a) {
        toast.warning(a);
        return;
      }
      const b = validateLayer1(hierarchyDraft);
      if (b) {
        toast.warning(b);
        return;
      }
      setHierarchyStep(2);
      return;
    }
    if (hierarchyStep === 2) {
      const a = validatePacketScanGate(hierarchyDraft);
      if (a) {
        toast.warning(a);
        return;
      }
      const b = validateLayer2(hierarchyDraft);
      if (b) {
        toast.warning(b);
        return;
      }
      setHierarchyStep(3);
      return;
    }
    if (hierarchyStep === 3) {
      setHierarchyStep('review');
    }
  }, [hierarchyStep, hierarchyDraft, toast]);

  const handleHierarchyBack = useCallback(() => {
    if (hierarchyStep === 'review') {
      setHierarchyStep(3);
      return;
    }
    if (hierarchyStep === 3) {
      setHierarchyStep(2);
      return;
    }
    if (hierarchyStep === 2) {
      setHierarchyStep(1);
    }
  }, [hierarchyStep]);

  const handleSkipSkuFixed = useCallback(() => {
    if (!selectedSku) return;
    setSessionStats((s) => ({ ...s, skipped: s.skipped + 1 }));
    const next = nextIncompleteBusyCode(selectedSku.skuBusyCode);
    setSelectedBusyCode(next);
    setTierConflict(null);
    toast.warning('Skipped — remember to come back to this SKU.');
  }, [selectedSku, nextIncompleteBusyCode, toast]);

  const handleNextSkuInBin = useCallback(() => {
    if (!worksheetBinNav?.canAdvance || !worksheetBinNav.nextSku) return;
    setSelectedBusyCode(worksheetBinNav.nextSku.skuBusyCode);
    setTierConflict(null);
  }, [worksheetBinNav]);

  const pillsForRow = useCallback(
    (bc: number) => {
      const barcodeOk = mappedSkuSet.has(bc);
      const def = packDefMap.get(bc);
      const uomGrey = !def;
      const uomOk = Boolean(def?.confirmed_at);
      const uomAmber = Boolean(def) && !def?.confirmed_at;
      return { barcodeOk, uomGrey, uomOk, uomAmber };
    },
    [mappedSkuSet, packDefMap],
  );

  const barcodePct = barcodeCoverage?.coverage_pct ?? null;

  const bcForWorksheet = selectedSku?.skuBusyCode;
  const tierDisplay = bcForWorksheet
    ? sessionTierLabels[bcForWorksheet]
    : undefined;

  const derivedPreview = useMemo(
    () => computeDerivedPieces(hierarchyDraft),
    [hierarchyDraft],
  );

  const sellingPreview = useMemo(
    () => derivedSellingUnit(hierarchyDraft),
    [hierarchyDraft],
  );

  return (
    <div className="role-admin min-h-screen bg-[var(--bg-primary)] pb-28">
      <div className="mx-auto max-w-lg px-4 pt-4 lg:max-w-2xl lg:px-6">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/admin')}
            className="min-h-11 min-w-11 rounded-xl text-[var(--content-secondary)]"
            aria-label="Back"
          >
            <CaretLeft size={24} weight="bold" />
          </button>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-[var(--content-primary)]">Bin onboarding</h1>
            <p className="text-sm text-[var(--content-tertiary)]">
              Barcode tiers + pack quantities per SKU in one pass at the bin.
            </p>
          </div>
        </div>

        <section className="mt-5 rounded-2xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4">
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--content-accent)]">
            Quick assign
          </p>
          <p className="mt-1 text-sm text-[var(--content-secondary)]">
            Place a SKU in a bin slot without running the tier wizard (Receiving). Uses inner pack qty from master
            when available.
          </p>
          <div className="mt-3 space-y-2">
            <input
              placeholder="BIN e.g. GGR-1E"
              className="min-h-11 w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 font-mono text-sm"
              value={quickPlaceBin}
              onChange={(e) => setQuickPlaceBin(e.target.value)}
            />
            <select
              className="min-h-11 w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 text-sm"
              value={quickPlaceSkuBusy}
              onChange={(e) => setQuickPlaceSkuBusy(e.target.value)}
            >
              <option value="">Select SKU…</option>
              {busyCodeOptions.map((it) => (
                <option key={it.id} value={String(it.busy_code)}>
                  {it.busy_code} — {it.name}
                </option>
              ))}
            </select>
            <input
              placeholder="Fallback inner pack qty (EA per inner)"
              className="min-h-11 w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 font-mono text-sm"
              value={quickInnerPackQty}
              onChange={(e) => setQuickInnerPackQty(e.target.value)}
            />
            <BigButton
              type="button"
              variant="secondary"
              className="w-full min-h-11"
              disabled={quickPlaceMutation.isPending}
              onClick={() => quickPlaceMutation.mutate()}
            >
              Place SKU at bin
            </BigButton>
          </div>
        </section>

        <div className="mt-4 grid grid-cols-3 gap-2">
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3">
            <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--content-tertiary)]">
              Barcode cov.
            </p>
            <p className="mt-1 text-xl font-bold tabular-nums text-[var(--content-primary)]">
              {barcodePct != null ? formatPct(barcodePct) : '—'}
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3">
            <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--content-tertiary)]">
              UoM cov.{uomCoverageApprox.truncated ? ' ≤' : ''}
            </p>
            <p className="mt-1 text-xl font-bold tabular-nums text-[var(--content-primary)]">
              {formatPct(uomCoverageApprox.pct ?? 0)}
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3">
            <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--content-tertiary)]">
              Session
            </p>
            <p className="mt-1 text-[10px] leading-tight text-[var(--content-secondary)]">
              SKUs {sessionStats.skusFullyOnboarded} · BC {sessionStats.barcodesAdded} · UoM{' '}
              {sessionStats.uomConfirmed} · Skip {sessionStats.skipped}
            </p>
          </div>
        </div>

        <section className="mt-6 space-y-4 rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--bg-accent-subtle)]">
              <Package size={22} className="text-[var(--content-accent)]" weight="bold" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-[var(--content-primary)]">1. Scan bin QR</p>
              <p className="mt-1 text-sm text-[var(--content-tertiary)]">
                Loads every SKU in this bin from inventory / rack. Bins named like{' '}
                <span className="font-mono text-[var(--content-secondary)]">GGR-1E</span>,{' '}
                <span className="font-mono text-[var(--content-secondary)]">GGR-1F</span> open a{' '}
                <span className="font-semibold text-[var(--content-primary)]">shelf tour</span> below so you can
                walk the whole rack row without re-scanning.
              </p>
              <BigButton
                type="button"
                variant="primary"
                className="mt-3 w-full bg-[var(--bg-accent)] text-[var(--content-on-color)]"
                onClick={() => setScannerOpen('bin')}
              >
                Scan bin
              </BigButton>
              <form
                className="mt-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  loadBinMutation.mutate(binInput);
                }}
              >
                <label className="sr-only" htmlFor="bin-onboarding-bin-input">
                  Bin code
                </label>
                <input
                  id="bin-onboarding-bin-input"
                  type="text"
                  value={binInput}
                  onChange={(e) => setBinInput(e.target.value)}
                  placeholder="Or type bin code"
                  className="w-full rounded-xl border border-[var(--border-opaque)] bg-[var(--bg-primary)] px-3 py-3 text-[var(--content-primary)]"
                  autoComplete="off"
                />
              </form>
              <BigButton
                type="button"
                variant="secondary"
                className="mt-2 w-full"
                disabled={loadBinMutation.isPending || !binInput.trim()}
                onClick={() => loadBinMutation.mutate(binInput)}
              >
                Load bin
              </BigButton>
            </div>
          </div>

          {currentBinId && (
            <p className="text-center text-sm font-medium text-[var(--content-secondary)]">
              Bin <span className="font-mono">{currentBinId}</span> · {skuOptions.length} SKU(s)
            </p>
          )}
          {shelfRowPatternMatched ? (
            <div className="mt-3">
              <ShelfRowTourStrip
                payload={shelfRowPayload}
                loading={shelfRowLoading}
                currentBinNorm={currentBinNorm}
                nextShelfBinId={nextShelfBinId}
                prevShelfBinId={prevShelfBinId}
                onLoadShelf={handleLoadShelfBin}
              />
            </div>
          ) : null}
        </section>

        {skuOptions.length > 0 && !worksheetOpen && (
          <section className="mt-6 space-y-2">
            <div className="mb-1">
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
                Pick SKU
              </p>
              <p className="mt-0.5 text-xs text-[var(--content-secondary)]">
                Spot parts using <span className="font-semibold text-[var(--content-primary)]">Alias 1</span>{' '}
                and <span className="font-semibold text-[var(--content-primary)]">Alias</span> — not Busy codes.
              </p>
            </div>
            {(mappedLoading || packDefsLoading) && <Skeleton className="h-24 w-full rounded-2xl" />}
            {!mappedLoading &&
              !packDefsLoading &&
              skuOptions.map((o) => {
                const { barcodeOk, uomOk, uomAmber, uomGrey } = pillsForRow(o.skuBusyCode);
                const complete = barcodeOk && uomOk;
                return (
                  <button
                    key={`${o.binId}-${o.skuBusyCode}`}
                    type="button"
                    onClick={() => setSelectedBusyCode(o.skuBusyCode)}
                    className={`flex w-full flex-col gap-2 rounded-2xl border p-4 text-left transition-colors ${
                      complete
                        ? 'border-[var(--border-subtle)] bg-[var(--bg-secondary)] opacity-80'
                        : 'border-[var(--border-subtle)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold text-[var(--content-primary)] leading-snug">{o.itemName}</p>
                        <SkuAliasBlock sku={o} />
                      </div>
                      {complete && (
                        <CheckCircle
                          size={22}
                          weight="bold"
                          className="shrink-0 text-[var(--content-positive)]"
                        />
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          barcodeOk
                            ? 'bg-[var(--bg-positive-subtle)] text-[var(--content-positive)]'
                            : 'bg-[var(--bg-tertiary)] text-[var(--content-tertiary)]'
                        }`}
                      >
                        <Barcode size={12} className="mr-1 inline" />
                        Barcode
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          uomOk
                            ? 'bg-[var(--bg-positive-subtle)] text-[var(--content-positive)]'
                            : uomAmber
                              ? 'bg-[var(--bg-warning-subtle)] text-[var(--content-warning)]'
                              : uomGrey
                                ? 'bg-[var(--bg-tertiary)] text-[var(--content-tertiary)]'
                                : ''
                        }`}
                      >
                        <Scales size={12} className="mr-1 inline" />
                        UoM {uomOk ? 'OK' : uomGrey ? '—' : 'draft'}
                      </span>
                    </div>
                  </button>
                );
              })}
          </section>
        )}

        {worksheetOpen && selectedSku && (
          <section className="mt-6 space-y-4 rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
                  Worksheet · Bin {selectedSku.binId}
                </p>
                <p className="mt-1 text-lg font-bold text-[var(--content-primary)] leading-snug">
                  {selectedSku.itemName}
                </p>
                <SkuAliasBlock sku={selectedSku} />
              </div>
              <button
                type="button"
                className="text-sm font-medium text-[var(--content-accent)]"
                onClick={() => setSelectedBusyCode(null)}
              >
                Back to list
              </button>
            </div>

            <StagingPromotePanel
              busyCode={selectedSku.skuBusyCode}
              targetBinId={selectedSku.binId}
              userId={userId ?? null}
              userName={userName ?? null}
            />

            {tierConflict && (
              <div className="rounded-2xl border border-[var(--border-warning)] bg-[var(--bg-warning-subtle)] p-4">
                <p className="text-sm font-semibold text-[var(--content-primary)]">Barcode conflict</p>
                <p className="mt-2 text-sm text-[var(--content-secondary)]">
                  This barcode is mapped to{' '}
                  <span className="font-medium">
                    {tierConflict.result.existing_item_name ?? `Busy ${tierConflict.result.existing_sku}`}
                  </span>
                  {tierConflict.result.existing_bin_id ? ` at bin ${tierConflict.result.existing_bin_id}` : ''}.
                  Use this SKU instead?
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <BigButton type="button" variant="secondary" onClick={() => setTierConflict(null)}>
                    Keep existing mapping
                  </BigButton>
                  <BigButton type="button" variant="primary" onClick={() => void handleConflictForce()}>
                    Force to this SKU
                  </BigButton>
                </div>
              </div>
            )}

            {hierarchyStep !== 'review' ? (
              <p className="text-center text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--content-tertiary)]">
                Step {hierarchyStep} of 3 · Peel outer → inner → optional piece
              </p>
            ) : (
              <p className="text-center text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--content-accent)]">
                Review — confirm before saving
              </p>
            )}

            {hierarchyStep === 1 && (
              <div className="space-y-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-4">
                <p className="text-sm font-semibold text-[var(--content-primary)]">Outer carton</p>
                <p className="text-xs text-[var(--content-secondary)]">
                  Scan the manufacturer barcode on the outer pack, or say there isn&apos;t one.
                </p>
                <div className="flex flex-wrap gap-2">
                  <BigButton
                    type="button"
                    variant="secondary"
                    className="min-h-12 flex-1"
                    disabled={hierarchyDraft.box.noLabel}
                    onClick={() => setScannerOpen('box')}
                  >
                    Scan outer label
                  </BigButton>
                  <BigButton
                    type="button"
                    variant={hierarchyDraft.box.noLabel ? 'primary' : 'ghost'}
                    className="min-h-12 flex-1"
                    onClick={() =>
                      setHierarchyDraft((d) => ({
                        ...d,
                        box: { ...d.box, noLabel: true, scanRaw: null },
                      }))
                    }
                  >
                    No outer barcode
                  </BigButton>
                </div>
                {(tierDisplay?.box || hierarchyDraft.box.scanRaw) && !hierarchyDraft.box.noLabel ? (
                  <p className="font-mono text-sm text-[var(--content-positive)]">
                    Saved key: {tierDisplay?.box ?? '…'} → box
                  </p>
                ) : null}
                {hierarchyDraft.box.noLabel ? (
                  <div className="flex flex-col gap-1">
                    <p className="text-sm text-[var(--content-tertiary)]">Outer tier marked as no barcode.</p>
                    <button
                      type="button"
                      className="text-left text-sm font-medium text-[var(--content-accent)]"
                      onClick={() =>
                        setHierarchyDraft((d) => ({
                          ...d,
                          box: { ...d.box, noLabel: false },
                        }))
                      }
                    >
                      Undo — scan a barcode instead
                    </button>
                  </div>
                ) : null}

                <label className="block pt-1">
                  <span className="text-xs font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
                    Inner packs inside this outer
                  </span>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    inputMode="numeric"
                    value={hierarchyDraft.box.packetsInside === '' ? '' : hierarchyDraft.box.packetsInside}
                    onChange={(e) => {
                      const v = e.target.value;
                      setHierarchyDraft((d) => ({
                        ...d,
                        box: {
                          ...d.box,
                          packetsInside: v === '' ? '' : Number(v),
                        },
                      }));
                    }}
                    className="mt-1 w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-3 text-lg font-semibold tabular-nums text-[var(--content-primary)]"
                    placeholder="e.g. 12"
                  />
                </label>

                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
                    Label shown for outer (catalog)
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(['Box', 'Carton', 'Outer'] as const).map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() =>
                          setHierarchyDraft((d) => ({
                            ...d,
                            box: { ...d.box, labelPreset: p },
                          }))
                        }
                        className={`rounded-full px-3 py-2 text-sm font-medium ${
                          hierarchyDraft.box.labelPreset === p
                            ? 'bg-[var(--bg-accent)] text-[var(--content-on-color)]'
                            : 'bg-[var(--bg-tertiary)] text-[var(--content-secondary)]'
                        }`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                  <input
                    type="text"
                    value={hierarchyDraft.box.labelCustom}
                    onChange={(e) =>
                      setHierarchyDraft((d) => ({
                        ...d,
                        box: { ...d.box, labelCustom: e.target.value },
                      }))
                    }
                    placeholder="Optional override text"
                    className="mt-2 w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--content-primary)]"
                  />
                </div>

                <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3">
                  <input
                    type="checkbox"
                    checked={hierarchyDraft.box.sellThisUnit}
                    onChange={(e) => {
                      const on = e.target.checked;
                      setHierarchyDraft((d) => ({
                        ...d,
                        box: { ...d.box, sellThisUnit: on },
                        packet: { ...d.packet, sellThisUnit: on ? false : d.packet.sellThisUnit },
                      }));
                    }}
                    className="h-5 w-5 accent-[var(--bg-accent)]"
                  />
                  <span className="text-sm font-medium text-[var(--content-primary)]">
                    We sell at <strong>outer / box</strong> unit
                  </span>
                </label>
              </div>
            )}

            {hierarchyStep === 2 && (
              <div className="space-y-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-4">
                <p className="text-sm font-semibold text-[var(--content-primary)]">Inner packet</p>
                <p className="text-xs text-[var(--content-secondary)]">
                  Scan the sleeve or inner multi-pack barcode when present.
                </p>
                <div className="flex flex-wrap gap-2">
                  <BigButton
                    type="button"
                    variant="secondary"
                    className="min-h-12 flex-1"
                    disabled={hierarchyDraft.packet.noLabel}
                    onClick={() => setScannerOpen('packet')}
                  >
                    Scan inner label
                  </BigButton>
                  <BigButton
                    type="button"
                    variant={hierarchyDraft.packet.noLabel ? 'primary' : 'ghost'}
                    className="min-h-12 flex-1"
                    onClick={() =>
                      setHierarchyDraft((d) => ({
                        ...d,
                        packet: { ...d.packet, noLabel: true, scanRaw: null },
                      }))
                    }
                  >
                    No inner barcode
                  </BigButton>
                </div>
                {(tierDisplay?.packet || hierarchyDraft.packet.scanRaw) && !hierarchyDraft.packet.noLabel ? (
                  <p className="font-mono text-sm text-[var(--content-positive)]">
                    Saved key: {tierDisplay?.packet ?? '…'} → packet
                  </p>
                ) : null}
                {hierarchyDraft.packet.noLabel ? (
                  <div className="flex flex-col gap-1">
                    <p className="text-sm text-[var(--content-tertiary)]">Inner tier marked as no barcode.</p>
                    <button
                      type="button"
                      className="text-left text-sm font-medium text-[var(--content-accent)]"
                      onClick={() =>
                        setHierarchyDraft((d) => ({
                          ...d,
                          packet: { ...d.packet, noLabel: false },
                        }))
                      }
                    >
                      Undo — scan a barcode instead
                    </button>
                  </div>
                ) : null}

                <label className="block">
                  <span className="text-xs font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
                    Pieces inside one inner pack
                  </span>
                  <input
                    type="number"
                    min={2}
                    step={1}
                    inputMode="numeric"
                    value={
                      hierarchyDraft.packet.piecesInside === '' ? '' : hierarchyDraft.packet.piecesInside
                    }
                    onChange={(e) => {
                      const v = e.target.value;
                      setHierarchyDraft((d) => ({
                        ...d,
                        packet: {
                          ...d.packet,
                          piecesInside: v === '' ? '' : Number(v),
                        },
                      }));
                    }}
                    className="mt-1 w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-3 text-lg font-semibold tabular-nums text-[var(--content-primary)]"
                    placeholder="e.g. 10"
                  />
                </label>

                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
                    Label for inner pack
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(['Packet', 'Set', 'Strip'] as const).map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() =>
                          setHierarchyDraft((d) => ({
                            ...d,
                            packet: { ...d.packet, labelPreset: p },
                          }))
                        }
                        className={`rounded-full px-3 py-2 text-sm font-medium ${
                          hierarchyDraft.packet.labelPreset === p
                            ? 'bg-[var(--bg-accent)] text-[var(--content-on-color)]'
                            : 'bg-[var(--bg-tertiary)] text-[var(--content-secondary)]'
                        }`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                  <input
                    type="text"
                    value={hierarchyDraft.packet.labelCustom}
                    onChange={(e) =>
                      setHierarchyDraft((d) => ({
                        ...d,
                        packet: { ...d.packet, labelCustom: e.target.value },
                      }))
                    }
                    placeholder="Optional override text"
                    className="mt-2 w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--content-primary)]"
                  />
                </div>

                <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3">
                  <input
                    type="checkbox"
                    checked={hierarchyDraft.packet.sellThisUnit}
                    onChange={(e) => {
                      const on = e.target.checked;
                      setHierarchyDraft((d) => ({
                        ...d,
                        packet: { ...d.packet, sellThisUnit: on },
                        box: { ...d.box, sellThisUnit: on ? false : d.box.sellThisUnit },
                      }));
                    }}
                    className="h-5 w-5 accent-[var(--bg-accent)]"
                  />
                  <span className="text-sm font-medium text-[var(--content-primary)]">
                    We sell at <strong>inner / packet</strong> unit
                  </span>
                </label>
              </div>
            )}

            {hierarchyStep === 3 && (
              <div className="space-y-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-4">
                <p className="text-sm font-semibold text-[var(--content-primary)]">Single piece (optional)</p>
                <p className="text-xs text-[var(--content-secondary)]">
                  Scan a manufacturer barcode on the individual piece when it exists.
                </p>
                <div className="flex flex-wrap gap-2">
                  <BigButton
                    type="button"
                    variant="secondary"
                    className="min-h-12 flex-1"
                    disabled={hierarchyDraft.piece.noLabel}
                    onClick={() => setScannerOpen('piece')}
                  >
                    Scan piece label
                  </BigButton>
                  <BigButton
                    type="button"
                    variant={hierarchyDraft.piece.noLabel ? 'primary' : 'ghost'}
                    className="min-h-12 flex-1"
                    onClick={() =>
                      setHierarchyDraft((d) => ({
                        ...d,
                        piece: { ...d.piece, noLabel: true, scanRaw: null },
                      }))
                    }
                  >
                    No piece barcode
                  </BigButton>
                </div>
                {(tierDisplay?.piece || hierarchyDraft.piece.scanRaw) && !hierarchyDraft.piece.noLabel ? (
                  <p className="font-mono text-sm text-[var(--content-positive)]">
                    Saved key: {tierDisplay?.piece ?? '…'} → piece
                  </p>
                ) : null}
                {hierarchyDraft.piece.noLabel ? (
                  <div className="flex flex-col gap-1">
                    <p className="text-sm text-[var(--content-tertiary)]">Piece tier marked as no barcode.</p>
                    <button
                      type="button"
                      className="text-left text-sm font-medium text-[var(--content-accent)]"
                      onClick={() =>
                        setHierarchyDraft((d) => ({
                          ...d,
                          piece: { ...d.piece, noLabel: false },
                        }))
                      }
                    >
                      Undo — scan a barcode instead
                    </button>
                  </div>
                ) : null}
              </div>
            )}

            {hierarchyStep === 'review' && (
              <div className="space-y-4 rounded-2xl border border-[var(--border-accent)] bg-[var(--bg-accent-subtle)] p-4">
                <p className="text-sm font-semibold text-[var(--content-primary)]">Pack preview</p>
                <div className="flex flex-wrap items-stretch justify-center gap-2 sm:justify-between">
                  {(
                    [
                      {
                        key: 'box',
                        icon: '📦',
                        title: 'Outer',
                        scanned: Boolean(tierDisplay?.box || hierarchyDraft.box.scanRaw),
                        noLbl: hierarchyDraft.box.noLabel,
                        sell: sellingPreview === 'box',
                      },
                      {
                        key: 'packet',
                        icon: '🗂',
                        title: 'Inner',
                        scanned: Boolean(tierDisplay?.packet || hierarchyDraft.packet.scanRaw),
                        noLbl: hierarchyDraft.packet.noLabel,
                        sell: sellingPreview === 'packet',
                      },
                      {
                        key: 'piece',
                        icon: '🔩',
                        title: 'Piece',
                        scanned: Boolean(tierDisplay?.piece || hierarchyDraft.piece.scanRaw),
                        noLbl: hierarchyDraft.piece.noLabel,
                        sell: sellingPreview === 'piece',
                      },
                    ] as const
                  ).map((cell) => (
                    <div
                      key={cell.key}
                      className="flex min-w-[5.5rem] flex-1 flex-col items-center rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2 py-3 text-center"
                    >
                      <span className="text-2xl" aria-hidden>
                        {cell.icon}
                      </span>
                      <span className="mt-1 text-[10px] font-bold uppercase tracking-wide text-[var(--content-tertiary)]">
                        {cell.title}
                      </span>
                      <span className="mt-1 text-xs font-medium text-[var(--content-secondary)]">
                        {cell.noLbl ? 'No barcode' : cell.scanned ? 'QR ✓' : 'No scan'}
                      </span>
                      {cell.sell ? (
                        <span className="mt-1 inline-flex items-center gap-0.5 text-[11px] font-bold uppercase tracking-wide text-[var(--content-accent)]">
                          <Star size={14} weight="fill" className="text-[var(--content-accent)]" aria-hidden />
                          Selling
                        </span>
                      ) : (
                        <span className="mt-1 text-[10px] text-[var(--content-tertiary)]"> </span>
                      )}
                    </div>
                  ))}
                </div>
                <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--content-secondary)]">
                  {derivedPreview ? (
                    <p>
                      <span className="font-semibold text-[var(--content-primary)]">
                        {derivedPreview.piecesPerBox}
                      </span>{' '}
                      pieces per outer · {derivedPreview.packetsPerBox} inner packs ×{' '}
                      {derivedPreview.piecesPerPacket} pieces each
                    </p>
                  ) : (
                    <p className="text-[var(--content-warning)]">
                      Pack math incomplete — go back and fix inner counts.
                    </p>
                  )}
                  <p className="mt-1 text-xs">
                    Outer label:{' '}
                    <span className="font-medium text-[var(--content-primary)]">
                      {formatLayerLabel(hierarchyDraft.box.labelPreset, hierarchyDraft.box.labelCustom)}
                    </span>{' '}
                    · Inner:{' '}
                    <span className="font-medium text-[var(--content-primary)]">
                      {formatLayerLabel(hierarchyDraft.packet.labelPreset, hierarchyDraft.packet.labelCustom)}
                    </span>
                  </p>
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {hierarchyStep !== 'review' ? (
                <>
                  <BigButton
                    type="button"
                    variant="secondary"
                    className="min-h-12"
                    disabled={hierarchyStep === 1}
                    onClick={handleHierarchyBack}
                  >
                    Back
                  </BigButton>
                  <BigButton
                    type="button"
                    variant="primary"
                    className="min-h-12 flex-1 bg-[var(--bg-accent)] text-[var(--content-on-color)]"
                    onClick={handleHierarchyContinue}
                  >
                    Continue
                  </BigButton>
                </>
              ) : (
                <>
                  <BigButton type="button" variant="secondary" className="min-h-12" onClick={handleHierarchyBack}>
                    Back
                  </BigButton>
                  <BigButton
                    type="button"
                    variant="primary"
                    className="min-h-12 flex-1 bg-[var(--bg-positive)] text-[var(--content-on-color)]"
                    disabled={saveSkuMutation.isPending}
                    onClick={handleSaveSku}
                  >
                    Save SKU
                  </BigButton>
                </>
              )}
              <BigButton type="button" variant="ghost" onClick={handleSkipSkuFixed}>
                Skip
              </BigButton>
              <BigButton type="button" variant="ghost" onClick={() => setSelectedBusyCode(null)}>
                Back to bin
              </BigButton>
            </div>

            <div className="border-t border-[var(--border-subtle)] pt-4 space-y-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--content-tertiary)]">
                Move along
              </p>
              {worksheetBinNav && (
                <div className="rounded-2xl border border-[var(--border-accent)] bg-[var(--bg-accent-subtle)] p-3">
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--content-accent)]">
                        Bin queue · {worksheetBinNav.position} / {worksheetBinNav.total}
                      </p>
                      {worksheetBinNav.canAdvance ? (
                        <p className="mt-1 line-clamp-2 text-sm leading-snug text-[var(--content-secondary)]">
                          Next SKU:{' '}
                          <span className="font-mono font-semibold text-[var(--content-primary)]">
                            {skuQuickLabel(worksheetBinNav.nextSku)}
                          </span>
                        </p>
                      ) : (
                        <p className="mt-1 text-sm text-[var(--content-secondary)]">
                          Only SKU loaded for this bin — save or map, then load another bin when done.
                        </p>
                      )}
                    </div>
                    <BigButton
                      type="button"
                      variant="primary"
                      className="shrink-0 min-h-12 min-w-[7.5rem] bg-[var(--bg-accent)] px-4 text-[var(--content-on-color)]"
                      disabled={!worksheetBinNav.canAdvance}
                      onClick={handleNextSkuInBin}
                    >
                      Next
                      <CaretRight size={22} weight="bold" className="ml-1 inline align-middle" aria-hidden />
                    </BigButton>
                  </div>
                  {worksheetBinNav.canAdvance ? (
                    <p className="mt-2 text-xs text-[var(--content-tertiary)]">
                      Next SKU in this bin — wraps from last back to first.
                    </p>
                  ) : null}
                </div>
              )}

              {shelfRowPatternMatched ? (
                <ShelfRowTourStrip
                  variant="compact"
                  payload={shelfRowPayload}
                  loading={shelfRowLoading}
                  currentBinNorm={currentBinNorm}
                  nextShelfBinId={nextShelfBinId}
                  prevShelfBinId={prevShelfBinId}
                  onLoadShelf={handleLoadShelfBin}
                />
              ) : null}
            </div>
          </section>
        )}

        {scannerOpen === 'bin' && (
          <LiveQrScanner
            mode="collect"
            title="Scan bin"
            eyebrow="Bin onboarding"
            helpText="Point at the rack/bin QR code."
            onClose={() => setScannerOpen(null)}
            onResolved={handleBinScanResolved}
            onError={(msg) => toast.error(msg)}
          />
        )}
        {scannerOpen === 'box' && selectedSku && (
          <LiveQrScanner
            mode="collect"
            title="Scan BOX label"
            eyebrow="Outer / carton"
            helpText="Manufacturer barcode on the outer carton."
            onClose={() => setScannerOpen(null)}
            onResolved={(scan) => void handleTierScanResolved(scan, 'box')}
            onError={(msg) => toast.error(msg)}
          />
        )}
        {scannerOpen === 'packet' && selectedSku && (
          <LiveQrScanner
            mode="collect"
            title="Scan PACKET label"
            eyebrow="Inner packet"
            helpText="Barcode on the inner sleeve/packet."
            onClose={() => setScannerOpen(null)}
            onResolved={(scan) => void handleTierScanResolved(scan, 'packet')}
            onError={(msg) => toast.error(msg)}
          />
        )}
        {scannerOpen === 'piece' && selectedSku && (
          <LiveQrScanner
            mode="collect"
            title="Scan PIECE label"
            eyebrow="Optional"
            helpText="Single-unit barcode when applicable."
            onClose={() => setScannerOpen(null)}
            onResolved={(scan) => void handleTierScanResolved(scan, 'piece')}
            onError={(msg) => toast.error(msg)}
          />
        )}
      </div>

      {celebrateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="max-w-sm rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-6 text-center shadow-xl">
            <Sparkle size={40} weight="bold" className="mx-auto text-[var(--content-accent)]" />
            <p className="mt-4 text-xl font-bold text-[var(--content-primary)]">Bin complete!</p>
            <p className="mt-2 text-sm text-[var(--content-secondary)]">
              Every SKU in {currentBinId ?? 'this bin'} has barcode coverage and confirmed UoM.
            </p>
            <BigButton
              type="button"
              variant="primary"
              className="mt-6 w-full"
              onClick={() => setCelebrateOpen(false)}
            >
              Continue
            </BigButton>
            {nextShelfBinId &&
            shelfRowPayload &&
            shelfRowPayload.binIds.length > 1 &&
            nextShelfBinId !== currentBinNorm ? (
              <BigButton
                type="button"
                variant="secondary"
                className="mt-3 w-full border-[var(--border-accent)] bg-[var(--bg-accent-subtle)] text-[var(--content-accent)]"
                onClick={() => handleLoadShelfBin(nextShelfBinId)}
              >
                Next shelf ·{' '}
                <span className="font-mono font-semibold">{nextShelfBinId}</span>
              </BigButton>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
