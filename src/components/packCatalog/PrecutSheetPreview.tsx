import { useMemo } from 'react';
import {
  precutLabelPosition,
  type PrecutPrintOffsets,
  type PrecutSheetSpec,
} from '../../lib/packCatalog/precutSheetLayout';

export type PrecutPreviewCell = 'empty' | 'outer' | 'inner' | 'piece';

export function buildPrecutPreviewCells(
  spec: PrecutSheetSpec,
  opts: {
    outerCount: number;
    innerCount: number;
    individualCount: number;
  },
): PrecutPreviewCell[] {
  const cells: PrecutPreviewCell[] = [];
  for (let i = 0; i < opts.outerCount; i += 1) cells.push('outer');
  for (let i = 0; i < opts.innerCount; i += 1) cells.push('inner');
  for (let i = 0; i < opts.individualCount; i += 1) cells.push('piece');
  while (cells.length < spec.labelsPerPage) cells.push('empty');
  return cells.slice(0, spec.labelsPerPage);
}

const CELL_STYLES: Record<PrecutPreviewCell, string> = {
  empty: 'bg-white border-slate-200',
  outer: 'bg-sky-50 border-sky-300',
  inner: 'bg-emerald-50 border-emerald-300',
  piece: 'bg-slate-100 border-slate-300',
};

const CELL_LABELS: Record<Exclude<PrecutPreviewCell, 'empty'>, string> = {
  outer: 'O',
  inner: 'I',
  piece: 'P',
};

interface PrecutSheetPreviewProps {
  spec: PrecutSheetSpec;
  outerCount: number;
  innerCount: number;
  individualCount: number;
  offsets: PrecutPrintOffsets;
  onOffsetsChange: (next: PrecutPrintOffsets) => void;
}

export function PrecutSheetPreview({
  spec,
  outerCount,
  innerCount,
  individualCount,
  offsets,
  onOffsetsChange,
}: PrecutSheetPreviewProps): React.JSX.Element {
  const cells = useMemo(
    () => buildPrecutPreviewCells(spec, { outerCount, innerCount, individualCount }),
    [spec, outerCount, innerCount, individualCount],
  );

  const filledCount = outerCount + innerCount + individualCount;

  return (
    <div className="space-y-3">
      <div
        className="relative mx-auto w-full max-w-[280px] overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-white shadow-sm"
        style={{ aspectRatio: `${spec.pageWidthMm} / ${spec.pageHeightMm}` }}
        aria-label={`${spec.name} sheet preview`}
      >
        {cells.map((cell, index) => {
          const { leftMm, topMm } = precutLabelPosition(spec, index, offsets);
          return (
            <div
              key={index}
              className={`absolute flex items-center justify-center rounded-[1px] border text-[7px] font-bold leading-none ${CELL_STYLES[cell]}`}
              style={{
                left: `${(leftMm / spec.pageWidthMm) * 100}%`,
                top: `${(topMm / spec.pageHeightMm) * 100}%`,
                width: `${(spec.labelWidthMm / spec.pageWidthMm) * 100}%`,
                height: `${(spec.labelHeightMm / spec.pageHeightMm) * 100}%`,
              }}
            >
              {cell !== 'empty' ? CELL_LABELS[cell] : null}
            </div>
          );
        })}
      </div>

      <p className="text-center text-[11px] text-[var(--content-tertiary)]">
        {filledCount === 0
          ? 'Set counts above to see which cells fill (O outer · I inner · P piece).'
          : `${filledCount} label${filledCount === 1 ? '' : 's'} on sheet 1${filledCount > spec.labelsPerPage ? ` · +${filledCount - spec.labelsPerPage} on next sheet` : ''}`}
      </p>

      <fieldset className="rounded-xl border border-[var(--border-subtle)] px-3 py-2">
        <legend className="px-1 text-xs font-semibold text-[var(--content-secondary)]">
          Printer alignment (mm)
        </legend>
        <p className="mb-2 text-[11px] text-[var(--content-tertiary)]">
          Small nudge on top of Oddy margins/pitch if your printer feeds slightly off. Saved on this device.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs">
            <span className="font-medium">Top</span>
            <input
              type="range"
              min={-3}
              max={3}
              step={0.25}
              value={offsets.topMm}
              onChange={(e) =>
                onOffsetsChange({ ...offsets, topMm: Number(e.target.value) })
              }
              className="mt-1 w-full"
            />
            <span className="font-mono text-[var(--content-tertiary)]">
              {offsets.topMm >= 0 ? '+' : ''}
              {offsets.topMm.toFixed(2)} mm
            </span>
          </label>
          <label className="block text-xs">
            <span className="font-medium">Left</span>
            <input
              type="range"
              min={-3}
              max={3}
              step={0.25}
              value={offsets.leftMm}
              onChange={(e) =>
                onOffsetsChange({ ...offsets, leftMm: Number(e.target.value) })
              }
              className="mt-1 w-full"
            />
            <span className="font-mono text-[var(--content-tertiary)]">
              {offsets.leftMm >= 0 ? '+' : ''}
              {offsets.leftMm.toFixed(2)} mm
            </span>
          </label>
        </div>
        {(offsets.topMm !== 0 || offsets.leftMm !== 0) && (
          <button
            type="button"
            className="mt-2 text-xs font-semibold text-[var(--content-link)]"
            onClick={() => onOffsetsChange({ topMm: 0, leftMm: 0 })}
          >
            Reset alignment
          </button>
        )}
      </fieldset>
    </div>
  );
}
