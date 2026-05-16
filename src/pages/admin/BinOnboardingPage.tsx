import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Barcode,
  CaretLeft,
  CheckCircle,
  Package,
  Scales,
  Sparkle,
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
  loadSkuOptionsFromBin,
  normalizeBinCode,
  type BarcodeSkuOption,
  type SaveBarcodeMappingResult,
} from '../../lib/barcodeMapping';
import { classifyScanPayload, parseRackPayload } from '../../lib/scanner/qrPayload';
import { parseManufacturerBarcode } from '../../lib/scanner/barcodeParser';
import { fetchUomCoverageGaps, registerBarcodeWithTier, type UomTier } from '../../lib/scanner/uomMapper';
import { PACK_DEFINITIONS_QUERY_KEY } from '../../lib/packLpn';
import { ITEMS_QUERY_KEY, useItems } from '../../hooks/useItems';
import type { ItemPackDefinition, ItemSellingUnit } from '../../types';
import { initializeItemScanIndex } from '../../stores/itemScanIndex';

const MAPPED_SKUS_KEY = ['mapped-sku-summaries'] as const;
const BARCODE_COV_KEY = ['barcode-coverage-global'] as const;
const UOM_GAPS_KEY = ['uom-coverage-gaps-bin-wizard'] as const;

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

  const [innerEaStr, setInnerEaStr] = useState('');
  const [outerEaStr, setOuterEaStr] = useState('');
  const [packetLabel, setPacketLabel] = useState('');
  const [boxLabel, setBoxLabel] = useState('');
  const [sellingUnit, setSellingUnit] = useState<ItemSellingUnit>('piece');

  const [tierConflict, setTierConflict] = useState<{
    tier: UomTier;
    raw: string;
    result: SaveBarcodeMappingResult;
  } | null>(null);

  const [sessionTierLabels, setSessionTierLabels] = useState<
    Record<number, SessionTierLabels>
  >({});

  const [pieceSkippedByBusy, setPieceSkippedByBusy] = useState<Record<number, boolean>>({});

  const [sessionStats, setSessionStats] = useState({
    skusFullyOnboarded: 0,
    barcodesAdded: 0,
    uomConfirmed: 0,
    skipped: 0,
  });

  const [celebrateOpen, setCelebrateOpen] = useState(false);
  const prevBinCompleteRef = useRef(false);

  useEffect(() => {
    void initializeItemScanIndex().catch(() => {
      toast.error('Could not load scan index. Refresh and try again.');
    });
  }, [toast]);

  const busyCodesInBin = useMemo(
    () => skuOptions.map((o) => o.skuBusyCode).filter((c) => Number.isFinite(c)),
    [skuOptions],
  );

  const {
    data: packDefMap = new Map<number, ItemPackDefinition>(),
    isLoading: packDefsLoading,
  } = useQuery({
    queryKey: ['bin-pack-defs', currentBinId, busyCodesInBin.slice().sort().join(',')],
    queryFn: () => fetchPackDefsForBusyCodes(busyCodesInBin),
    enabled: busyCodesInBin.length > 0,
  });

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

      if (tier === 'piece') {
        setPieceSkippedByBusy((p) => ({ ...p, [selectedSku.skuBusyCode]: false }));
      }

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

    if (tier === 'piece') {
      setPieceSkippedByBusy((p) => ({ ...p, [selectedSku.skuBusyCode]: false }));
    }

    void queryClient.invalidateQueries({ queryKey: MAPPED_SKUS_KEY });
    toast.success(`${tier} label forced for this SKU (${displayKey}).`);
  }, [tierConflict, selectedSku, manufacturer, userId, userName, toast, queryClient]);

  const packetsPerBoxPreview = useMemo(() => {
    const inner = Number(innerEaStr);
    const outer = Number(outerEaStr);
    if (!Number.isFinite(inner) || inner < 2 || !Number.isFinite(outer) || outer < 2) return null;
    if (outer % inner !== 0) return null;
    return outer / inner;
  }, [innerEaStr, outerEaStr]);

  const outerInnerMismatch = useMemo(() => {
    const inner = Number(innerEaStr);
    const outer = Number(outerEaStr);
    if (!Number.isFinite(inner) || inner < 2 || !Number.isFinite(outer) || outer < 2) return false;
    return outer % inner !== 0;
  }, [innerEaStr, outerEaStr]);

  useEffect(() => {
    if (!selectedSku) return;
    const bc = selectedSku.skuBusyCode;
    const def = packDefMap.get(bc);
    setInnerEaStr(def?.inner_pack_qty != null ? String(def.inner_pack_qty) : '');
    setOuterEaStr(def?.outer_pack_qty != null ? String(def.outer_pack_qty) : '');
    setPacketLabel(def?.packet_label ?? '');
    setBoxLabel(def?.box_label ?? '');
    const itemRow = items.find((i) => Number(i.busy_code) === bc);
    const su = itemRow?.selling_unit;
    if (su === 'packet' || su === 'box' || su === 'piece') {
      setSellingUnit(su);
    } else {
      setSellingUnit('piece');
    }
  }, [selectedSku, packDefMap, items]);

  const saveSkuMutation = useMutation({
    mutationFn: async () => {
      if (!selectedSku) throw new Error('Pick a SKU first.');

      const innerN = innerEaStr.trim() === '' ? null : Number(innerEaStr);
      const outerN = outerEaStr.trim() === '' ? null : Number(outerEaStr);

      if (innerN != null && (!Number.isFinite(innerN) || innerN <= 1)) {
        throw new Error('Pieces per packet must be blank or an integer > 1.');
      }
      if (outerN != null && (!Number.isFinite(outerN) || outerN <= 1)) {
        throw new Error('Pieces per box must be blank or an integer > 1.');
      }

      if (
        (innerN == null || !Number.isFinite(innerN)) &&
        (outerN == null || !Number.isFinite(outerN))
      ) {
        throw new Error('Enter at least pieces-per-packet or pieces-per-box.');
      }

      if (sellingUnit !== 'piece' && innerN == null) {
        throw new Error('Selling in packets/boxes requires pieces-per-packet.');
      }

      const bc = selectedSku.skuBusyCode;
      const hadBarcodeAtSaveStart = mappedSkuSet.has(bc);
      const wasConfirmed = Boolean(packDefMap.get(bc)?.confirmed_at);

      const { data, error } = await supabase.rpc('upsert_uom_definition', {
        p_busy_code: bc,
        p_inner_pack_qty: innerN != null && Number.isFinite(innerN) ? Math.floor(innerN) : null,
        p_outer_pack_qty: outerN != null && Number.isFinite(outerN) ? Math.floor(outerN) : null,
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
    },
    onError: (e: Error) => toast.error(e.message || 'Could not save.'),
  });

  const handleSaveSku = useCallback(() => {
    saveSkuMutation.mutate();
  }, [saveSkuMutation]);

  const handleSkipSkuFixed = useCallback(() => {
    if (!selectedSku) return;
    setSessionStats((s) => ({ ...s, skipped: s.skipped + 1 }));
    const next = nextIncompleteBusyCode(selectedSku.skuBusyCode);
    setSelectedBusyCode(next);
    setTierConflict(null);
    toast.warning('Skipped — remember to come back to this SKU.');
  }, [selectedSku, nextIncompleteBusyCode, toast]);

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

  function tierSlots(tier: UomTier, label: string, optional?: boolean): ReactElement {
    if (!selectedSku) return <></>;
    const bc = selectedSku.skuBusyCode;
    const saved =
      tier === 'box'
        ? sessionTierLabels[bc]?.box
        : tier === 'packet'
          ? sessionTierLabels[bc]?.packet
          : sessionTierLabels[bc]?.piece;

    const skippedPiece = tier === 'piece' && pieceSkippedByBusy[bc];

    return (
      <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
          {label}
          {optional ? ' (optional)' : ''}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <BigButton
            type="button"
            variant="secondary"
            className="min-h-11 shrink-0"
            disabled={skippedPiece}
            onClick={() => setScannerOpen(tier === 'box' ? 'box' : tier === 'packet' ? 'packet' : 'piece')}
          >
            Scan label
          </BigButton>
          {optional && (
            <BigButton
              type="button"
              variant="ghost"
              className="min-h-11"
              onClick={() => {
                setPieceSkippedByBusy((p) => ({ ...p, [bc]: true }));
                setSessionTierLabels((prev) => {
                  const next = { ...prev };
                  const row = { ...(next[bc] ?? {}) };
                  delete row.piece;
                  next[bc] = row;
                  return next;
                });
              }}
            >
              No piece label
            </BigButton>
          )}
        </div>
        {saved && (
          <p className="mt-2 font-mono text-sm text-[var(--content-positive)]">
            Saved: {saved} → {tier}
          </p>
        )}
        {skippedPiece && (
          <p className="mt-2 text-sm text-[var(--content-tertiary)]">Piece scan skipped for this SKU.</p>
        )}
      </div>
    );
  }

  const barcodePct = barcodeCoverage?.coverage_pct ?? null;

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
                Loads every SKU in this bin from inventory / rack.
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
        </section>

        {skuOptions.length > 0 && !worksheetOpen && (
          <section className="mt-6 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
              Pick SKU
            </p>
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
                        <p className="font-semibold text-[var(--content-primary)]">{o.itemName}</p>
                        <p className="mt-0.5 font-mono text-sm text-[var(--content-secondary)]">
                          Busy {o.skuBusyCode}
                        </p>
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
                <p className="mt-1 text-lg font-bold text-[var(--content-primary)]">
                  {selectedSku.itemName}
                </p>
                <p className="font-mono text-sm text-[var(--content-secondary)]">
                  Busy {selectedSku.skuBusyCode}
                </p>
              </div>
              <button
                type="button"
                className="text-sm font-medium text-[var(--content-accent)]"
                onClick={() => setSelectedBusyCode(null)}
              >
                Back to list
              </button>
            </div>

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

            <div className="grid gap-3">
              {tierSlots('box', '1. BOX label (outer)')}
              {tierSlots('packet', '2. PACKET label (inner)')}
              {tierSlots('piece', '3. PIECE label', true)}
            </div>

            <div className="space-y-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-3">
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
                  Pieces per packet
                </span>
                <input
                  type="number"
                  min={2}
                  value={innerEaStr}
                  onChange={(e) => setInnerEaStr(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 text-[var(--content-primary)]"
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
                  Pieces per box
                </span>
                <input
                  type="number"
                  min={2}
                  value={outerEaStr}
                  onChange={(e) => setOuterEaStr(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 text-[var(--content-primary)]"
                />
              </label>
              {outerInnerMismatch && (
                <p className="text-sm font-medium text-[var(--content-warning)]">
                  Outer is not a multiple of inner — double-check pack quantities.
                </p>
              )}
              {packetsPerBoxPreview != null && (
                <p className="text-sm text-[var(--content-secondary)]">
                  → {packetsPerBoxPreview} packets per box
                </p>
              )}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
                  Selling unit
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(['piece', 'packet', 'box'] as const).map((u) => (
                    <button
                      key={u}
                      type="button"
                      onClick={() => setSellingUnit(u)}
                      className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                        sellingUnit === u
                          ? 'bg-[var(--bg-accent)] text-[var(--content-on-color)]'
                          : 'bg-[var(--bg-tertiary)] text-[var(--content-secondary)]'
                      }`}
                    >
                      {u === 'piece' ? 'Piece' : u === 'packet' ? 'Packet' : 'Box'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <BigButton
                type="button"
                variant="primary"
                className="flex-1 bg-[var(--bg-positive)] text-[var(--content-on-color)]"
                disabled={saveSkuMutation.isPending}
                onClick={handleSaveSku}
              >
                Save SKU
              </BigButton>
              <BigButton type="button" variant="ghost" onClick={handleSkipSkuFixed}>
                Skip
              </BigButton>
              <BigButton type="button" variant="secondary" onClick={() => setSelectedBusyCode(null)}>
                Back to bin
              </BigButton>
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
          </div>
        </div>
      )}
    </div>
  );
}
