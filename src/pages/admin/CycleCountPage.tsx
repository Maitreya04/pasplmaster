import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeftIcon,
  ArrowsClockwiseIcon,
  BarcodeIcon,
  CameraIcon,
  CheckCircleIcon,
  DatabaseIcon,
  SealWarningIcon,
  XCircleIcon,
} from '@phosphor-icons/react';
import { LiveQrScanner } from '../../components/shared';
import type { LiveQrScannerResolved } from '../../components/shared/LiveQrScanner';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useItems } from '../../hooks/useItems';
import {
  classifyScanPayload,
  parseLpnPickPayload,
  parsePackPickPayload,
  parseRackPayload,
} from '../../lib/scanner/qrPayload';
import {
  fetchItemPackDefinitions,
  PACK_DEFINITIONS_QUERY_KEY,
} from '../../lib/packLpn';
import {
  BIN_INVENTORY_QUERY_KEY,
  PENDING_BIN_COUNTS_QUERY_KEY,
  bulkImportBinInventory,
  fetchBinInventory,
  fetchPendingBinCounts,
  reviewBinCount,
  seedBinInventoryFromItems,
  submitBinCount,
  type BulkBinImportRow,
} from '../../lib/wms';
import type { BinCountLog, BinInventory, Item, ItemPackDefinition } from '../../types';

type CountForm = {
  binId: string;
  skuBusyCode: string;
  innerPacks: string;
  looseEaQty: string;
  innerPackQty: string;
  dailyTarget: string;
  reorderPoint: string;
  note: string;
};

type CountScanTone = 'positive' | 'warning' | 'negative' | 'neutral';

type CountScanEvent = {
  id: string;
  label: string;
  detail: string;
  rawValue: string;
  tone: CountScanTone;
  deltaInnerPacks: number;
  deltaLooseEaQty: number;
};

type BinSlotMatchKind = 'payload' | 'single_existing' | 'current_existing' | 'none' | 'ambiguous';

type ResolvedBinSlot = {
  binId: string;
  skuBusyCode: number | null;
  bin: BinInventory | null;
  candidates: BinInventory[];
  matchKind: BinSlotMatchKind;
};

const EMPTY_FORM: CountForm = {
  binId: '',
  skuBusyCode: '',
  innerPacks: '0',
  looseEaQty: '0',
  innerPackQty: '25',
  dailyTarget: '',
  reorderPoint: '',
  note: '',
};

function formatCount(value: number | null | undefined): string {
  return Number(value ?? 0).toLocaleString('en-IN');
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return 'Never';
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function normalizeBinInput(value: string): string {
  const parsed = parseRackPayload(value);
  if (parsed?.rackCode) return parsed.rackCode;
  return value.trim().toUpperCase().replace(/\s+/g, '');
}

function parseBinSlotInput(value: string): { binId: string; skuBusyCode: string | null } {
  const binId = normalizeBinInput(value);
  try {
    const parsed = JSON.parse(value.trim()) as Record<string, unknown>;
    const rawBusyCode = parsed.busy_code ?? parsed.busyCode ?? null;
    const skuBusyCode =
      typeof rawBusyCode === 'number'
        ? String(rawBusyCode)
        : typeof rawBusyCode === 'string' && rawBusyCode.trim()
          ? rawBusyCode.trim()
          : null;
    return { binId, skuBusyCode };
  } catch {
    return { binId, skuBusyCode: null };
  }
}

function parseOptionalInt(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : null;
}

function parseRequiredInt(value: string, fallback = 0): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.floor(parsed));
}

function parseRequiredNumber(value: string): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function splitDelimitedLine(line: string): string[] {
  if (line.includes('\t')) return line.split('\t').map((cell) => cell.trim());
  return line.split(',').map((cell) => cell.trim().replace(/^"|"$/g, ''));
}

function parseBulkRows(text: string): BulkBinImportRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];

  const headers = splitDelimitedLine(lines[0]).map((header) => header.toLowerCase());
  const rows: BulkBinImportRow[] = [];

  for (const line of lines.slice(1)) {
    const cells = splitDelimitedLine(line);
    const value = (key: string) => cells[headers.indexOf(key)] ?? '';
    const binId = normalizeBinInput(value('bin_id') || value('rack_no'));
    const busyCode = Number(value('sku_busy_code') || value('busy_code'));
    if (!binId || !Number.isFinite(busyCode)) continue;

    rows.push({
      bin_id: binId,
      sku_busy_code: busyCode,
      inner_packs: parseRequiredInt(value('inner_packs')),
      loose_ea_qty: parseRequiredInt(value('loose_ea_qty')),
      inner_pack_qty: parseRequiredInt(value('inner_pack_qty'), 25) || 25,
      daily_target: parseOptionalInt(value('daily_target')),
      reorder_point: parseOptionalInt(value('reorder_point')),
    });
  }

  return rows;
}

function itemLabel(item: Item): string {
  const code = item.busy_code == null ? 'No Busy code' : `Busy ${item.busy_code}`;
  return `${code} - ${item.alias1 ?? item.alias ?? item.name}`;
}

function binSkuKey(binId: string, skuBusyCode: string | number | null | undefined): string {
  return `${normalizeBinInput(binId)}::${skuBusyCode ?? ''}`;
}

function describeBinCandidate(bin: BinInventory): string {
  return `${bin.item_name_snapshot ?? `Busy ${bin.sku_busy_code}`} (Busy ${bin.sku_busy_code})`;
}

function statusClass(status: BinInventory['status']): string {
  if (status === 'healthy') return 'bg-[var(--bg-positive-subtle)] text-[var(--content-positive)]';
  if (status === 'pending_review') return 'bg-[var(--bg-warning-subtle)] text-[var(--content-warning)]';
  if (status === 'empty') return 'bg-[var(--bg-negative-subtle)] text-[var(--content-negative)]';
  if (status === 'low') return 'bg-[var(--bg-warning-subtle)] text-[var(--content-warning)]';
  return 'bg-[var(--bg-tertiary)] text-[var(--content-tertiary)]';
}

function scanToneClass(tone: CountScanTone): string {
  if (tone === 'positive') return 'bg-[var(--bg-positive-subtle)] text-[var(--content-positive)]';
  if (tone === 'warning') return 'bg-[var(--bg-warning-subtle)] text-[var(--content-warning)]';
  if (tone === 'negative') return 'bg-[var(--bg-negative-subtle)] text-[var(--content-negative)]';
  return 'bg-[var(--bg-tertiary)] text-[var(--content-tertiary)]';
}

function packQuantityForType(
  definition: ItemPackDefinition | null | undefined,
  packType: 'inner' | 'outer',
): number | null {
  return packType === 'inner'
    ? definition?.inner_pack_qty ?? null
    : definition?.outer_pack_qty ?? null;
}

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--content-tertiary)]">
        {label}
      </p>
      <p className="mt-2 text-2xl font-bold text-[var(--content-primary)] tabular-nums">{value}</p>
      <p className="mt-1 text-sm text-[var(--content-secondary)]">{hint}</p>
    </div>
  );
}

function PendingCountRow({
  log,
  onReview,
  busyLabel,
  disabled,
}: {
  log: BinCountLog;
  onReview: (logId: number, approved: boolean) => void;
  busyLabel: string;
  disabled: boolean;
}) {
  return (
    <li className="grid gap-3 border-b border-[var(--border-subtle)] px-4 py-3 last:border-b-0 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)_minmax(0,1fr)_auto] lg:items-center">
      <div className="min-w-0">
        <p className="font-mono text-sm font-bold text-[var(--content-primary)]">{log.bin_id}</p>
        <p className="text-xs text-[var(--content-tertiary)]">{formatDateTime(log.created_at)}</p>
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-[var(--content-primary)]">
          {log.item_name_snapshot ?? busyLabel}
        </p>
        <p className="text-xs text-[var(--content-tertiary)]">Busy {log.sku_busy_code}</p>
      </div>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-xl bg-[var(--bg-primary)] px-3 py-2">
          <p className="text-xs text-[var(--content-tertiary)]">Expected</p>
          <p className="font-semibold text-[var(--content-primary)]">
            {formatCount(log.expected_inner_packs)} inner, {formatCount(log.expected_loose_ea_qty)} loose
          </p>
        </div>
        <div className="rounded-xl bg-[var(--bg-warning-subtle)] px-3 py-2">
          <p className="text-xs text-[var(--content-warning)]">Counted</p>
          <p className="font-semibold text-[var(--content-primary)]">
            {formatCount(log.counted_inner_packs)} inner, {formatCount(log.counted_loose_ea_qty)} loose
          </p>
        </div>
      </div>
      <div className="flex gap-2 lg:justify-end">
        <button
          type="button"
          onClick={() => onReview(log.id, false)}
          disabled={disabled}
          className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-[var(--border-subtle)] px-3 text-sm font-semibold text-[var(--content-negative)] disabled:opacity-50"
        >
          <XCircleIcon size={18} weight="bold" />
          Reject
        </button>
        <button
          type="button"
          onClick={() => onReview(log.id, true)}
          disabled={disabled}
          className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[var(--bg-positive)] px-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          <CheckCircleIcon size={18} weight="bold" />
          Approve
        </button>
      </div>
    </li>
  );
}

export default function CycleCountPage(): React.JSX.Element {
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { userId, userName } = useAuth();
  const { data: items = [] } = useItems();
  const [form, setForm] = useState<CountForm>(EMPTY_FORM);
  const [skuSearch, setSkuSearch] = useState('');
  const [bulkText, setBulkText] = useState('');
  const [seedPackQty, setSeedPackQty] = useState('25');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanEvents, setScanEvents] = useState<CountScanEvent[]>([]);

  const { data: bins = [], isLoading: binsLoading, refetch: refetchBins } = useQuery({
    queryKey: BIN_INVENTORY_QUERY_KEY,
    queryFn: fetchBinInventory,
  });

  const { data: pendingCounts = [], isLoading: pendingLoading } = useQuery({
    queryKey: PENDING_BIN_COUNTS_QUERY_KEY,
    queryFn: fetchPendingBinCounts,
  });

  const { data: packDefinitions = [] } = useQuery({
    queryKey: PACK_DEFINITIONS_QUERY_KEY,
    queryFn: fetchItemPackDefinitions,
  });

  const binBySlot = useMemo(() => {
    const map = new Map<string, BinInventory>();
    for (const bin of bins) map.set(binSkuKey(bin.bin_id, bin.sku_busy_code), bin);
    return map;
  }, [bins]);

  const binsByBinId = useMemo(() => {
    const map = new Map<string, BinInventory[]>();
    for (const bin of bins) {
      const key = normalizeBinInput(bin.bin_id);
      const list = map.get(key) ?? [];
      list.push(bin);
      map.set(key, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => String(a.item_name_snapshot ?? a.sku_busy_code).localeCompare(String(b.item_name_snapshot ?? b.sku_busy_code)));
    }
    return map;
  }, [bins]);

  const selectedBin = binBySlot.get(binSkuKey(form.binId, form.skuBusyCode));
  const productSlotsForSelectedBin = form.binId ? (binsByBinId.get(normalizeBinInput(form.binId)) ?? []) : [];
  const lowBins = bins.filter((bin) => bin.status === 'low' || bin.status === 'empty').length;
  const totalEa = bins.reduce((sum, bin) => sum + bin.total_qty, 0);

  const itemByBusyCode = useMemo(() => {
    const map = new Map<number, Item>();
    for (const item of items) {
      if (item.busy_code != null) map.set(Number(item.busy_code), item);
    }
    return map;
  }, [items]);

  const packDefinitionByBusyCode = useMemo(() => {
    const map = new Map<number, ItemPackDefinition>();
    for (const definition of packDefinitions) {
      map.set(Number(definition.busy_code), definition);
    }
    return map;
  }, [packDefinitions]);

  const skuOptions = useMemo(() => {
    const query = skuSearch.trim().toLowerCase();
    if (!query) return items.filter((item) => item.busy_code != null).slice(0, 20);
    return items
      .filter((item) => {
        if (item.busy_code == null) return false;
        return [item.name, item.alias, item.alias1, String(item.busy_code)]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(query);
      })
      .slice(0, 30);
  }, [items, skuSearch]);

  const parsedBulkRows = useMemo(() => parseBulkRows(bulkText), [bulkText]);

  const invalidateWms = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: BIN_INVENTORY_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: PENDING_BIN_COUNTS_QUERY_KEY }),
    ]);
  };

  const countMutation = useMutation({
    mutationFn: submitBinCount,
    onSuccess: async (result) => {
      await invalidateWms();
      if (!result.success) {
        toast.error(result.reason ?? 'Could not submit bin count.');
        return;
      }
      if (result.requires_approval) {
        toast.info('Variance queued for supervisor approval.');
      } else {
        toast.success('Bin count auto-approved.');
      }
    },
    onError: () => toast.error('Could not submit bin count.'),
  });

  const reviewMutation = useMutation({
    mutationFn: reviewBinCount,
    onSuccess: async (result) => {
      await invalidateWms();
      if (!result.success) {
        toast.error(result.reason ?? 'Could not review count.');
        return;
      }
      toast.success(`Count ${result.status}.`);
    },
    onError: () => toast.error('Could not review count.'),
  });

  const bulkMutation = useMutation({
    mutationFn: bulkImportBinInventory,
    onSuccess: async (result) => {
      await invalidateWms();
      if (!result.success) {
        toast.error(result.reason ?? 'Could not import bins.');
        return;
      }
      toast.success(`Imported ${formatCount(result.imported)} bins; skipped ${formatCount(result.skipped)}.`);
    },
    onError: () => toast.error('Could not import bins.'),
  });

  const seedMutation = useMutation({
    mutationFn: seedBinInventoryFromItems,
    onSuccess: async (result) => {
      await invalidateWms();
      if (!result.success) {
        toast.error(result.reason ?? 'Could not seed bins.');
        return;
      }
      toast.success(`Seeded ${formatCount(result.seeded)} bins; ambiguous ${formatCount(result.skipped_ambiguous)}.`);
    },
    onError: () => toast.error('Could not seed bins from rack numbers.'),
  });

  const setField = (key: keyof CountForm, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const loadBin = (bin: BinInventory) => {
    setForm({
      binId: bin.bin_id,
      skuBusyCode: String(bin.sku_busy_code),
      innerPacks: String(bin.inner_packs),
      looseEaQty: String(bin.loose_ea_qty),
      innerPackQty: String(bin.inner_pack_qty),
      dailyTarget: bin.daily_target == null ? '' : String(bin.daily_target),
      reorderPoint: bin.reorder_point == null ? '' : String(bin.reorder_point),
      note: '',
    });
    setSkuSearch(bin.item_name_snapshot ?? String(bin.sku_busy_code));
  };

  const addScanEvent = useCallback((event: Omit<CountScanEvent, 'id'>) => {
    setScanEvents((current) => [
      {
        ...event,
        id: `${Date.now()}:${current.length}`,
      },
      ...current,
    ].slice(0, 12));
  }, []);

  const primeSkuFromBusyCode = useCallback((busyCode: number) => {
    const item = itemByBusyCode.get(busyCode);
    if (item) setSkuSearch(itemLabel(item));
    setForm((current) => ({
      ...current,
      skuBusyCode: current.skuBusyCode || String(busyCode),
    }));
  }, [itemByBusyCode]);

  const resolveBinSlot = useCallback((
    binIdInput: string,
    explicitBusyCode: number | null,
    currentBusyCode: number | null,
  ): ResolvedBinSlot => {
    const binId = normalizeBinInput(binIdInput);
    const candidates = binsByBinId.get(binId) ?? [];

    if (explicitBusyCode != null) {
      return {
        binId,
        skuBusyCode: explicitBusyCode,
        bin: binBySlot.get(binSkuKey(binId, explicitBusyCode)) ?? null,
        candidates,
        matchKind: 'payload',
      };
    }

    if (currentBusyCode != null) {
      const currentBin = candidates.find((bin) => Number(bin.sku_busy_code) === currentBusyCode);
      if (currentBin) {
        return {
          binId,
          skuBusyCode: currentBusyCode,
          bin: currentBin,
          candidates,
          matchKind: 'current_existing',
        };
      }
    }

    if (candidates.length === 1) {
      const onlyBin = candidates[0];
      if (!onlyBin) {
        return {
          binId,
          skuBusyCode: null,
          bin: null,
          candidates,
          matchKind: 'none',
        };
      }
      return {
        binId,
        skuBusyCode: Number(onlyBin.sku_busy_code),
        bin: onlyBin,
        candidates,
        matchKind: 'single_existing',
      };
    }

    return {
      binId,
      skuBusyCode: null,
      bin: null,
      candidates,
      matchKind: candidates.length > 1 ? 'ambiguous' : 'none',
    };
  }, [binBySlot, binsByBinId]);

  const applyScannedSlot = useCallback((binId: string, skuBusyCode: number | null) => {
    const resolved = resolveBinSlot(binId, skuBusyCode, parseRequiredNumber(form.skuBusyCode));
    const item = resolved.skuBusyCode == null ? null : itemByBusyCode.get(resolved.skuBusyCode);
    setForm((current) => ({
      ...current,
      binId: resolved.binId,
      skuBusyCode: resolved.skuBusyCode == null ? current.skuBusyCode : String(resolved.skuBusyCode),
      innerPacks: '0',
      looseEaQty: '0',
      innerPackQty: resolved.bin?.inner_pack_qty != null ? String(resolved.bin.inner_pack_qty) : current.innerPackQty,
      dailyTarget: resolved.bin?.daily_target == null ? current.dailyTarget : String(resolved.bin.daily_target),
      reorderPoint: resolved.bin?.reorder_point == null ? current.reorderPoint : String(resolved.bin.reorder_point),
    }));
    if (item) setSkuSearch(itemLabel(item));
    return resolved;
  }, [form.skuBusyCode, itemByBusyCode, resolveBinSlot]);

  const applyBinSlotInput = (value: string) => {
    const parsed = parseBinSlotInput(value);
    const explicitBusyCode =
      parsed.skuBusyCode == null || parsed.skuBusyCode.trim() === ''
        ? null
        : Number(parsed.skuBusyCode);
    const resolved = applyScannedSlot(
      parsed.binId,
      Number.isFinite(explicitBusyCode) ? explicitBusyCode : null,
    );
    if (resolved.matchKind === 'ambiguous') {
      toast.info(`This bin has ${resolved.candidates.length} SKUs. Choose the product slot before counting.`);
    }
  };

  const handleCycleScanResolved = useCallback((scan: LiveQrScannerResolved) => {
    const classified = classifyScanPayload(scan.rawValue);
    const slot = parseBinSlotInput(scan.rawValue);
    const scannedBusyFromBin =
      slot.skuBusyCode == null || slot.skuBusyCode.trim() === ''
        ? null
        : Number(slot.skuBusyCode);

    if (classified.kind === 'rack' && slot.binId) {
      const resolved = applyScannedSlot(
        slot.binId,
        Number.isFinite(scannedBusyFromBin) ? scannedBusyFromBin : null,
      );
      const matchedItem = resolved.skuBusyCode == null ? null : itemByBusyCode.get(resolved.skuBusyCode);
      const options = resolved.candidates.slice(0, 4).map(describeBinCandidate).join(', ');
      addScanEvent({
        label:
          resolved.matchKind === 'ambiguous'
            ? 'Bin has multiple SKUs'
            : resolved.skuBusyCode == null
              ? 'New bin selected'
              : 'Bin and product loaded',
        detail:
          resolved.matchKind === 'ambiguous'
            ? `${resolved.binId} · choose one: ${options}`
            : resolved.skuBusyCode == null
              ? `${resolved.binId} · no existing WMS product slot yet`
              : `${resolved.binId} · ${matchedItem?.name ?? resolved.bin?.item_name_snapshot ?? `Busy ${resolved.skuBusyCode}`}`,
        rawValue: scan.rawValue,
        tone: resolved.matchKind === 'ambiguous' ? 'warning' : 'neutral',
        deltaInnerPacks: 0,
        deltaLooseEaQty: 0,
      });
      return;
    }

    const packPayload = parsePackPickPayload(scan.rawValue);
    if (packPayload) {
      const currentBusy = parseRequiredNumber(form.skuBusyCode);
      if (currentBusy != null && currentBusy !== packPayload.busyCode) {
        addScanEvent({
          label: 'Wrong item label',
          detail: `Scanned Busy ${packPayload.busyCode}, current slot is Busy ${currentBusy}`,
          rawValue: scan.rawValue,
          tone: 'negative',
          deltaInnerPacks: 0,
          deltaLooseEaQty: 0,
        });
        return;
      }

      const definition = packDefinitionByBusyCode.get(packPayload.busyCode);
      const packQty = packQuantityForType(definition, packPayload.packType);
      const innerPackQty = packPayload.packType === 'inner'
        ? (packQty ?? parseRequiredInt(form.innerPackQty, 25))
        : parseRequiredInt(form.innerPackQty, definition?.inner_pack_qty ?? 25);

      if (packPayload.packType === 'inner') {
        setForm((current) => ({
          ...current,
          skuBusyCode: current.skuBusyCode || String(packPayload.busyCode),
          innerPacks: String(parseRequiredInt(current.innerPacks) + 1),
          innerPackQty: packQty == null ? current.innerPackQty : String(packQty),
        }));
        primeSkuFromBusyCode(packPayload.busyCode);
        addScanEvent({
          label: 'Inner box counted',
          detail: packQty == null
            ? `Busy ${packPayload.busyCode}`
            : `Busy ${packPayload.busyCode} · ${formatCount(packQty)} EA per inner`,
          rawValue: scan.rawValue,
          tone: 'positive',
          deltaInnerPacks: 1,
          deltaLooseEaQty: 0,
        });
        return;
      }

      const innerEquivalent = packQty != null && innerPackQty > 0 ? packQty / innerPackQty : null;
      if (innerEquivalent != null && Number.isInteger(innerEquivalent)) {
        setForm((current) => ({
          ...current,
          skuBusyCode: current.skuBusyCode || String(packPayload.busyCode),
          innerPacks: String(parseRequiredInt(current.innerPacks) + innerEquivalent),
          innerPackQty: String(innerPackQty),
        }));
        primeSkuFromBusyCode(packPayload.busyCode);
        addScanEvent({
          label: 'Master box counted',
          detail: `Busy ${packPayload.busyCode} · +${formatCount(innerEquivalent)} inner boxes`,
          rawValue: scan.rawValue,
          tone: 'positive',
          deltaInnerPacks: innerEquivalent,
          deltaLooseEaQty: 0,
        });
        return;
      }

      const looseDelta = Math.max(1, packQty ?? 1);
      setForm((current) => ({
        ...current,
        skuBusyCode: current.skuBusyCode || String(packPayload.busyCode),
        looseEaQty: String(parseRequiredInt(current.looseEaQty) + looseDelta),
      }));
      primeSkuFromBusyCode(packPayload.busyCode);
      addScanEvent({
        label: 'Master box counted as loose',
        detail: `Busy ${packPayload.busyCode} · +${formatCount(looseDelta)} loose EA`,
        rawValue: scan.rawValue,
        tone: 'warning',
        deltaInnerPacks: 0,
        deltaLooseEaQty: looseDelta,
      });
      return;
    }

    const lpnPayload = parseLpnPickPayload(scan.rawValue);
    if (lpnPayload?.busyCode != null) {
      const currentBusy = parseRequiredNumber(form.skuBusyCode);
      if (currentBusy != null && currentBusy !== lpnPayload.busyCode) {
        addScanEvent({
          label: 'Wrong LPN item',
          detail: `Scanned Busy ${lpnPayload.busyCode}, current slot is Busy ${currentBusy}`,
          rawValue: scan.rawValue,
          tone: 'negative',
          deltaInnerPacks: 0,
          deltaLooseEaQty: 0,
        });
        return;
      }
      const looseDelta = Math.max(1, lpnPayload.remainingQty ?? 1);
      setForm((current) => ({
        ...current,
        skuBusyCode: current.skuBusyCode || String(lpnPayload.busyCode),
        looseEaQty: String(parseRequiredInt(current.looseEaQty) + looseDelta),
      }));
      primeSkuFromBusyCode(lpnPayload.busyCode);
      addScanEvent({
        label: 'LPN counted',
        detail: `${lpnPayload.lpnCode} · +${formatCount(looseDelta)} EA`,
        rawValue: scan.rawValue,
        tone: 'positive',
        deltaInnerPacks: 0,
        deltaLooseEaQty: looseDelta,
      });
      return;
    }

    const matchedBusyCode = scan.matchedItem?.busy_code == null ? null : Number(scan.matchedItem.busy_code);
    if (matchedBusyCode != null) {
      const currentBusy = parseRequiredNumber(form.skuBusyCode);
      if (currentBusy != null && currentBusy !== matchedBusyCode) {
        addScanEvent({
          label: 'Wrong loose item',
          detail: `Scanned Busy ${matchedBusyCode}, current slot is Busy ${currentBusy}`,
          rawValue: scan.rawValue,
          tone: 'negative',
          deltaInnerPacks: 0,
          deltaLooseEaQty: 0,
        });
        return;
      }
      const looseDelta = classified.extractedQuantity && classified.extractedQuantity > 0 ? classified.extractedQuantity : 1;
      setForm((current) => ({
        ...current,
        skuBusyCode: current.skuBusyCode || String(matchedBusyCode),
        looseEaQty: String(parseRequiredInt(current.looseEaQty) + looseDelta),
      }));
      primeSkuFromBusyCode(matchedBusyCode);
      addScanEvent({
        label: 'Loose item counted',
        detail: `${scan.matchedItem?.name ?? `Busy ${matchedBusyCode}`} · +${formatCount(looseDelta)} EA`,
        rawValue: scan.rawValue,
        tone: 'positive',
        deltaInnerPacks: 0,
        deltaLooseEaQty: looseDelta,
      });
      return;
    }

    addScanEvent({
      label: 'Unknown label',
      detail: 'Decoded QR, but it did not match a bin, pack, LPN, or SKU label.',
      rawValue: scan.rawValue,
      tone: 'negative',
      deltaInnerPacks: 0,
      deltaLooseEaQty: 0,
    });
  }, [
    addScanEvent,
    applyScannedSlot,
    form.innerPackQty,
    form.skuBusyCode,
    itemByBusyCode,
    packDefinitionByBusyCode,
    primeSkuFromBusyCode,
  ]);

  const handleUndoLastCountScan = () => {
    const lastCount = scanEvents.find((event) => event.deltaInnerPacks !== 0 || event.deltaLooseEaQty !== 0);
    if (!lastCount) return;
    setForm((current) => ({
      ...current,
      innerPacks: String(Math.max(0, parseRequiredInt(current.innerPacks) - lastCount.deltaInnerPacks)),
      looseEaQty: String(Math.max(0, parseRequiredInt(current.looseEaQty) - lastCount.deltaLooseEaQty)),
    }));
    setScanEvents((current) => current.filter((event) => event.id !== lastCount.id));
  };

  const handleSubmitCount = () => {
    const binId = normalizeBinInput(form.binId);
    const skuBusyCode = parseRequiredNumber(form.skuBusyCode);
    if (!binId) {
      toast.error('Enter or scan a bin ID first.');
      return;
    }
    if (skuBusyCode == null) {
      toast.error('Choose a SKU Busy code.');
      return;
    }
    const loggedScans = scanEvents.filter((event) => event.deltaInnerPacks !== 0 || event.deltaLooseEaQty !== 0).length;
    const noteParts = [form.note.trim()].filter(Boolean);
    if (loggedScans > 0) {
      noteParts.push(`Cycle count scanned ${loggedScans} labels in app.`);
    }

    countMutation.mutate({
      binId,
      skuBusyCode,
      innerPacks: parseRequiredInt(form.innerPacks),
      looseEaQty: parseRequiredInt(form.looseEaQty),
      innerPackQty: parseRequiredInt(form.innerPackQty, 25) || 25,
      dailyTarget: parseOptionalInt(form.dailyTarget),
      reorderPoint: parseOptionalInt(form.reorderPoint),
      countType: selectedBin ? 'cycle_count' : 'initial_setup',
      userId,
      userName,
      note: noteParts.join(' ') || null,
    });
  };

  const handleImport = () => {
    if (parsedBulkRows.length === 0) {
      toast.error('Paste rows with a header line first.');
      return;
    }
    bulkMutation.mutate({
      rows: parsedBulkRows,
      userId,
      userName,
      sourceFile: 'admin-paste',
    });
  };

  const handleReview = (logId: number, approved: boolean) => {
    reviewMutation.mutate({
      logId,
      approved,
      userId,
      userName,
      reviewNote: approved ? 'Approved from WMS admin queue' : 'Rejected from WMS admin queue',
    });
  };

  return (
    <div className="role-admin min-h-screen bg-[var(--bg-primary)]">
      <div className="mx-auto max-w-7xl px-4 pb-10 pt-4 lg:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/admin')}
            className="inline-flex items-center gap-2 rounded-xl bg-[var(--bg-secondary)] px-3 py-2 text-sm font-semibold text-[var(--content-secondary)] hover:text-[var(--content-primary)]"
          >
            <ArrowLeftIcon size={18} weight="bold" />
            Back to admin
          </button>
          <button
            type="button"
            onClick={() => {
              void refetchBins();
            }}
            className="inline-flex items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 text-sm font-semibold text-[var(--content-secondary)] hover:text-[var(--content-primary)]"
          >
            <ArrowsClockwiseIcon size={18} weight="bold" />
            Refresh WMS
          </button>
        </div>

        <header className="mt-4 rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-[var(--bg-accent-subtle)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--content-accent)]">
                <DatabaseIcon size={14} weight="fill" />
                Bin Composition
              </div>
              <h1 className="mt-3 text-2xl font-bold text-[var(--content-primary)]">
                WMS Cycle Count
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--content-secondary)]">
                Count sealed inner packs and loose eaches by physical bin. Zero variance updates
                immediately; SKU or quantity variance goes to supervisor review before changing stock.
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="SKU bins tracked" value={formatCount(bins.length)} hint="Product slots on rack locations" />
            <Metric label="Eaches visible" value={formatCount(totalEa)} hint="Inner packs plus loose EA" />
            <Metric label="Low or empty" value={formatCount(lowBins)} hint="Ready for replenishment triggers" />
            <Metric label="Pending review" value={formatCount(pendingCounts.length)} hint="Supervisor approval queue" />
          </div>
        </header>

        <main className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
          <section className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-[var(--content-primary)]">Count a bin</h2>
                <p className="mt-1 text-sm text-[var(--content-tertiary)]">
                  Scan the bin label, then scan each inner box and every loose item label in that slot.
                </p>
              </div>
              {selectedBin && (
                <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase ${statusClass(selectedBin.status)}`}>
                  {selectedBin.status.replace('_', ' ')}
                </span>
              )}
            </div>

            <div className="mt-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="inline-flex items-center gap-2 rounded-full bg-[var(--bg-accent-subtle)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--content-accent)]">
                    <BarcodeIcon size={14} weight="bold" />
                    Scan count
                  </div>
                  <p className="mt-2 text-sm text-[var(--content-secondary)]">
                    Current scan total: <span className="font-semibold">{formatCount(parseRequiredInt(form.innerPacks))}</span> inner,
                    {' '}
                    <span className="font-semibold">{formatCount(parseRequiredInt(form.looseEaQty))}</span> loose EA.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setScannerOpen(true)}
                    className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--bg-accent)] px-4 text-sm font-semibold text-white"
                  >
                    <CameraIcon size={18} weight="bold" />
                    Open scanner
                  </button>
                  <button
                    type="button"
                    onClick={handleUndoLastCountScan}
                    disabled={!scanEvents.some((event) => event.deltaInnerPacks !== 0 || event.deltaLooseEaQty !== 0)}
                    className="min-h-11 rounded-xl border border-[var(--border-subtle)] px-4 text-sm font-semibold text-[var(--content-secondary)] disabled:opacity-50"
                  >
                    Undo last
                  </button>
                </div>
              </div>

              {scanEvents.length > 0 && (
                <ul className="mt-3 grid gap-2">
                  {scanEvents.slice(0, 5).map((event) => (
                    <li
                      key={event.id}
                      className="flex items-start justify-between gap-3 rounded-xl bg-[var(--bg-secondary)] px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-[var(--content-primary)]">
                          {event.label}
                        </p>
                        <p className="truncate text-xs text-[var(--content-tertiary)]">{event.detail}</p>
                      </div>
                      <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-bold ${scanToneClass(event.tone)}`}>
                        {event.deltaInnerPacks > 0
                          ? `+${formatCount(event.deltaInnerPacks)} inner`
                          : event.deltaLooseEaQty > 0
                            ? `+${formatCount(event.deltaLooseEaQty)} EA`
                            : event.tone}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {productSlotsForSelectedBin.length > 1 && (
              <div className="mt-3 rounded-2xl border border-[var(--bg-warning)] bg-[var(--bg-warning-subtle)] p-4">
                <p className="text-sm font-semibold text-[var(--content-primary)]">
                  Multiple product slots live in {normalizeBinInput(form.binId)}
                </p>
                <p className="mt-1 text-sm text-[var(--content-warning)]">
                  Choose the exact SKU slot before counting. A pure bin QR should narrow location, not guess the product.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {productSlotsForSelectedBin.map((bin) => (
                    <button
                      key={binSkuKey(bin.bin_id, bin.sku_busy_code)}
                      type="button"
                      onClick={() => loadBin(bin)}
                      className="rounded-xl bg-[var(--bg-secondary)] px-3 py-2 text-left text-sm font-semibold text-[var(--content-primary)] shadow-sm"
                    >
                      {describeBinCandidate(bin)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {productSlotsForSelectedBin.length === 1 && selectedBin && (
              <div className="mt-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-4 py-3 text-sm text-[var(--content-secondary)]">
                Bin QR resolved to <span className="font-semibold text-[var(--content-primary)]">{describeBinCandidate(selectedBin)}</span>.
              </div>
            )}

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <label className="space-y-1 md:col-span-2">
                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--content-tertiary)]">
                  Bin ID
                </span>
                <input
                  value={form.binId}
                  onChange={(event) => setField('binId', event.target.value)}
                  onBlur={() => applyBinSlotInput(form.binId)}
                  placeholder="BIN:NG-A2-R05-S3"
                  className="min-h-12 w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-4 font-mono text-sm text-[var(--content-primary)] outline-none focus:border-[var(--bg-accent)]"
                />
              </label>

              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--content-tertiary)]">
                  SKU search
                </span>
                <input
                  value={skuSearch}
                  onChange={(event) => setSkuSearch(event.target.value)}
                  placeholder="Search item, alias, Busy code"
                  className="min-h-12 w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-4 text-sm text-[var(--content-primary)] outline-none focus:border-[var(--bg-accent)]"
                />
              </label>

              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--content-tertiary)]">
                  SKU Busy code
                </span>
                <select
                  value={form.skuBusyCode}
                  onChange={(event) => {
                    const next = event.target.value;
                    setField('skuBusyCode', next);
                    const item = itemByBusyCode.get(Number(next));
                    if (item) setSkuSearch(itemLabel(item));
                  }}
                  className="min-h-12 w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-4 text-sm text-[var(--content-primary)]"
                >
                  <option value="">Choose SKU</option>
                  {skuOptions.map((item) => (
                    <option key={item.id} value={item.busy_code ?? ''}>
                      {itemLabel(item)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--content-tertiary)]">
                  Inner packs
                </span>
                <input
                  type="number"
                  min="0"
                  inputMode="numeric"
                  value={form.innerPacks}
                  onChange={(event) => setField('innerPacks', event.target.value)}
                  className="min-h-12 w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-4 text-sm text-[var(--content-primary)]"
                />
              </label>

              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--content-tertiary)]">
                  Loose EA
                </span>
                <input
                  type="number"
                  min="0"
                  inputMode="numeric"
                  value={form.looseEaQty}
                  onChange={(event) => setField('looseEaQty', event.target.value)}
                  className="min-h-12 w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-4 text-sm text-[var(--content-primary)]"
                />
              </label>

              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--content-tertiary)]">
                  Inner pack qty
                </span>
                <input
                  type="number"
                  min="1"
                  inputMode="numeric"
                  value={form.innerPackQty}
                  onChange={(event) => setField('innerPackQty', event.target.value)}
                  className="min-h-12 w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-4 text-sm text-[var(--content-primary)]"
                />
              </label>

              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--content-tertiary)]">
                  Daily target
                </span>
                <input
                  type="number"
                  min="0"
                  inputMode="numeric"
                  value={form.dailyTarget}
                  onChange={(event) => setField('dailyTarget', event.target.value)}
                  className="min-h-12 w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-4 text-sm text-[var(--content-primary)]"
                />
              </label>

              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--content-tertiary)]">
                  Reorder point
                </span>
                <input
                  type="number"
                  min="0"
                  inputMode="numeric"
                  value={form.reorderPoint}
                  onChange={(event) => setField('reorderPoint', event.target.value)}
                  className="min-h-12 w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-4 text-sm text-[var(--content-primary)]"
                />
              </label>

              <label className="space-y-1 md:col-span-2">
                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--content-tertiary)]">
                  Count note
                </span>
                <textarea
                  value={form.note}
                  onChange={(event) => setField('note', event.target.value)}
                  rows={3}
                  className="w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-4 py-3 text-sm text-[var(--content-primary)]"
                />
              </label>
            </div>

            {selectedBin && (
              <div className="mt-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-4 text-sm">
                <p className="font-semibold text-[var(--content-primary)]">
                  Expected: {formatCount(selectedBin.inner_packs)} inner, {formatCount(selectedBin.loose_ea_qty)} loose
                </p>
                <p className="mt-1 text-[var(--content-tertiary)]">
                  Total {formatCount(selectedBin.total_qty)} EA. Last counted {formatDateTime(selectedBin.last_counted_at)}.
                </p>
              </div>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleSubmitCount}
                disabled={countMutation.isPending}
                className="rounded-xl bg-[var(--bg-accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                Submit count
              </button>
              <button
                type="button"
                onClick={() => {
                  setForm(EMPTY_FORM);
                  setSkuSearch('');
                  setScanEvents([]);
                }}
                className="rounded-xl border border-[var(--border-subtle)] px-4 py-2 text-sm font-semibold text-[var(--content-secondary)]"
              >
                Clear
              </button>
            </div>
          </section>

          <section className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4 sm:p-5">
            <div className="flex items-start gap-3">
              <div className="mt-1 rounded-xl bg-[var(--bg-warning-subtle)] p-2 text-[var(--content-warning)]">
                <SealWarningIcon size={22} weight="bold" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-[var(--content-primary)]">
                  Supervisor approval queue
                </h2>
                <p className="mt-1 text-sm text-[var(--content-tertiary)]">
                  Any variance waits here so physical counts do not silently rewrite the bin.
                </p>
              </div>
            </div>

            <div className="mt-4 overflow-hidden rounded-2xl border border-[var(--border-subtle)]">
              {pendingLoading ? (
                <div className="px-4 py-6 text-sm text-[var(--content-tertiary)]">Loading queue...</div>
              ) : pendingCounts.length === 0 ? (
                <div className="px-4 py-6 text-sm text-[var(--content-tertiary)]">No counts need review.</div>
              ) : (
                <ul className="bg-[var(--bg-secondary)]">
                  {pendingCounts.map((log) => (
                    <PendingCountRow
                      key={log.id}
                      log={log}
                      busyLabel={`Busy ${log.sku_busy_code}`}
                      disabled={reviewMutation.isPending}
                      onReview={handleReview}
                    />
                  ))}
                </ul>
              )}
            </div>

            <div className="mt-5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-4">
              <h3 className="text-sm font-semibold text-[var(--content-primary)]">Initial fast-track import</h3>
              <p className="mt-1 text-sm text-[var(--content-tertiary)]">
                  Paste CSV or tab-separated rows with headers: bin_id, sku_busy_code, inner_packs,
                loose_ea_qty, inner_pack_qty, daily_target, reorder_point.
              </p>
              <textarea
                value={bulkText}
                onChange={(event) => setBulkText(event.target.value)}
                rows={7}
                placeholder={'bin_id\tsku_busy_code\tinner_packs\tloose_ea_qty\tinner_pack_qty\tdaily_target\treorder_point\nNG-A2-R05-S3\t12345\t4\t12\t25\t50\t25'}
                className="mt-3 w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-3 font-mono text-xs text-[var(--content-primary)]"
              />
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-[var(--content-tertiary)]">
                  Parsed {formatCount(parsedBulkRows.length)} rows.
                </p>
                <button
                  type="button"
                  onClick={handleImport}
                  disabled={bulkMutation.isPending || parsedBulkRows.length === 0}
                  className="rounded-xl bg-[var(--bg-accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  Import rows
                </button>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-4">
              <h3 className="text-sm font-semibold text-[var(--content-primary)]">Seed from item rack numbers</h3>
              <p className="mt-1 text-sm text-[var(--content-tertiary)]">
                Creates zero-count rows for every active SKU with a rack number, including multiple SKUs on the same shelf.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <input
                  type="number"
                  min="1"
                  value={seedPackQty}
                  onChange={(event) => setSeedPackQty(event.target.value)}
                  className="min-h-10 w-32 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 text-sm text-[var(--content-primary)]"
                />
                <button
                  type="button"
                  onClick={() =>
                    seedMutation.mutate({
                      innerPackQty: parseRequiredInt(seedPackQty, 25) || 25,
                      userId,
                      userName,
                    })
                  }
                  disabled={seedMutation.isPending}
                  className="rounded-xl border border-[var(--border-subtle)] px-4 py-2 text-sm font-semibold text-[var(--content-secondary)] disabled:opacity-50"
                >
                  Seed empty bins
                </button>
              </div>
            </div>
          </section>
        </main>

        <section className="mt-4 rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4 sm:p-5">
          <h2 className="text-base font-semibold text-[var(--content-primary)]">Tracked bins</h2>
          <div className="mt-4 overflow-hidden rounded-2xl border border-[var(--border-subtle)]">
            {binsLoading ? (
              <div className="px-4 py-6 text-sm text-[var(--content-tertiary)]">Loading bins...</div>
            ) : bins.length === 0 ? (
              <div className="px-4 py-6 text-sm text-[var(--content-tertiary)]">
                No SKU bins yet. Submit the first count, paste an initial import, or seed from item rack numbers.
              </div>
            ) : (
              <ul className="max-h-[34rem] divide-y divide-[var(--border-subtle)] overflow-y-auto">
                {bins.map((bin) => (
                  <li key={binSkuKey(bin.bin_id, bin.sku_busy_code)}>
                    <button
                      type="button"
                      onClick={() => loadBin(bin)}
                      className="grid w-full gap-3 bg-[var(--bg-secondary)] px-4 py-3 text-left transition-colors hover:bg-[var(--bg-primary)] md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.3fr)_minmax(0,0.8fr)_auto] md:items-center"
                    >
                      <span className="font-mono text-sm font-bold text-[var(--content-primary)]">
                        {bin.bin_id}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-[var(--content-primary)]">
                          {bin.item_name_snapshot ?? `Busy ${bin.sku_busy_code}`}
                        </span>
                        <span className="block text-xs text-[var(--content-tertiary)]">
                          Busy {bin.sku_busy_code}
                        </span>
                      </span>
                      <span className="text-sm text-[var(--content-secondary)]">
                        {formatCount(bin.inner_packs)} inner, {formatCount(bin.loose_ea_qty)} loose
                      </span>
                      <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase ${statusClass(bin.status)}`}>
                        {bin.status.replace('_', ' ')}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      {scannerOpen && (
        <LiveQrScanner
          title={form.binId ? `Counting ${form.binId}` : 'Scan bin, boxes, and loose labels'}
          eyebrow="Cycle Count Scan"
          mode="collect"
          idleStatus="Scan bin, inner box, or loose item label"
          helpText="Scan the bin label once, then scan each labelled inner box and loose item. One beep means one count was logged; use Undo last if the same label was counted twice."
          onClose={() => setScannerOpen(false)}
          onResolved={handleCycleScanResolved}
          onError={(message) => {
            toast.error(message);
            setScannerOpen(false);
          }}
        />
      )}
    </div>
  );
}
