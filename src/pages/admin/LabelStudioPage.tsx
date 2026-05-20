import { startTransition, useEffect, useDeferredValue, useMemo, useCallback, useState, type CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeftIcon, ArrowsClockwiseIcon, Camera, CaretDown, CaretUp, PrinterIcon, TagIcon } from '@phosphor-icons/react';
import QRCode from 'qrcode';
import { useItems } from '../../hooks/useItems';
import { useToast } from '../../context/ToastContext';
import {
  fetchItemPackDefinitions,
  PACK_DEFINITIONS_QUERY_KEY,
} from '../../lib/packLpn';
import type { Item, ItemPackDefinition } from '../../types';
import { itemAlternateCode, itemGroupLabel, itemPickCode } from '../../utils/itemCodes';
import { initializeItemScanIndex, useItemScanIndexStore } from '../../stores/itemScanIndex';

type LabelRecord = Item & {
  pickCode: string;
  alternateCode: string | null;
  groupLabel: string;
};

interface BinLocationLabel {
  key: string;
  binId: string;
  itemName: string;
  pickCode: string;
  groupLabel: string;
  busyCode: number | null;
  qrPayload: string;
  /** Forward pick qty from pack defs — BIN label omits live stock qty. */
  forwardPickQty: number | null;
}

type SortMode = 'group-rack-code' | 'code-rack';
type PreviewScope = 'filtered' | 'selected';
type PrintPreset = 'pack-strip' | 'rack-strip' | 'compact' | 'full';
type GroupFilter = 'unselected' | 'all' | string;
type LabelMode = 'sku' | 'pack' | 'bin';
type PackType = 'inner' | 'outer';

interface PackLabelRequestRow {
  busy_code: number;
  pack_type: PackType;
  count: number;
}

interface GeneratedPackPickLabel {
  key: string;
  busy_code: number;
  item_name: string;
  pack_type: PackType;
  pack_qty: number;
  qr_payload: string;
}

const RACK_STRIP_HEIGHT_MM = 30;
const RACK_STRIP_QR_SIZE_MM = 16;

const PRINT_CSS = `
  @page {
    size: A4 portrait;
    margin: 10mm;
  }

  @media print {
    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    body {
      background: #ffffff !important;
    }

    [data-print-hidden="true"] {
      display: none !important;
    }

    .print-root {
      padding: 0 !important;
      max-width: none !important;
    }

    .a4-label-sheet {
      display: grid !important;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 6mm;
    }

    .a4-label-card {
      break-inside: avoid;
      page-break-inside: avoid;
      min-height: 48mm;
      border-color: #cbd5e1 !important;
      box-shadow: none !important;
    }

    .a4-label-card[data-preset="rack-strip"] {
      min-height: 30mm;
      height: 30mm;
      padding: 0;
    }

    .a4-label-card[data-preset="pack-strip"] {
      min-height: 38mm;
      height: auto;
      padding: 0;
    }
  }

  .rack-strip-shell {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 18mm;
    gap: 2.5mm;
    height: 100%;
    padding: 3mm 3.5mm;
    align-items: stretch;
  }

  .rack-strip-copy {
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    overflow: hidden;
  }

  .rack-strip-code {
    font-variant-ligatures: none;
  }

  .rack-strip-description {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .rack-strip-qr-shell {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .rack-strip-qr {
    width: 16mm;
    height: 16mm;
  }

  .rack-strip-qr svg {
    display: block;
    width: 100%;
    height: 100%;
    shape-rendering: crispEdges;
  }

  .pack-label-qr svg {
    display: block;
    width: 100%;
    height: 100%;
    shape-rendering: crispEdges;
  }

  .pack-strip-shell {
    display: grid;
    grid-template-rows: minmax(0, 1fr) minmax(22mm, auto);
    gap: 0.8mm;
    height: 100%;
    padding: 1.4mm 2.2mm 1.6mm;
    align-items: stretch;
  }

  .pack-strip-copy {
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 0.6mm;
    overflow: hidden;
  }

  .pack-strip-warehouse-rack {
    font-variant-numeric: tabular-nums;
    font-weight: 900;
    font-size: 3mm;
    letter-spacing: 0.04em;
    color: #64748b;
    text-transform: uppercase;
  }

  .pack-strip-warehouse-name {
    font-weight: 800;
    font-size: 2.8mm;
    line-height: 1.12;
    color: #0f172a;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .pack-strip-warehouse-aliasnote {
    font-size: 2.3mm;
    font-weight: 700;
    color: #94a3b8;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .pack-strip-code {
    font-variant-ligatures: none;
    letter-spacing: 0;
    white-space: normal;
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  .pack-strip-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-transform: uppercase;
  }

  .pack-strip-qr-row {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(0, 1fr);
    gap: 1.6mm;
    align-items: stretch;
    justify-content: stretch;
  }

  .pack-strip-block {
    display: grid;
    grid-template-rows: 5.4mm 16mm;
    min-width: 0;
    height: 21.4mm;
    border: 0.25mm solid #cbd5e1;
    background: #ffffff;
    overflow: hidden;
  }

  .pack-strip-block-sku {
    grid-template-rows: 3.2mm minmax(4mm, max-content) minmax(12.5mm, 1fr);
    height: auto;
    min-height: 22mm;
    align-content: start;
  }

  .pack-strip-alias-heading {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 0.6mm;
    font-size: 2.5mm;
    line-height: 1;
    font-weight: 900;
    letter-spacing: 0.14em;
    color: #0f172a;
    text-transform: uppercase;
    background: #e2e8f0;
    border-bottom: 0.2mm solid #cbd5e1;
  }

  .pack-strip-alias-code {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.35mm 0.6mm 0.2mm;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-weight: 900;
    font-variant-ligatures: none;
    line-height: 1.05;
    text-align: center;
    color: #0f172a;
    word-break: break-word;
    overflow-wrap: anywhere;
  }

  .pack-strip-qr-alias {
    min-height: 0;
    padding: 0.25mm;
  }

  .pack-strip-qr-alias svg {
    width: 12.8mm !important;
    height: 12.8mm !important;
    max-width: 100%;
    max-height: 100%;
  }

  .rack-strip-qr-stack {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.35mm;
    min-width: 18mm;
  }

  .rack-strip-alias-over-qr {
    font-size: 2.4mm;
    font-weight: 900;
    letter-spacing: 0.12em;
    color: #334155;
    text-transform: uppercase;
    text-align: center;
    line-height: 1;
    max-width: 18mm;
  }

  .rack-strip-code-over-qr {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 2.9mm;
    font-weight: 900;
    line-height: 1.05;
    text-align: center;
    color: #0f172a;
    max-width: 18mm;
    word-break: break-all;
  }

  .compact-qr-scan-stack {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1mm;
  }

  .compact-alias-over-qr {
    font-size: 0.65rem;
    font-weight: 900;
    letter-spacing: 0.1em;
    color: #475569;
    text-transform: uppercase;
    text-align: center;
    line-height: 1.1;
  }

  .compact-code-over-qr {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.8rem;
    font-weight: 900;
    line-height: 1.05;
    text-align: center;
    color: #0f172a;
    max-width: 7rem;
    word-break: break-all;
  }

  .pack-strip-block-title {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 1mm;
    font-size: 3.1mm;
    line-height: 1;
    font-weight: 900;
    letter-spacing: 0;
    color: #0f172a;
  }

  .pack-strip-block-title[data-tone="item"] {
    background: #f1f5f9;
  }

  .pack-strip-block-title[data-tone="inner"] {
    background: #bbf7d0;
  }

  .pack-strip-block-title[data-tone="master"] {
    background: #bfdbfe;
  }

  .pack-strip-qr {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.45mm;
    background: #ffffff;
  }

  .pack-strip-qr svg {
    display: block;
    width: 15mm;
    height: 15mm;
    shape-rendering: crispEdges;
  }
`;

function formatCount(value: number): string {
  return value.toLocaleString('en-IN');
}

function compareNullableText(a: string | null | undefined, b: string | null | undefined): number {
  return (a ?? '').localeCompare(b ?? '', undefined, { numeric: true, sensitivity: 'base' });
}

function csvEscape(value: string | number | null | undefined): string {
  const text = String(value ?? '');
  return `"${text.replaceAll('"', '""')}"`;
}

function downloadTextFile(fileName: string, body: string, mimeType: string): void {
  const blob = new Blob([body], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function matchesQuery(item: LabelRecord, query: string): boolean {
  if (!query) return true;
  const haystack = [
    item.pickCode,
    item.alias1,
    item.alias,
    item.name,
    item.rack_no,
    item.main_group,
    item.parent_group,
    item.groupLabel,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(query);
}

function packControlKey(busyCode: number, packType: PackType): string {
  return `${busyCode}:${packType}`;
}

function packPickPayload(busyCode: number, packType: PackType): string {
  return `PASPL-PACK:${busyCode}:${packType}`;
}

function binLocationPayload(label: Pick<BinLocationLabel, 'binId' | 'busyCode' | 'pickCode'>): string {
  return JSON.stringify({
    type: 'BIN',
    rack: label.binId,
    busy_code: label.busyCode,
    sku: label.pickCode,
  });
}

function packTypeLabel(packType: PackType): string {
  return packType === 'inner' ? 'INNER BOX' : 'MASTER BOX';
}

function MetricCard({
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
      <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--content-tertiary)]">
        {label}
      </p>
      <p className="mt-2 text-[clamp(1.5rem,2.2vw,1.85rem)] font-bold leading-tight text-[var(--content-primary)] tabular-nums">
        {value}
      </p>
      <p className="mt-1 text-sm text-[var(--content-secondary)]">{hint}</p>
    </div>
  );
}

function buildManifestCsv(items: LabelRecord[]): string {
  const rows = [
    ['rack_no', 'pick_code', 'alias1', 'alias', 'item_name', 'main_group', 'parent_group'],
    ...items.map((item) => [
      item.rack_no ?? '',
      item.pickCode,
      item.alias1 ?? '',
      item.alias ?? '',
      item.name,
      item.main_group ?? '',
      item.parent_group ?? '',
    ]),
  ];
  return rows.map((row) => row.map((cell) => csvEscape(cell)).join(',')).join('\n');
}

function presetDescription(preset: PrintPreset): string {
  if (preset === 'pack-strip') return '35mm strip · LOC + description · Alias 1 above piece QR (+ pack QRs)';
  if (preset === 'rack-strip') return '1.2 inch rack strip with bold name + big code';
  if (preset === 'compact') return 'Rack + canonical code only';
  if (preset === 'full') return 'Rack + canonical code + alternate code + description';
  return 'Rack + canonical code + description';
}

function isLikelyVarrocItem(item: Pick<Item, 'main_group' | 'parent_group' | 'name'>): boolean {
  const blob = `${item.main_group ?? ''} ${item.parent_group ?? ''} ${item.name ?? ''}`.toUpperCase();
  return blob.includes('VARROC');
}

function ScanVerifierHint({
  item,
  barcodeMappingCount,
}: {
  item: LabelRecord;
  barcodeMappingCount: number;
}) {
  const warnVarroc = isLikelyVarrocItem(item) && barcodeMappingCount === 0;
  const band = warehouseSkuScanBand(item);

  return (
    <div
      data-print-hidden="true"
      className="-mx-px rounded-t-md border border-b-0 border-slate-200 bg-slate-50 px-2 py-1 font-sans text-[2.4mm] leading-tight text-slate-600"
    >
      <span className="font-semibold text-slate-800">{band.heading}</span>{' '}
      <span className="font-mono text-slate-900">{band.scanCode}</span>
      {' · '}
      OEM keys {barcodeMappingCount > 0 ? `×${barcodeMappingCount}` : 'none'}
      {warnVarroc ? (
        <span className="font-semibold text-amber-800">
          {' '}
          · Varroc: add SAP carton keys in Barcode Mapping if you rely on OEM scans.
        </span>
      ) : null}
    </div>
  );
}

function VerifyInLabLink({ itemId, className }: { itemId: number; className?: string }) {
  return (
    <Link
      to={`/admin/pick-scan-lab?itemId=${itemId}`}
      className={
        className ??
        'inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-[var(--content-accent)] hover:bg-[var(--bg-accent-subtle)]'
      }
      onClick={(event) => event.stopPropagation()}
    >
      <Camera size={14} weight="bold" />
      Pick Scan Lab
    </Link>
  );
}

function rackStripCodeStyle(code: string): CSSProperties {
  const length = code.trim().length;
  if (length <= 10) return { fontSize: '9.6mm', letterSpacing: '-0.06em', lineHeight: 0.88 };
  if (length <= 12) return { fontSize: '8.4mm', letterSpacing: '-0.055em', lineHeight: 0.88 };
  if (length <= 14) return { fontSize: '7.6mm', letterSpacing: '-0.05em', lineHeight: 0.88 };
  if (length <= 17) return { fontSize: '6.7mm', letterSpacing: '-0.045em', lineHeight: 0.88 };
  if (length <= 20) return { fontSize: '6.0mm', letterSpacing: '-0.04em', lineHeight: 0.88 };
  return { fontSize: '5.0mm', letterSpacing: '-0.03em', lineHeight: 0.84 };
}

function packStripPayloadKey(busyCode: number, packType: PackType): string {
  return packPickPayload(busyCode, packType);
}

function buildRecord(item: Item): LabelRecord | null {
  const pickCode = itemPickCode(item);
  if (!pickCode) return null;
  return {
    ...item,
    pickCode,
    alternateCode: itemAlternateCode(item),
    groupLabel: itemGroupLabel(item),
  };
}

/** Human-readable band above the ITEM QR; scanCode always matches QR payload. */
function warehouseSkuScanBand(item: LabelRecord): {
  heading: string;
  scanCode: string;
  leftFootnote?: string;
} {
  const a1 = item.alias1?.trim() ?? '';
  const alias = item.alias?.trim() ?? '';
  const scan = item.pickCode.trim();
  const busyDiffers = Boolean(alias && a1 && alias !== a1);

  if (a1) {
    return {
      heading: 'Alias 1',
      scanCode: scan,
      leftFootnote: busyDiffers ? `Busy ${alias}` : undefined,
    };
  }
  if (alias) {
    return {
      heading: 'Busy alias',
      scanCode: scan,
      leftFootnote: 'No Alias 1 in catalog',
    };
  }
  return { heading: 'Scan code', scanCode: scan };
}

function packStripSkuAliasFontMm(code: string): string {
  const len = code.trim().length;
  if (len <= 8) return '4.1mm';
  if (len <= 12) return '3.5mm';
  if (len <= 16) return '3.05mm';
  if (len <= 22) return '2.7mm';
  return '2.35mm';
}

function rackStripCodeOverQrFontMm(code: string): string {
  const len = code.trim().length;
  if (len <= 10) return '3.1mm';
  if (len <= 16) return '2.65mm';
  return '2.3mm';
}

function compactCodeOverQrRem(code: string): string {
  const len = code.trim().length;
  if (len <= 10) return '0.88rem';
  if (len <= 16) return '0.76rem';
  return '0.64rem';
}

export default function LabelStudioPage(): React.JSX.Element {
  const navigate = useNavigate();
  const toast = useToast();
  const { data: items = [], isLoading, error, refetch, isFetching } = useItems();
  const { data: packDefinitions = [], isLoading: packsLoading } = useQuery({
    queryKey: PACK_DEFINITIONS_QUERY_KEY,
    queryFn: fetchItemPackDefinitions,
  });

  const [labelMode, setLabelMode] = useState<LabelMode>('sku');
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const [onlyWithRack, setOnlyWithRack] = useState(false);
  const [groupFilter, setGroupFilter] = useState<GroupFilter>('unselected');
  const [sortMode, setSortMode] = useState<SortMode>('group-rack-code');
  const [previewScope, setPreviewScope] = useState<PreviewScope>('filtered');
  const [printPreset, setPrintPreset] = useState<PrintPreset>('pack-strip');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [qrByItemId, setQrByItemId] = useState<Record<number, string>>({});
  const [packCounts, setPackCounts] = useState<Record<string, number>>({});
  const [generatedPackLabels, setGeneratedPackLabels] = useState<GeneratedPackPickLabel[]>([]);
  const [qrByPackLabelKey, setQrByPackLabelKey] = useState<Record<string, string>>({});
  const [qrByPackStripPayload, setQrByPackStripPayload] = useState<Record<string, string>>({});
  const [qrByBinLabelKey, setQrByBinLabelKey] = useState<Record<string, string>>({});
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const barcodeMappingMap = useItemScanIndexStore((s) => s.barcodeMappingMap);
  const effectiveSortMode = advancedOpen ? sortMode : 'group-rack-code';
  const effectivePrintPreset: PrintPreset = advancedOpen ? printPreset : 'pack-strip';
  const effectivePreviewScope: PreviewScope = advancedOpen ? previewScope : 'filtered';

  useEffect(() => {
    void initializeItemScanIndex().catch(() => {});
  }, []);

  useEffect(() => {
    if (!advancedOpen && labelMode !== 'sku') {
      setLabelMode('sku');
    }
  }, [advancedOpen, labelMode]);

  const setLabelModeTracked = useCallback(
    (mode: LabelMode) => {
      if ((mode === 'pack' || mode === 'bin') && !advancedOpen) setAdvancedOpen(true);
      setLabelMode(mode);
    },
    [advancedOpen],
  );

  const oemBarcodeCountByItemId = useMemo(() => {
    const counts = new Map<number, number>();
    for (const sku of barcodeMappingMap.values()) {
      counts.set(sku.id, (counts.get(sku.id) ?? 0) + 1);
    }
    return counts;
  }, [barcodeMappingMap]);

  const labelableItems = useMemo<LabelRecord[]>(
    () =>
      items
        .map(buildRecord)
        .filter((item): item is LabelRecord => item !== null),
    [items],
  );

  const packDefinitionByBusyCode = useMemo(() => {
    const map = new Map<number, ItemPackDefinition>();
    for (const def of packDefinitions) map.set(Number(def.busy_code), def);
    return map;
  }, [packDefinitions]);

  const groupOptions = useMemo(
    () => Array.from(new Set(labelableItems.map((item) => item.groupLabel))).sort((a, b) => a.localeCompare(b)),
    [labelableItems],
  );

  const filteredItems = useMemo(() => {
    if (groupFilter === 'unselected') return [];

    const filtered = labelableItems
      .filter((item) => (onlyWithRack ? Boolean(item.rack_no?.trim()) : true))
      .filter((item) => (groupFilter === 'all' ? true : item.groupLabel === groupFilter))
      .filter((item) => matchesQuery(item, deferredQuery));

    return filtered.sort((a, b) => {
      if (effectiveSortMode === 'code-rack') {
        const codeCompare = a.pickCode.localeCompare(b.pickCode, undefined, {
          numeric: true,
          sensitivity: 'base',
        });
        if (codeCompare !== 0) return codeCompare;
        return compareNullableText(a.rack_no, b.rack_no);
      }

      const groupCompare = a.groupLabel.localeCompare(b.groupLabel, undefined, {
        sensitivity: 'base',
      });
      if (groupCompare !== 0) return groupCompare;
      const rackCompare = compareNullableText(a.rack_no, b.rack_no);
      if (rackCompare !== 0) return rackCompare;
      return a.pickCode.localeCompare(b.pickCode, undefined, {
        numeric: true,
        sensitivity: 'base',
      });
    });
  }, [deferredQuery, groupFilter, labelableItems, onlyWithRack, effectiveSortMode]);

  const packFilteredItems = useMemo(
    () =>
      filteredItems.filter((item) => {
        if (item.busy_code == null) return false;
        const def = packDefinitionByBusyCode.get(Number(item.busy_code));
        return Boolean(def?.inner_pack_qty || def?.outer_pack_qty);
      }),
    [filteredItems, packDefinitionByBusyCode],
  );

  const binLocationLabels = useMemo<BinLocationLabel[]>(() => {
    const labels: BinLocationLabel[] = [];
    for (const item of filteredItems) {
      const binId = item.rack_no?.trim().toUpperCase();
      if (!binId) continue;
      const bc = item.busy_code == null ? null : Number(item.busy_code);
      const def = bc != null ? packDefinitionByBusyCode.get(bc) : undefined;
      const fpq =
        def?.bin_forward_pick_qty != null && def.bin_forward_pick_qty >= 1
          ? def.bin_forward_pick_qty
          : null;
      const label = {
        key: `${binId}:${item.busy_code ?? item.pickCode}`,
        binId,
        itemName: item.name,
        pickCode: item.pickCode,
        groupLabel: item.groupLabel,
        busyCode: bc,
        forwardPickQty: fpq,
      };
      labels.push({
        ...label,
        qrPayload: binLocationPayload(label),
      });
    }
    return labels;
  }, [filteredItems, packDefinitionByBusyCode]);

  const selectedItems = useMemo(() => {
    const selectedSet = new Set(selectedIds);
    return labelableItems.filter((item) => selectedSet.has(item.id));
  }, [labelableItems, selectedIds]);

  const previewItems = useMemo(() => {
    if (effectivePreviewScope === 'selected') return selectedItems;
    return filteredItems;
  }, [filteredItems, effectivePreviewScope, selectedItems]);

  const packStripPayloads = useMemo(() => {
    if (labelMode !== 'sku' || effectivePrintPreset !== 'pack-strip') return [];

    const payloads = new Set<string>();
    for (const item of previewItems) {
      if (item.busy_code == null) continue;
      const busyCode = Number(item.busy_code);
      const def = packDefinitionByBusyCode.get(busyCode);
      if (def?.inner_pack_qty) payloads.add(packStripPayloadKey(busyCode, 'inner'));
      if (def?.outer_pack_qty) payloads.add(packStripPayloadKey(busyCode, 'outer'));
    }

    return Array.from(payloads);
  }, [labelMode, packDefinitionByBusyCode, previewItems, effectivePrintPreset]);

  const packLabelRows = useMemo<PackLabelRequestRow[]>(() => {
    const rows: PackLabelRequestRow[] = [];
    for (const item of packFilteredItems) {
      if (item.busy_code == null) continue;
      const busyCode = Number(item.busy_code);
      const def = packDefinitionByBusyCode.get(busyCode);
      if (!def) continue;

      const innerCount = packCounts[packControlKey(busyCode, 'inner')] ?? (def.inner_pack_qty ? 1 : 0);
      if (def.inner_pack_qty && innerCount > 0) {
        rows.push({ busy_code: busyCode, pack_type: 'inner', count: innerCount });
      }

      const outerCount = packCounts[packControlKey(busyCode, 'outer')] ?? (def.outer_pack_qty ? 1 : 0);
      if (def.outer_pack_qty && outerCount > 0) {
        rows.push({ busy_code: busyCode, pack_type: 'outer', count: outerCount });
      }
    }
    return rows;
  }, [packCounts, packDefinitionByBusyCode, packFilteredItems]);

  const brandChosen = groupFilter !== 'unselected';

  useEffect(() => {
    let cancelled = false;
    const pendingItems = previewItems.filter((item) => !qrByItemId[item.id]);
    if (pendingItems.length === 0) return;

    void Promise.all(
      pendingItems.map(async (item) => {
        const svgMarkup = await QRCode.toString(item.pickCode, {
          errorCorrectionLevel: 'M',
          margin: 1,
          type: 'svg',
          color: {
            dark: '#111827',
            light: '#ffffff',
          },
        });
        return [item.id, svgMarkup.replace('<svg', '<svg shape-rendering="crispEdges"')] as const;
      }),
    ).then((entries) => {
      if (cancelled) return;
      startTransition(() => {
        setQrByItemId((current) => {
          const next = { ...current };
          for (const [id, dataUrl] of entries) next[id] = dataUrl;
          return next;
        });
      });
    });

    return () => {
      cancelled = true;
    };
  }, [previewItems, qrByItemId]);

  useEffect(() => {
    let cancelled = false;
    const pendingPayloads = packStripPayloads.filter((payload) => !qrByPackStripPayload[payload]);
    if (pendingPayloads.length === 0) return;

    void Promise.all(
      pendingPayloads.map(async (payload) => {
        const svgMarkup = await QRCode.toString(payload, {
          errorCorrectionLevel: 'M',
          margin: 1,
          type: 'svg',
          color: {
            dark: '#111827',
            light: '#ffffff',
          },
        });
        return [payload, svgMarkup.replace('<svg', '<svg shape-rendering="crispEdges"')] as const;
      }),
    ).then((entries) => {
      if (cancelled) return;
      startTransition(() => {
        setQrByPackStripPayload((current) => {
          const next = { ...current };
          for (const [payload, dataUrl] of entries) next[payload] = dataUrl;
          return next;
        });
      });
    });

    return () => {
      cancelled = true;
    };
  }, [packStripPayloads, qrByPackStripPayload]);

  useEffect(() => {
    let cancelled = false;
    const pendingLabels = generatedPackLabels.filter((label) => !qrByPackLabelKey[label.key]);
    if (pendingLabels.length === 0) return;

    void Promise.all(
      pendingLabels.map(async (label) => {
        const svgMarkup = await QRCode.toString(label.qr_payload, {
          errorCorrectionLevel: 'M',
          margin: 1,
          type: 'svg',
          color: {
            dark: '#111827',
            light: '#ffffff',
          },
        });
        return [label.key, svgMarkup.replace('<svg', '<svg shape-rendering="crispEdges"')] as const;
      }),
    ).then((entries) => {
      if (cancelled) return;
      startTransition(() => {
        setQrByPackLabelKey((current) => {
          const next = { ...current };
          for (const [key, dataUrl] of entries) next[key] = dataUrl;
          return next;
        });
      });
    });

    return () => {
      cancelled = true;
    };
  }, [generatedPackLabels, qrByPackLabelKey]);

  useEffect(() => {
    let cancelled = false;
    const pendingLabels = binLocationLabels.filter((label) => !qrByBinLabelKey[label.key]);
    if (pendingLabels.length === 0) return;

    void Promise.all(
      pendingLabels.map(async (label) => {
        const svgMarkup = await QRCode.toString(label.qrPayload, {
          errorCorrectionLevel: 'M',
          margin: 1,
          type: 'svg',
          color: {
            dark: '#111827',
            light: '#ffffff',
          },
        });
        return [label.key, svgMarkup.replace('<svg', '<svg shape-rendering="crispEdges"')] as const;
      }),
    ).then((entries) => {
      if (cancelled) return;
      startTransition(() => {
        setQrByBinLabelKey((current) => {
          const next = { ...current };
          for (const [key, dataUrl] of entries) next[key] = dataUrl;
          return next;
        });
      });
    });

    return () => {
      cancelled = true;
    };
  }, [binLocationLabels, qrByBinLabelKey]);

  const toggleSelected = (itemId: number) => {
    setSelectedIds((current) =>
      current.includes(itemId) ? current.filter((id) => id !== itemId) : [...current, itemId],
    );
  };

  const selectFiltered = () => {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const item of filteredItems) next.add(item.id);
      return Array.from(next);
    });
  };

  const clearSelection = () => {
    setSelectedIds([]);
  };

  const exportManifest = (scope: PreviewScope) => {
    const rows = scope === 'selected' ? selectedItems : filteredItems;
    if (rows.length === 0) return;
    downloadTextFile(
      `sku-label-manifest-${scope}-${new Date().toISOString().slice(0, 10)}.csv`,
      buildManifestCsv(rows),
      'text/csv;charset=utf-8',
    );
  };

  const setPackCount = (busyCode: number, packType: PackType, value: string) => {
    const parsed = Math.max(0, Math.floor(Number(value) || 0));
    setPackCounts((current) => ({
      ...current,
      [packControlKey(busyCode, packType)]: parsed,
    }));
  };

  const generatePackLabels = () => {
    if (packLabelRows.length === 0) {
      toast.info('Enter at least one inner or master label count.');
      return;
    }

    const labels: GeneratedPackPickLabel[] = [];
    for (const row of packLabelRows) {
      const def = packDefinitionByBusyCode.get(row.busy_code);
      const packQty = row.pack_type === 'inner' ? def?.inner_pack_qty : def?.outer_pack_qty;
      if (!def || !packQty) continue;

      for (let copy = 1; copy <= row.count; copy += 1) {
        labels.push({
          key: `${row.busy_code}:${row.pack_type}:${copy}`,
          busy_code: row.busy_code,
          item_name: def.item_name_snapshot,
          pack_type: row.pack_type,
          pack_qty: packQty,
          qr_payload: packPickPayload(row.busy_code, row.pack_type),
        });
      }
    }

    setGeneratedPackLabels(labels);
    setQrByPackLabelKey({});
    toast.success(`Prepared ${labels.length.toLocaleString('en-IN')} reusable pack pick labels.`);
  };

  const printCurrentScope = () => {
    if (labelMode === 'pack' && generatedPackLabels.length === 0) return;
    if (labelMode === 'bin' && binLocationLabels.length === 0) return;
    if (labelMode === 'sku' && previewItems.length === 0) return;
    window.print();
  };

  return (
    <div className="role-admin min-h-screen bg-[var(--bg-primary)]">
      <style>{PRINT_CSS}</style>

      <div className="print-root mx-auto max-w-7xl px-4 pb-10 pt-4 lg:px-6">
        <div className="flex flex-wrap items-center gap-3" data-print-hidden="true">
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
              void refetch();
            }}
            className="inline-flex items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 text-sm font-semibold text-[var(--content-secondary)] hover:text-[var(--content-primary)]"
          >
            <ArrowsClockwiseIcon
              size={18}
              weight="bold"
              className={isFetching ? 'animate-spin' : ''}
            />
            Refresh items
          </button>
        </div>

        <div className="mt-4 rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full bg-[var(--bg-accent-subtle)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--content-accent)]">
                <TagIcon size={14} weight="fill" />
                Batch SKU labels
              </div>
              <h1 className="mt-3 text-2xl font-bold text-[var(--content-primary)]">
                Warehouse label print
              </h1>
              <p className="mt-2 text-sm leading-6 text-[var(--content-secondary)]">
                Print A4 strips for putaway and picking: location, description, then a dedicated column with{' '}
                <span className="font-semibold text-[var(--content-primary)]">Alias 1 printed above the QR</span>{' '}
                (fallback: Busy alias / Scan code when Alias 1 is blank). Inner and master slots stay optional pack
                scans.
              </p>

              <details className="mt-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--content-secondary)]">
                <summary className="cursor-pointer font-semibold text-[var(--content-primary)]">
                  Scan symbols (PASPL-printed bins)
                </summary>
                <ul className="mt-2 list-disc space-y-1 pl-4 text-[var(--content-secondary)]">
                  <li>
                    <span className="font-semibold">Piece / bin sticker:</span> the first QR panel shows a header
                    (Alias 1, Busy alias, or Scan code). The bold human-readable line{' '}
                    <span className="font-semibold">always matches the QR</span>—that is the primary scan for PASPL
                    labels.
                  </li>
                  <li>PASPL INNER/MASTER QR use <span className="font-mono">PASPL-PACK:busy:inner|outer</span>.</li>
                  <li>
                    Varroc carton / SAP-style scans route through mappings in{' '}
                    <span className="font-semibold">item_barcodes</span> (
                    <span className="font-mono whitespace-nowrap">Barcode Mapping</span> admin screen).
                  </li>
                  <li>
                    Full playbook:{' '}
                    <span className="font-mono text-xs text-[var(--content-tertiary)]">
                      docs/LABEL_STUDIO_SCAN_CONTRACT.md
                    </span>
                  </li>
                </ul>
              </details>
            </div>

            <div className="flex flex-col gap-3 lg:items-end lg:text-right">
            <div className="rounded-2xl border border-[var(--bg-accent)] bg-[var(--bg-accent-subtle)] px-4 py-3 text-sm text-[var(--content-accent)] lg:max-w-sm lg:self-end">
              Pick a brand/group first, then the sheet prepares only that batch. That keeps QR
              rendering focused on the run you actually want to print.
            </div>

            <button
              type="button"
              onClick={() => setAdvancedOpen((open) => !open)}
              className="inline-flex items-center gap-2 self-start rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 py-2 text-sm font-semibold text-[var(--content-secondary)] hover:text-[var(--content-primary)] lg:self-end"
            >
              {advancedOpen ? (
                <>
                  <CaretUp size={16} weight="bold" aria-hidden /> Hide advanced
                </>
              ) : (
                <>
                  <CaretDown size={16} weight="bold" aria-hidden /> Advanced: presets, CSV, pack/bin batches
                </>
              )}
            </button>
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label={labelMode === 'pack' ? 'Pack Definitions' : labelMode === 'bin' ? 'Bin Labels' : 'Labelable Items'}
              value={formatCount(labelMode === 'pack' ? packDefinitions.length : labelMode === 'bin' ? binLocationLabels.length : labelableItems.length)}
              hint={labelMode === 'pack' ? 'Imported SKU pack rules mapped by busy code' : labelMode === 'bin' ? 'SKU slots with a rack number in this batch' : 'Items with alias1 or alias available'}
            />
            <MetricCard
              label={labelMode === 'pack' ? 'Filtered Ready' : labelMode === 'bin' ? 'Filtered SKU Bins' : 'Filtered'}
              value={formatCount(labelMode === 'pack' ? packFilteredItems.length : labelMode === 'bin' ? binLocationLabels.length : filteredItems.length)}
              hint={
                brandChosen
                  ? labelMode === 'pack'
                    ? 'Current brand/search items with inner or master pack definitions'
                    : labelMode === 'bin'
                      ? 'Current SKU-level bin labels after search and group filters'
                    : 'Current list after search, group, and rack filters'
                  : 'Choose a brand/group to open a batch'
              }
            />
              <MetricCard
              label={labelMode === 'pack' ? 'Generated Pack QRs' : labelMode === 'bin' ? 'BIN Payloads' : 'Selected'}
              value={formatCount(labelMode === 'pack' ? generatedPackLabels.length : labelMode === 'bin' ? binLocationLabels.length : selectedItems.length)}
              hint={labelMode === 'pack' ? 'Reusable pack pick labels in the current print batch' : labelMode === 'bin' ? 'Rack plus SKU payloads' : 'Manual picks for focused print runs'}
            />
            <MetricCard
              label="Payload"
              value={labelMode === 'pack' ? 'PASPL-PACK' : labelMode === 'bin' ? 'BIN' : 'Alias 1 + QR'}
              hint={
                labelMode === 'pack'
                  ? 'Reusable pack-size pick QR'
                  : labelMode === 'bin'
                    ? 'Rack-gate compatible JSON QR'
                  : 'Alias 1 (or Busy alias) printed bold above the SKU QR—the same characters the scanner reads'
              }
            />
          </div>

          {advancedOpen ? (
            <div className="mt-5 inline-flex rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-1">
              {([
                ['sku', 'SKU labels'],
                ['pack', 'Pack pick labels'],
                ['bin', 'Bin location labels'],
              ] as const).map(([mode, tabLabel]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setLabelModeTracked(mode)}
                  className={`rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${
                    labelMode === mode
                      ? 'bg-[var(--bg-accent)] text-white'
                      : 'text-[var(--content-secondary)] hover:text-[var(--content-primary)]'
                  }`}
                >
                  {tabLabel}
                </button>
              ))}
            </div>
          ) : (
            <p className="mt-5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-4 py-3 text-sm text-[var(--content-tertiary)]">
              <span className="font-semibold text-[var(--content-secondary)]">Quick path:</span>{' '}
              <span className="font-mono">pack-strip</span> layout · filtered batch only · each label: LOC + description +
              Alias 1 stack above QR · open Advanced for CSV, other presets, bin mode, or bulk pack-only runs.
            </p>
          )}
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <section
            className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4 sm:p-5"
            data-print-hidden="true"
          >
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h2 className="text-base font-semibold text-[var(--content-primary)]">
                  {labelMode === 'pack'
                    ? 'Pack label batch'
                    : labelMode === 'bin'
                      ? 'Bin label batch'
                      : 'Build today’s SKU batch'}
                </h2>
                <p className="mt-1 text-sm text-[var(--content-tertiary)]">
                  {labelMode === 'pack'
                    ? 'Choose a brand/group, enter how many reusable inner or master pick labels to print, then prepare the sheet.'
                    : labelMode === 'bin'
                      ? 'Choose a brand/group and print one bin label for each SKU kept at a rack.'
                    : '1) Brand / group narrows the roster. 2) Search or filter (optional: only rows with LOC). 3) Print A4—the right column is always the scan column (Alias 1 + QR).'}
                </p>
              </div>

              <div className={`flex flex-wrap gap-2 ${labelMode !== 'sku' || !advancedOpen ? 'hidden' : ''}`}>
                <button
                  type="button"
                  onClick={selectFiltered}
                  disabled={filteredItems.length === 0}
                  className="rounded-xl bg-[var(--bg-accent-subtle)] px-3 py-2 text-sm font-semibold text-[var(--content-accent)] disabled:opacity-50"
                >
                  Select filtered
                </button>
                <button
                  type="button"
                  onClick={clearSelection}
                  disabled={selectedItems.length === 0}
                  className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 py-2 text-sm font-semibold text-[var(--content-secondary)] disabled:opacity-50"
                >
                  Clear selection
                </button>
              </div>
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search pick code, alias, rack, item name..."
                className="min-h-12 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-4 text-sm text-[var(--content-primary)] outline-none transition-[border-color,box-shadow] focus:border-[var(--bg-accent)] focus:shadow-[0_0_0_3px_var(--bg-accent-subtle)]"
              />
              <label className="inline-flex min-h-12 items-center gap-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-4 text-sm text-[var(--content-secondary)]">
                <input
                  type="checkbox"
                  checked={onlyWithRack}
                  onChange={(event) => setOnlyWithRack(event.target.checked)}
                  className="h-4 w-4 rounded border-[var(--border-subtle)]"
                />
                Only SKUs with a rack number
              </label>
            </div>

            <div className={`mt-3 grid gap-3 ${advancedOpen ? 'md:grid-cols-3' : 'grid-cols-1'}`}>
              <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--content-tertiary)]">
                    Brand / Group
                  </span>
                  <select
                    value={groupFilter}
                    onChange={(event) => {
                      setGroupFilter(event.target.value as GroupFilter);
                      setQuery('');
                    }}
                    className="min-h-11 w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 text-sm text-[var(--content-primary)]"
                  >
                    <option value="unselected">Choose a brand/group</option>
                    <option value="all">All groups</option>
                    {groupOptions.map((group) => (
                      <option key={group} value={group}>
                        {group}
                    </option>
                  ))}
                </select>
              </label>

              {advancedOpen ? (
                <>
              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--content-tertiary)]">
                  Sort
                </span>
                <select
                  value={sortMode}
                  onChange={(event) => setSortMode(event.target.value as SortMode)}
                  className="min-h-11 w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 text-sm text-[var(--content-primary)]"
                >
                  <option value="group-rack-code">Group → rack → code</option>
                  <option value="code-rack">Code → rack</option>
                </select>
              </label>

              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--content-tertiary)]">
                  Sheet preset
                </span>
                <select
                  value={printPreset}
                  onChange={(event) => setPrintPreset(event.target.value as PrintPreset)}
                  disabled={labelMode !== 'sku'}
                  className="min-h-11 w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 text-sm text-[var(--content-primary)]"
                >
                  <option value="pack-strip">Pack strip 35mm</option>
                  <option value="rack-strip">Rack strip 1.2in</option>
                  <option value="compact">Canonical code only</option>
                  <option value="full">Canonical + alternate + description</option>
                </select>
              </label>
                </>
              ) : null}
            </div>

            <div className="mt-4 overflow-hidden rounded-2xl border border-[var(--border-subtle)]">
              <div className={`${labelMode === 'pack' ? 'grid-cols-[minmax(0,0.75fr)_minmax(0,1.15fr)_minmax(0,0.8fr)_minmax(0,0.8fr)]' : labelMode === 'bin' ? 'grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)_minmax(0,1fr)]' : 'grid-cols-[auto_minmax(0,0.8fr)_minmax(0,0.95fr)_minmax(0,1.4fr)]'} grid gap-3 bg-[var(--bg-primary)] px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--content-tertiary)]`}>
                {labelMode === 'pack' ? (
                  <>
                    <span>Rack</span>
                    <span>Item</span>
                    <span>Inner labels</span>
                    <span>Master labels</span>
                  </>
                ) : labelMode === 'bin' ? (
                  <>
                    <span>Bin</span>
                    <span>First item</span>
                    <span>SKU</span>
                  </>
                ) : (
                  <>
                    <span>Select</span>
                    <span>Rack</span>
                    <span>Code</span>
                    <span>Item</span>
                  </>
                )}
              </div>

              {isLoading || packsLoading ? (
                <div className="px-4 py-6 text-sm text-[var(--content-tertiary)]">Loading items...</div>
              ) : error ? (
                <div className="px-4 py-6 text-sm text-[var(--content-negative)]">
                  Could not load items for label generation.
                </div>
              ) : !brandChosen ? (
                <div className="px-4 py-6 text-sm text-[var(--content-tertiary)]">
                  Choose a brand/group first. The label tool will only prepare one batch at a time
                  so we do not waste time rendering QR codes for the whole catalog.
                </div>
              ) : labelMode === 'pack' && packFilteredItems.length === 0 ? (
                <div className="px-4 py-6 text-sm text-[var(--content-tertiary)]">
                  No pack-ready items matched this filter. Import pack definitions first or choose a
                  group with inner/master quantities.
                </div>
              ) : labelMode === 'bin' && binLocationLabels.length === 0 ? (
                <div className="px-4 py-6 text-sm text-[var(--content-tertiary)]">
                  No SKU bins matched this filter. Bin labels need items.rack_no populated.
                </div>
              ) : labelMode === 'sku' && filteredItems.length === 0 ? (
                <div className="px-4 py-6 text-sm text-[var(--content-tertiary)]">
                  No items matched this filter.
                </div>
              ) : labelMode === 'pack' ? (
                <ul className="max-h-[34rem] divide-y divide-[var(--border-subtle)] overflow-y-auto">
                  {packFilteredItems.map((item) => {
                    const busyCode = Number(item.busy_code);
                    const def = packDefinitionByBusyCode.get(busyCode);
                    const innerKey = packControlKey(busyCode, 'inner');
                    const outerKey = packControlKey(busyCode, 'outer');
                    return (
                      <li key={item.id} className="grid grid-cols-[minmax(0,0.75fr)_minmax(0,1.15fr)_minmax(0,0.8fr)_minmax(0,0.8fr)] gap-3 bg-[var(--bg-secondary)] px-4 py-3">
                        <span className="truncate font-mono text-sm text-[var(--content-primary)]">
                          {item.rack_no ?? 'No rack'}
                        </span>

                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-[var(--content-primary)]">
                            {item.name}
                          </span>
                          <span className="block truncate text-xs text-[var(--content-tertiary)]">
                            Busy {busyCode} · {item.pickCode}
                          </span>
                        </span>

                        <label className="min-w-0">
                          <span className="sr-only">Inner label count</span>
                          <input
                            type="number"
                            min="0"
                            inputMode="numeric"
                            disabled={!def?.inner_pack_qty}
                            value={packCounts[innerKey] ?? (def?.inner_pack_qty ? 1 : 0)}
                            onChange={(event) => setPackCount(busyCode, 'inner', event.target.value)}
                            className="h-10 w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 text-sm text-[var(--content-primary)] disabled:opacity-40"
                          />
                          <span className="mt-1 block text-xs text-[var(--content-tertiary)]">
                            {def?.inner_pack_qty ? `${def.inner_pack_qty} pcs` : 'No inner'}
                          </span>
                        </label>

                        <label className="min-w-0">
                          <span className="sr-only">Master label count</span>
                          <input
                            type="number"
                            min="0"
                            inputMode="numeric"
                            disabled={!def?.outer_pack_qty}
                            value={packCounts[outerKey] ?? (def?.outer_pack_qty ? 1 : 0)}
                            onChange={(event) => setPackCount(busyCode, 'outer', event.target.value)}
                            className="h-10 w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 text-sm text-[var(--content-primary)] disabled:opacity-40"
                          />
                          <span className="mt-1 block text-xs text-[var(--content-tertiary)]">
                            {def?.outer_pack_qty ? `${def.outer_pack_qty} pcs` : 'No master'}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              ) : labelMode === 'bin' ? (
                <ul className="max-h-[34rem] divide-y divide-[var(--border-subtle)] overflow-y-auto">
                  {binLocationLabels.map((label) => (
                    <li key={label.key} className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)_minmax(0,1fr)] gap-3 bg-[var(--bg-secondary)] px-4 py-3">
                      <span className="truncate font-mono text-sm font-bold text-[var(--content-primary)]">
                        {label.binId}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-[var(--content-primary)]">
                          {label.itemName}
                        </span>
                        <span className="block truncate text-xs text-[var(--content-tertiary)]">
                          {label.groupLabel}
                        </span>
                      </span>
                      <span className="truncate font-mono text-sm text-[var(--content-accent)]">
                        {label.pickCode}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <ul className="max-h-[34rem] divide-y divide-[var(--border-subtle)] overflow-y-auto">
                  {filteredItems.map((item) => {
                    const isSelected = selectedIds.includes(item.id);
                    const oemN = oemBarcodeCountByItemId.get(item.id) ?? 0;
                    const varrocLikely = isLikelyVarrocItem(item);

                    return (
                      <li key={item.id}>
                        <div
                          className={`flex gap-3 px-4 py-3 transition-colors ${
                            isSelected
                              ? 'bg-[var(--bg-accent-subtle)]'
                              : 'bg-[var(--bg-secondary)] hover:bg-[var(--bg-primary)]'
                          }`}
                        >
                          {advancedOpen ? (
                            <button
                              type="button"
                              aria-label={isSelected ? 'Deselect row' : 'Select row'}
                              onClick={() => toggleSelected(item.id)}
                              className="flex shrink-0 items-start pt-0.5 text-left"
                            >
                              <span
                                className={`inline-flex h-5 w-5 items-center justify-center rounded border text-xs font-bold ${
                                  isSelected
                                    ? 'border-[var(--bg-accent)] bg-[var(--bg-accent)] text-white'
                                    : 'border-[var(--border-opaque)] bg-[var(--bg-primary)] text-transparent'
                                }`}
                              >
                                ✓
                              </span>
                            </button>
                          ) : null}

                          <button
                            type="button"
                            disabled={!advancedOpen}
                            onClick={() => {
                              if (advancedOpen) toggleSelected(item.id);
                            }}
                            className={`min-w-0 flex-1 text-left outline-none disabled:cursor-default ${
                              advancedOpen ? 'cursor-pointer' : ''
                            }`}
                          >
                            <div
                              className={`${
                                advancedOpen
                                  ? 'grid gap-3 grid-cols-[minmax(0,0.8fr)_minmax(0,0.95fr)_minmax(0,1.4fr)]'
                                  : 'flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-x-3 sm:gap-y-1'
                              }`}
                            >
                              <span className="truncate font-mono text-sm text-[var(--content-primary)]">
                                {item.rack_no ?? 'No rack'}
                              </span>

                              <span className="min-w-0 sm:max-w-[12rem]">
                                <span className="block truncate font-mono text-sm font-semibold text-[var(--content-accent)]">
                                  {item.pickCode}
                                </span>
                                {advancedOpen && item.alternateCode ? (
                                  <span className="block truncate text-xs text-[var(--content-tertiary)]">
                                    Alt: {item.alternateCode}
                                  </span>
                                ) : null}
                              </span>

                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-medium text-[var(--content-primary)]">
                                  {item.name}
                                </span>
                                <span className="block truncate text-xs text-[var(--content-tertiary)]">
                                  {item.groupLabel}
                                  {!advancedOpen && item.alternateCode ? (
                                    <>
                                      {' '}
                                      · Alt {item.alternateCode}
                                    </>
                                  ) : null}
                                </span>
                              </span>
                            </div>

                            {!advancedOpen ? (
                              <p className="mt-2 text-[11px] leading-snug text-[var(--content-tertiary)]">
                                Scan check: OEM keys mapped{' '}
                                <span className="font-semibold text-[var(--content-secondary)]">
                                  ×{oemN}
                                </span>
                                .
                                {varrocLikely && oemN === 0 ? (
                                  <span className="font-semibold text-amber-800">
                                    {' '}
                                    Varroc SKU — add barcode mapping for carton SAP scans if needed.
                                  </span>
                                ) : null}
                              </p>
                            ) : null}
                          </button>

                          <div className="flex shrink-0 flex-col justify-center gap-1">
                            <VerifyInLabLink itemId={item.id} />
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {labelMode === 'pack' && (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-3">
                <div>
                  <p className="text-sm font-semibold text-[var(--content-primary)]">
                    {packLabelRows.reduce((sum, row) => sum + row.count, 0).toLocaleString('en-IN')} labels queued
                  </p>
                <p className="text-xs text-[var(--content-tertiary)]">
                    Reusable pack labels add the pack quantity each time they are scanned.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={generatePackLabels}
                  disabled={packLabelRows.length === 0}
                  className="rounded-xl bg-[var(--bg-accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  Prepare pack labels
                </button>
              </div>
            )}
          </section>

          <section className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4 sm:p-5">
            <div
              className="flex flex-col gap-4 border-b border-[var(--border-subtle)] pb-4"
              data-print-hidden="true"
            >
              <div>
                <h2 className="text-base font-semibold text-[var(--content-primary)]">A4 print sheet</h2>
                <p className="mt-1 text-sm text-[var(--content-tertiary)]">
                  {labelMode === 'pack'
                    ? 'Print reusable pack-pick labels for shelf or floor locations.'
                    : labelMode === 'bin'
                      ? 'Print SKU-level bin labels for shelves that hold multiple products in separate slots.'
                    : advancedOpen
                      ? 'Choose filtered vs manually selected SKUs or save CSV manifests.'
                      : 'Quick mode prepares the filtered list as PDF-ready pack strips matching pick codes.'}
                </p>
              </div>

              <div
                className={`grid gap-3 ${
                  labelMode === 'sku' && advancedOpen ? 'md:grid-cols-2' : 'grid-cols-1'
                }`}
              >
                {advancedOpen && labelMode === 'sku' ? (
                  <label className="space-y-1">
                    <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--content-tertiary)]">
                      Preview scope
                    </span>
                    <select
                      value={previewScope}
                      onChange={(event) => setPreviewScope(event.target.value as PreviewScope)}
                      disabled={labelMode !== 'sku'}
                      className="min-h-11 w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 text-sm text-[var(--content-primary)]"
                    >
                      <option value="filtered" disabled={!brandChosen}>
                        Filtered items
                      </option>
                      <option value="selected">Selected items</option>
                    </select>
                  </label>
                ) : null}

                <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-4 py-3 text-sm text-[var(--content-secondary)]">
                  <p className="font-semibold text-[var(--content-primary)]">
                    {labelMode === 'pack'
                      ? generatedPackLabels.length > 0
                        ? `${formatCount(generatedPackLabels.length)} reusable pack labels`
                        : 'No pack labels prepared'
                      : labelMode === 'bin'
                        ? `${formatCount(binLocationLabels.length)} bin labels`
                        : effectivePreviewScope === 'filtered'
                          ? `${formatCount(filteredItems.length)} filtered labels`
                          : `${formatCount(selectedItems.length)} selected labels`}
                  </p>
                  <p className="mt-1">
                    {labelMode === 'pack'
                      ? 'Color-coded inner/master pack pick labels'
                      : labelMode === 'bin'
                        ? 'One label per SKU slot on a rack'
                        : presetDescription(effectivePrintPreset)}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={printCurrentScope}
                  disabled={
                    labelMode === 'pack'
                      ? generatedPackLabels.length === 0
                      : labelMode === 'bin'
                        ? binLocationLabels.length === 0
                        : previewItems.length === 0
                  }
                  className="inline-flex items-center gap-2 rounded-xl bg-[var(--bg-accent)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  <PrinterIcon size={18} weight="bold" />
                  Print current A4 sheet
                </button>
                {advancedOpen && labelMode === 'sku' ? (
                  <>
                    <button
                      type="button"
                      onClick={() => exportManifest(previewScope)}
                      disabled={previewItems.length === 0}
                      className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 py-2 text-sm font-semibold text-[var(--content-secondary)] disabled:opacity-50"
                    >
                      Export current manifest CSV
                    </button>
                    <button
                      type="button"
                      onClick={() => exportManifest('filtered')}
                      disabled={filteredItems.length === 0}
                      className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 py-2 text-sm font-semibold text-[var(--content-secondary)] disabled:opacity-50"
                    >
                      Export filtered CSV
                    </button>
                    <button
                      type="button"
                      onClick={() => exportManifest('selected')}
                      disabled={selectedItems.length === 0}
                      className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 py-2 text-sm font-semibold text-[var(--content-secondary)] disabled:opacity-50"
                    >
                      Export selected CSV
                    </button>
                  </>
                ) : null}
              </div>
            </div>

            {labelMode === 'pack' ? (
              generatedPackLabels.length === 0 ? (
                <div className="py-8 text-sm text-[var(--content-tertiary)]" data-print-hidden="true">
                  Enter pack label counts and prepare the sheet to preview inner/master pick labels.
                </div>
              ) : (
                <div className="a4-label-sheet mt-4 grid gap-4 sm:grid-cols-2" data-preset="pack">
                  {generatedPackLabels.map((label) => {
                    const qrMarkup = qrByPackLabelKey[label.key];
                    const isInner = label.pack_type === 'inner';
                    return (
                      <article
                        key={label.key}
                        data-preset="pack"
                        className="a4-label-card overflow-hidden border border-[var(--border-opaque)] bg-white text-slate-900 shadow-sm"
                      >
                        <div className="grid h-full min-h-[48mm] grid-cols-[minmax(0,1fr)_32mm]">
                          <div className="flex min-w-0 flex-col justify-between p-4">
                            <div>
                              <p
                                className={`inline-flex rounded-md px-2 py-1 text-xs font-black tracking-[0.16em] text-white ${
                                  isInner ? 'bg-emerald-700' : 'bg-sky-700'
                                }`}
                              >
                                {packTypeLabel(label.pack_type)}
                              </p>
                              <p className="mt-3 truncate text-lg font-black leading-tight text-slate-950">
                                {label.item_name}
                              </p>
                              <p className="mt-1 font-mono text-xs text-slate-500">
                                Busy {label.busy_code}
                              </p>
                            </div>
                            <div>
                              <p className="font-mono text-3xl font-black leading-none text-slate-950">
                                {label.pack_qty} PCS
                              </p>
                              <p className="mt-2 font-mono text-xs font-semibold text-slate-500">
                                {label.qr_payload}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center justify-center border-l border-slate-200 bg-slate-50 p-3">
                            {qrMarkup ? (
                              <div
                                className="pack-label-qr h-28 w-28"
                                aria-label={`QR for ${label.qr_payload}`}
                                role="img"
                                dangerouslySetInnerHTML={{ __html: qrMarkup }}
                              />
                            ) : (
                              <div className="text-center text-xs text-slate-500">Rendering QR...</div>
                            )}
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )
            ) : labelMode === 'bin' ? (
              binLocationLabels.length === 0 ? (
                <div className="py-8 text-sm text-[var(--content-tertiary)]" data-print-hidden="true">
                  Choose a brand/group with rack numbers to build SKU-level bin labels.
                </div>
              ) : (
                <div className="a4-label-sheet mt-4 grid gap-4 sm:grid-cols-2" data-preset="rack-strip">
                  {binLocationLabels.map((label) => {
                    const qrMarkup = qrByBinLabelKey[label.key];
                    const wrapBinCode = label.binId.trim().length > 12;
                    return (
                      <article
                        key={label.key}
                        data-preset="rack-strip"
                        className="a4-label-card overflow-hidden border border-[var(--border-opaque)] bg-white text-slate-900 shadow-sm"
                        style={{ height: `${RACK_STRIP_HEIGHT_MM}mm` }}
                      >
                        <div className="rack-strip-shell">
                          <div className="rack-strip-copy">
                            <div className="min-w-0">
                              <p
                                className={`rack-strip-code block min-w-0 font-sans font-black uppercase text-slate-900 ${
                                  wrapBinCode ? 'whitespace-normal break-all' : 'whitespace-nowrap'
                                }`}
                                style={rackStripCodeStyle(label.binId)}
                              >
                                {label.binId}
                              </p>
                              <p className="rack-strip-description mt-[1.2mm] text-[3.6mm] font-semibold leading-tight text-slate-700">
                                {label.itemName}
                              </p>
                            </div>
                            <p className="font-mono text-[3.5mm] font-bold leading-none tracking-[0.08em] text-slate-500">
                              {label.pickCode}
                              {label.forwardPickQty != null ? (
                                <span className="ml-1 text-[3mm] font-semibold tracking-normal text-emerald-800">
                                  · FPQ {label.forwardPickQty} EA
                                </span>
                              ) : (
                                <span className="ml-1 text-[3mm] font-normal tracking-normal text-slate-400">
                                  · FPQ not set
                                </span>
                              )}
                            </p>
                          </div>

                          <div className="rack-strip-qr-shell">
                            {qrMarkup ? (
                              <div
                                className="rack-strip-qr"
                                aria-label={`QR for ${label.qrPayload}`}
                                role="img"
                                dangerouslySetInnerHTML={{ __html: qrMarkup }}
                              />
                            ) : (
                              <div
                                className="flex items-center justify-center text-center text-xs text-slate-500"
                                style={{
                                  width: `${RACK_STRIP_QR_SIZE_MM}mm`,
                                  height: `${RACK_STRIP_QR_SIZE_MM}mm`,
                                }}
                              >
                                Rendering QR...
                              </div>
                            )}
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )
            ) : previewItems.length === 0 ? (
              <div className="py-8 text-sm text-[var(--content-tertiary)]" data-print-hidden="true">
                {effectivePreviewScope === 'selected'
                  ? 'Select one or more rows to build the A4 sheet. (Advanced mode)'
                  : !brandChosen
                    ? 'Choose a brand/group first to prepare a filtered A4 batch.'
                  : 'Adjust the current filters to build the A4 sheet.'}
              </div>
            ) : (
              <div className="a4-label-sheet mt-4 grid gap-4 sm:grid-cols-2" data-preset={effectivePrintPreset}>
                {previewItems.map((item) => {
                  const qrMarkup = qrByItemId[item.id];
                  const isPackStrip = effectivePrintPreset === 'pack-strip';
                  const isRackStrip = effectivePrintPreset === 'rack-strip';
                  const showDescription = effectivePrintPreset !== 'compact';
                  const showAlternateCode = effectivePrintPreset === 'full' && Boolean(item.alternateCode);
                  const wrapRackCode = item.pickCode.trim().length > 12;
                  const busyCode = item.busy_code == null ? null : Number(item.busy_code);
                  const packDefinition = busyCode == null ? null : packDefinitionByBusyCode.get(busyCode);
                  const innerPackQty = packDefinition?.inner_pack_qty ?? null;
                  const outerPackQty = packDefinition?.outer_pack_qty ?? null;
                  const innerPayload =
                    busyCode != null && innerPackQty
                      ? packStripPayloadKey(busyCode, 'inner')
                      : null;
                  const outerPayload =
                    busyCode != null && outerPackQty
                      ? packStripPayloadKey(busyCode, 'outer')
                      : null;
                  const oemBarcodeCountForItem = oemBarcodeCountByItemId.get(item.id) ?? 0;
                  const scanBand = warehouseSkuScanBand(item);

                  return (
                    <article
                      key={item.id}
                      data-preset={effectivePrintPreset}
                      className={`a4-label-card border border-[var(--border-opaque)] bg-white text-slate-900 shadow-sm ${
                        isPackStrip || isRackStrip ? 'rounded-none' : 'rounded-3xl p-4'
                      }`}
                    >
                      <ScanVerifierHint
                        item={item}
                        barcodeMappingCount={oemBarcodeCountForItem}
                      />
                      {isPackStrip ? (
                        <div className="pack-strip-shell">
                          <div className="pack-strip-copy">
                            <p className="pack-strip-warehouse-rack">
                              {item.rack_no?.trim() ? `LOC ${item.rack_no.trim()}` : 'NO LOCATION'}
                            </p>
                            <p className="pack-strip-warehouse-name">{item.name}</p>
                            {scanBand.leftFootnote ? (
                              <p className="pack-strip-warehouse-aliasnote">{scanBand.leftFootnote}</p>
                            ) : null}
                          </div>

                          <div className="pack-strip-qr-row">
                            <div className="pack-strip-block pack-strip-block-sku">
                              <div className="pack-strip-alias-heading">{scanBand.heading}</div>
                              <div
                                className="pack-strip-alias-code"
                                style={{ fontSize: packStripSkuAliasFontMm(scanBand.scanCode) }}
                              >
                                {scanBand.scanCode}
                              </div>
                              <div
                                className="pack-strip-qr pack-strip-qr-alias"
                                aria-label={`QR for ${scanBand.scanCode}`}
                                role="img"
                              >
                                {qrMarkup ? (
                                  <span dangerouslySetInnerHTML={{ __html: qrMarkup }} />
                                ) : (
                                  <span className="text-[2mm] font-semibold text-slate-500">QR</span>
                                )}
                              </div>
                            </div>

                            {innerPayload && (
                              <div className="pack-strip-block">
                                <div className="pack-strip-block-title" data-tone="inner">
                                  {innerPackQty}
                                </div>
                                <div className="pack-strip-qr" aria-label={`QR for ${innerPayload}`} role="img">
                                  {qrByPackStripPayload[innerPayload] ? (
                                    <span dangerouslySetInnerHTML={{ __html: qrByPackStripPayload[innerPayload] }} />
                                  ) : (
                                    <span className="text-[2mm] font-semibold text-slate-500">QR</span>
                                  )}
                                </div>
                              </div>
                            )}

                            {outerPayload && (
                              <div className="pack-strip-block">
                                <div className="pack-strip-block-title" data-tone="master">
                                  {outerPackQty}
                                </div>
                                <div className="pack-strip-qr" aria-label={`QR for ${outerPayload}`} role="img">
                                  {qrByPackStripPayload[outerPayload] ? (
                                    <span dangerouslySetInnerHTML={{ __html: qrByPackStripPayload[outerPayload] }} />
                                  ) : (
                                    <span className="text-[2mm] font-semibold text-slate-500">QR</span>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      ) : isRackStrip ? (
                        <div className="rack-strip-shell">
                          <div className="rack-strip-copy">
                            <div className="min-w-0">
                              <p
                                className={`rack-strip-code block min-w-0 font-sans font-black uppercase text-slate-900 ${
                                  wrapRackCode ? 'whitespace-normal break-all' : 'whitespace-nowrap'
                                }`}
                                style={rackStripCodeStyle(item.pickCode)}
                              >
                                {item.pickCode}
                              </p>
                              {showAlternateCode && item.alternateCode && (
                                <p className="mt-1 font-mono text-xs text-slate-500">
                                  Alt: {item.alternateCode}
                                </p>
                              )}
                              {showDescription && (
                                <p
                                  className={`rack-strip-description text-slate-700 ${
                                    wrapRackCode
                                      ? 'mt-[0.7mm] text-[3.3mm] font-semibold leading-[1.02]'
                                      : 'mt-[1.2mm] text-[3.8mm] font-semibold leading-tight'
                                  }`}
                                >
                                  {item.name}
                                </p>
                              )}
                            </div>
                            <p className="font-mono text-[3.5mm] leading-none tracking-[0.18em] text-slate-500">
                              {item.rack_no ?? 'NO-RACK'}
                            </p>
                          </div>

                          <div className="rack-strip-qr-shell">
                            <div className="rack-strip-qr-stack">
                              <span className="rack-strip-alias-over-qr">{scanBand.heading}</span>
                              <span
                                className="rack-strip-code-over-qr"
                                style={{ fontSize: rackStripCodeOverQrFontMm(scanBand.scanCode) }}
                              >
                                {scanBand.scanCode}
                              </span>
                              {qrMarkup ? (
                                <div
                                  className="rack-strip-qr"
                                  aria-label={`QR for ${scanBand.scanCode}`}
                                  role="img"
                                  dangerouslySetInnerHTML={{ __html: qrMarkup }}
                                />
                              ) : (
                                <div
                                  className="flex items-center justify-center text-center text-xs text-slate-500"
                                  style={{
                                    width: `${RACK_STRIP_QR_SIZE_MM}mm`,
                                    height: `${RACK_STRIP_QR_SIZE_MM}mm`,
                                  }}
                                >
                                  Rendering QR...
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="flex h-full items-stretch gap-4">
                          <div className="flex min-w-0 flex-1 flex-col justify-between">
                            <p className="font-mono text-xl font-bold leading-none text-slate-500">
                              {item.rack_no?.trim() ? `LOC ${item.rack_no.trim()}` : 'NO LOC'}
                            </p>
                            <div className="min-w-0 mt-4 space-y-1">
                              <p className="line-clamp-3 text-base font-bold leading-snug text-slate-900">
                                {item.name}
                              </p>
                              {scanBand.leftFootnote ? (
                                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                                  {scanBand.leftFootnote}
                                </p>
                              ) : null}
                              {showAlternateCode && item.alternateCode ? (
                                <p className="mt-1 font-mono text-xs text-slate-500">Alt: {item.alternateCode}</p>
                              ) : null}
                            </div>
                          </div>

                          <div className="flex shrink-0 flex-col items-center justify-center">
                            <div className="compact-qr-scan-stack">
                              <span className="compact-alias-over-qr max-w-[10rem]">{scanBand.heading}</span>
                              <span
                                className="compact-code-over-qr max-w-[10rem]"
                                style={{ fontSize: compactCodeOverQrRem(scanBand.scanCode) }}
                              >
                                {scanBand.scanCode}
                              </span>
                              <div className="flex h-28 w-28 items-center justify-center rounded-[22px] border border-slate-200 bg-slate-50 p-2">
                                {qrMarkup ? (
                                  <img
                                    src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrMarkup)}`}
                                    alt={`QR for ${scanBand.scanCode}`}
                                    className="h-24 w-24"
                                  />
                                ) : (
                                  <div className="text-center text-xs text-slate-500">Rendering QR…</div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
