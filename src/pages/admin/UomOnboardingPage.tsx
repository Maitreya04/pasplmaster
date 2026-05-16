import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CaretLeft, Package, Scales } from '@phosphor-icons/react';
import { BigButton, LiveQrScanner, SearchInput, Skeleton } from '../../components/shared';
import type { LiveQrScannerResolved } from '../../components/shared/LiveQrScanner';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { supabase } from '../../lib/supabase/client';
import { PACK_DEFINITIONS_QUERY_KEY, fetchItemPackDefinitions } from '../../lib/packLpn';
import { classifyScanPayload, parsePackPickPayload } from '../../lib/scanner/qrPayload';
import { fetchUomCoverageGaps, type UomCoverageGapRow } from '../../lib/scanner/uomMapper';
import type { ItemSellingUnit } from '../../types';
import { ITEMS_QUERY_KEY } from '../../hooks/useItems';
import {
  initializeItemScanIndex,
  resolveScannedCatalogItem,
  type ScanCatalogItem,
} from '../../stores/itemScanIndex';

const UOM_COVERAGE_QUERY_KEY = ['uom-coverage-gaps'] as const;

type ScanTierGuess = 'piece' | 'packet' | 'box' | null;

function tierFromScan(scan: LiveQrScannerResolved | null): ScanTierGuess {
  if (!scan) return null;
  if (scan.codeType === 'pack') {
    const p = parsePackPickPayload(scan.rawValue);
    return p?.packType === 'inner' ? 'packet' : 'box';
  }
  return scan.uomTier;
}

export default function UomOnboardingPage(): ReactElement {
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { userId } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const [scannerOpen, setScannerOpen] = useState(false);
  const [lastScan, setLastScan] = useState<LiveQrScannerResolved | null>(null);
  const [resolvedItem, setResolvedItem] = useState<ScanCatalogItem | null>(null);

  const [innerEaStr, setInnerEaStr] = useState('');
  const [outerEaStr, setOuterEaStr] = useState('');
  const [packetLabel, setPacketLabel] = useState('');
  const [boxLabel, setBoxLabel] = useState('');
  const [sellingUnit, setSellingUnit] = useState<ItemSellingUnit>('piece');
  const [saveBarcodeTier, setSaveBarcodeTier] = useState(false);
  const [barcodeTier, setBarcodeTier] = useState<ItemSellingUnit>('piece');

  const [coverageQuery, setCoverageQuery] = useState('');

  useEffect(() => {
    void initializeItemScanIndex().catch(() => {
      toast.error('Could not load scan index. Refresh and try again.');
    });
  }, [toast]);

  const { data: packDefinitions = [], isLoading: packDefsLoading } = useQuery({
    queryKey: PACK_DEFINITIONS_QUERY_KEY,
    queryFn: fetchItemPackDefinitions,
  });

  const packDefinitionByBusyCode = useMemo(() => {
    const map = new Map<number, (typeof packDefinitions)[0]>();
    for (const def of packDefinitions) map.set(Number(def.busy_code), def);
    return map;
  }, [packDefinitions]);

  const {
    data: coverageRows = [],
    isLoading: coverageLoading,
    refetch: refetchCoverage,
  } = useQuery({
    queryKey: UOM_COVERAGE_QUERY_KEY,
    queryFn: () => fetchUomCoverageGaps(800),
  });

  const filteredCoverage = useMemo(() => {
    const q = coverageQuery.trim().toLowerCase();
    if (!q) return coverageRows;
    return coverageRows.filter(
      (row) =>
        String(row.busy_code).includes(q) ||
        row.item_name.toLowerCase().includes(q) ||
        String(row.item_id).includes(q),
    );
  }, [coverageRows, coverageQuery]);

  const preBusyParam = searchParams.get('busy_code');

  useEffect(() => {
    if (!preBusyParam) return;
    const n = Number(preBusyParam);
    if (!Number.isFinite(n)) return;
    const def = packDefinitionByBusyCode.get(n);
    setInnerEaStr(def?.inner_pack_qty != null ? String(def.inner_pack_qty) : '');
    setOuterEaStr(def?.outer_pack_qty != null ? String(def.outer_pack_qty) : '');
    setPacketLabel(def?.packet_label ?? '');
    setBoxLabel(def?.box_label ?? '');
  }, [preBusyParam, packDefinitionByBusyCode]);

  const openCoverageRow = useCallback(
    (row: UomCoverageGapRow) => {
      setSearchParams({ busy_code: String(row.busy_code) });
      setResolvedItem(null);
      setLastScan(null);
      const def = packDefinitionByBusyCode.get(row.busy_code);
      setInnerEaStr(def?.inner_pack_qty != null ? String(def.inner_pack_qty) : '');
      setOuterEaStr(def?.outer_pack_qty != null ? String(def.outer_pack_qty) : '');
      setPacketLabel(def?.packet_label ?? '');
      setBoxLabel(def?.box_label ?? '');
      setSellingUnit('piece');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    [packDefinitionByBusyCode, setSearchParams],
  );

  const handleScanResolved = useCallback(
    (scan: LiveQrScannerResolved) => {
      const classified = classifyScanPayload(scan.rawValue);
      if (classified.kind === 'rack') {
        toast.warning('Scan a product QR/barcode, not a rack label.');
        return;
      }

      const lookup = resolveScannedCatalogItem(scan.rawValue);
      const item = lookup?.item ?? scan.matchedItem;
      if (!item?.busy_code) {
        toast.error('No catalog item matched this scan (needs Busy code). Map barcode first or scan alias.');
        setLastScan(scan);
        setResolvedItem(null);
        return;
      }

      setLastScan(scan);
      setResolvedItem(item);

      const bc = Number(item.busy_code);
      const def = packDefinitionByBusyCode.get(bc);
      setInnerEaStr(def?.inner_pack_qty != null ? String(def.inner_pack_qty) : '');
      setOuterEaStr(def?.outer_pack_qty != null ? String(def.outer_pack_qty) : '');
      setPacketLabel(def?.packet_label ?? '');
      setBoxLabel(def?.box_label ?? '');

      const su = item.selling_unit;
      if (su === 'packet' || su === 'box' || su === 'piece') {
        setSellingUnit(su);
      }

      const guess = tierFromScan(scan);
      if (guess === 'packet' || guess === 'box') {
        setSaveBarcodeTier(false);
        setBarcodeTier('piece');
      } else {
        setBarcodeTier('piece');
      }

      setScannerOpen(false);
      toast.success(`Linked scan to ${item.name}.`);
    },
    [packDefinitionByBusyCode, toast],
  );

  const busyCodeForSave = resolvedItem?.busy_code ?? (preBusyParam ? Number(preBusyParam) : null);

  const packetsPerBoxPreview = useMemo(() => {
    const inner = Number(innerEaStr);
    const outer = Number(outerEaStr);
    if (!Number.isFinite(inner) || inner < 2 || !Number.isFinite(outer) || outer < 2) return null;
    if (outer % inner !== 0) return null;
    return outer / inner;
  }, [innerEaStr, outerEaStr]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (busyCodeForSave == null || !Number.isFinite(Number(busyCodeForSave))) {
        throw new Error('Scan a label first or pick a row from coverage.');
      }

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

      const tierGuess = tierFromScan(lastScan);
      const shouldAttachBarcode =
        saveBarcodeTier && lastScan?.rawValue?.trim() && tierGuess !== 'packet' && tierGuess !== 'box';

      const { data, error } = await supabase.rpc('upsert_uom_definition', {
        p_busy_code: Number(busyCodeForSave),
        p_inner_pack_qty: innerN != null && Number.isFinite(innerN) ? Math.floor(innerN) : null,
        p_outer_pack_qty: outerN != null && Number.isFinite(outerN) ? Math.floor(outerN) : null,
        p_packet_label: packetLabel.trim() || null,
        p_box_label: boxLabel.trim() || null,
        p_selling_unit: sellingUnit,
        p_barcode_raw: shouldAttachBarcode ? lastScan!.rawValue.trim() : null,
        p_barcode_tier: shouldAttachBarcode ? barcodeTier : null,
        p_user_id: userId,
      });

      if (error) throw error;
      const payload = data as { success?: boolean; reason?: string };
      if (!payload?.success) {
        throw new Error(payload?.reason ?? 'save_failed');
      }
    },
    onSuccess: () => {
      toast.success('UoM mapping saved.');
      void queryClient.invalidateQueries({ queryKey: PACK_DEFINITIONS_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: ITEMS_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: UOM_COVERAGE_QUERY_KEY });
      void refetchCoverage();
    },
    onError: (e: Error) => {
      toast.error(e.message || 'Could not save.');
    },
  });

  const scanTierGuess = tierFromScan(lastScan);

  return (
    <div className="role-admin min-h-screen bg-[var(--bg-primary)] pb-10">
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
            <h1 className="text-2xl font-bold text-[var(--content-primary)]">UoM onboarding</h1>
            <p className="text-sm text-[var(--content-tertiary)]">
              Scan once per SKU hierarchy (Busy / SAP). Confirms pack sizes for fast picking.
            </p>
          </div>
        </div>

        <section className="mt-6 space-y-4 rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--bg-accent-subtle)]">
              <Scales size={22} className="text-[var(--content-accent)]" weight="bold" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-[var(--content-primary)]">1. Scan any label on the SKU</p>
              <p className="mt-1 text-sm text-[var(--content-tertiary)]">
                Outer box, inner packet, or OEM barcode — we resolve the Busy code and optional QR tier.
              </p>
              <BigButton
                type="button"
                variant="primary"
                className="mt-3 w-full bg-[var(--bg-accent)] text-[var(--content-on-color)]"
                onClick={() => setScannerOpen(true)}
              >
                Open scanner
              </BigButton>
            </div>
          </div>

          {resolvedItem && (
            <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
                Resolved SKU
              </p>
              <p className="mt-1 font-semibold text-[var(--content-primary)]">{resolvedItem.name}</p>
              <p className="mt-1 font-mono text-sm text-[var(--content-secondary)]">
                Busy {resolvedItem.busy_code}
              </p>
              {lastScan && (
                <p className="mt-2 text-xs text-[var(--content-tertiary)]">
                  Last scan tier hint:{' '}
                  <span className="font-medium text-[var(--content-secondary)]">
                    {scanTierGuess ?? lastScan.uomTier ?? 'piece'}
                  </span>{' '}
                  · base EA {lastScan.baseQtyEa ?? '—'}
                </p>
              )}
            </div>
          )}

          {!resolvedItem && preBusyParam && Number.isFinite(Number(preBusyParam)) && (
            <p className="text-sm text-[var(--content-warning)]">
              Coverage row selected (Busy {preBusyParam}). Scan a label to attach context, or fill quantities
              below from the datasheet.
            </p>
          )}

          <div className="space-y-3">
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
                Pieces per packet (inner)
              </span>
              <input
                type="number"
                min={2}
                value={innerEaStr}
                onChange={(e) => setInnerEaStr(e.target.value)}
                placeholder="e.g. 2"
                className="mt-1 w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-4 py-3 text-[var(--content-primary)]"
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
                Pieces per box (outer)
              </span>
              <input
                type="number"
                min={2}
                value={outerEaStr}
                onChange={(e) => setOuterEaStr(e.target.value)}
                placeholder="e.g. 30"
                className="mt-1 w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-4 py-3 text-[var(--content-primary)]"
              />
            </label>
            {packetsPerBoxPreview != null && (
              <p className="text-sm text-[var(--content-secondary)]">
                ≈ <strong>{packetsPerBoxPreview}</strong> packets per box (auto)
              </p>
            )}

            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
                Packet label (optional)
              </span>
              <input
                type="text"
                value={packetLabel}
                onChange={(e) => setPacketLabel(e.target.value)}
                placeholder="Packet"
                className="mt-1 w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-4 py-3 text-[var(--content-primary)]"
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
                Box label (optional)
              </span>
              <input
                type="text"
                value={boxLabel}
                onChange={(e) => setBoxLabel(e.target.value)}
                placeholder="Box"
                className="mt-1 w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-4 py-3 text-[var(--content-primary)]"
              />
            </label>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
                Selling unit (display)
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {(['piece', 'packet', 'box'] as const).map((u) => (
                  <button
                    key={u}
                    type="button"
                    onClick={() => setSellingUnit(u)}
                    className={`rounded-full px-4 py-2 text-sm font-semibold capitalize transition-colors ${
                      sellingUnit === u
                        ? 'bg-[var(--content-primary)] text-[var(--bg-primary)]'
                        : 'border border-[var(--border-subtle)] text-[var(--content-secondary)]'
                    }`}
                  >
                    {u}
                  </button>
                ))}
              </div>
            </div>

            {lastScan?.rawValue && scanTierGuess !== 'packet' && scanTierGuess !== 'box' && (
              <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-3">
                <input
                  type="checkbox"
                  checked={saveBarcodeTier}
                  onChange={(e) => setSaveBarcodeTier(e.target.checked)}
                  className="mt-1"
                />
                <span className="text-sm text-[var(--content-secondary)]">
                  Remember this scan payload as a tier override for mapping (
                  <span className="font-mono text-xs">{lastScan.rawValue.slice(0, 48)}</span>
                  …)
                </span>
              </label>
            )}
            {saveBarcodeTier && (
              <div>
                <p className="text-xs font-semibold text-[var(--content-tertiary)]">Barcode tier</p>
                <select
                  value={barcodeTier}
                  onChange={(e) => setBarcodeTier(e.target.value as ItemSellingUnit)}
                  className="mt-1 w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-4 py-3 text-[var(--content-primary)]"
                >
                  <option value="piece">Piece</option>
                  <option value="packet">Packet</option>
                  <option value="box">Box</option>
                </select>
              </div>
            )}

            <BigButton
              type="button"
              variant="primary"
              loading={saveMutation.isPending}
              disabled={busyCodeForSave == null}
              className="w-full bg-[var(--bg-positive)] text-[var(--content-on-color)]"
              onClick={() => saveMutation.mutate()}
            >
              Save UoM mapping
            </BigButton>
          </div>
        </section>

        <section className="mt-8 space-y-3">
          <div className="flex items-center gap-2">
            <Package size={22} className="text-[var(--content-accent)]" weight="bold" />
            <h2 className="text-lg font-bold text-[var(--content-primary)]">Coverage gaps</h2>
          </div>
          <p className="text-sm text-[var(--content-tertiary)]">
            Busy SKUs without a supervisor-confirmed UoM mapping. Tap a row to pre-fill Busy code.
          </p>
          <SearchInput
            value={coverageQuery}
            onChange={setCoverageQuery}
            placeholder="Filter by Busy code or name…"
            autoFocus={false}
          />
          {coverageLoading || packDefsLoading ? (
            <Skeleton className="h-40 w-full rounded-3xl" />
          ) : filteredCoverage.length === 0 ? (
            <p className="text-sm text-[var(--content-positive)]">All sampled SKUs are confirmed — nice.</p>
          ) : (
            <ul className="space-y-2">
              {filteredCoverage.slice(0, 60).map((row) => (
                <li key={`${row.busy_code}-${row.item_id}`}>
                  <button
                    type="button"
                    onClick={() => openCoverageRow(row)}
                    className={`flex w-full flex-col gap-1 rounded-2xl border px-4 py-3 text-left transition-colors ${
                      preBusyParam === String(row.busy_code)
                        ? 'border-[var(--content-accent)] bg-[var(--bg-accent-subtle)]'
                        : 'border-[var(--border-subtle)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)]'
                    }`}
                  >
                    <span className="font-semibold text-[var(--content-primary)]">{row.item_name}</span>
                    <span className="flex flex-wrap gap-2 font-mono text-xs text-[var(--content-tertiary)]">
                      <span>Busy {row.busy_code}</span>
                      {row.inner_pack_qty != null && <span>inner {row.inner_pack_qty}</span>}
                      {row.outer_pack_qty != null && <span>outer {row.outer_pack_qty}</span>}
                      {!row.confirmed_at && (
                        <span className="text-[var(--content-warning)]">unconfirmed</span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {scannerOpen && (
        <LiveQrScanner
          mode="collect"
          title="Scan SKU label"
          eyebrow="UoM onboarding"
          helpText="Point at OEM QR, pack label, or alias barcode."
          idleStatus="Align code in frame"
          onClose={() => setScannerOpen(false)}
          onResolved={handleScanResolved}
          onError={(msg) => toast.error(msg)}
        />
      )}
    </div>
  );
}
