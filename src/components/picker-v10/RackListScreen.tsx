import { Check } from '@phosphor-icons/react';
import { ProgressBar } from '../shared';
import { normalizeUom } from '../../lib/picking/pickerMicrocopy';
import type { PickerV10Line, PickerV10LineProgress } from './types';

export interface RackListScreenProps {
  lines: PickerV10Line[];
  progress: Record<number, PickerV10LineProgress>;
  orderLabel: string;
  customerLabel?: string;
  onSelectLine: (index: number) => void;
  onPickNext: () => void;
}

function lineDone(progress: PickerV10LineProgress | undefined): boolean {
  return progress?.status === 'done' || progress?.status === 'flagged';
}

export function RackListScreen({
  lines,
  progress,
  orderLabel,
  customerLabel,
  onSelectLine,
  onPickNext,
}: RackListScreenProps): React.JSX.Element {
  const doneCount = lines.filter((l) => lineDone(progress[l.id])).length;
  const nextIdx = lines.findIndex((l) => !lineDone(progress[l.id]));

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--bg-primary)]">
      <div className="shrink-0 px-4 pb-3 pt-4">
        <p className="text-sm font-bold text-[var(--content-primary)]">{orderLabel}</p>
        {customerLabel ? (
          <p className="mt-0.5 text-xs text-[var(--content-tertiary)]">{customerLabel}</p>
        ) : null}
        <div className="mt-3 flex items-end justify-between">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
            Rack lines
          </p>
          <p className="font-mono text-sm font-bold tabular-nums text-[var(--content-primary)]">
            {doneCount}/{lines.length}
          </p>
        </div>
        <div className="mt-2">
          <ProgressBar
            segments={[{ value: doneCount, color: 'green' }]}
            total={lines.length || 1}
          />
        </div>
      </div>

      <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-4 pb-4">
        {lines.map((line, idx) => {
          const prog = progress[line.id];
          const done = lineDone(prog);
          const isNext = idx === nextIdx;
          const uom = normalizeUom(line.uom);

          return (
            <li key={line.id}>
              <button
                type="button"
                onClick={() => onSelectLine(idx)}
                className={`w-full rounded-2xl border p-3 text-left pick-pressable transition-opacity ${
                  done
                    ? 'border-[var(--border-subtle)] bg-[var(--bg-secondary)] opacity-60'
                    : isNext
                      ? 'border-[var(--border-positive)] bg-[var(--bg-positive-subtle)] ring-1 ring-[var(--border-positive)]/30'
                      : 'border-[var(--border-subtle)] bg-[var(--bg-secondary)]'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
                      {line.rack ?? '—'}
                    </p>
                    <p className="font-mono text-sm font-bold text-[var(--content-primary)]">{line.code}</p>
                    <p className="line-clamp-1 text-xs text-[var(--content-secondary)]">{line.name}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    {done ? (
                      <Check size={18} weight="bold" className="text-[var(--content-positive)]" />
                    ) : (
                      <p className="font-mono text-sm font-bold tabular-nums text-[var(--content-primary)]">
                        {line.qty} {uom.toLowerCase()}
                      </p>
                    )}
                  </div>
                </div>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="shrink-0 border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4">
        <button
          type="button"
          onClick={onPickNext}
          disabled={nextIdx < 0}
          className="w-full min-h-[56px] rounded-2xl bg-[var(--bg-inverse-primary)] text-base font-extrabold text-white pick-pressable disabled:opacity-40"
        >
          {nextIdx < 0 ? 'All lines done' : `Pick next · ${lines[nextIdx]?.code ?? ''}`}
        </button>
      </div>
    </div>
  );
}
