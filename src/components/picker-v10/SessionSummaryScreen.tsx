import type { PickerV10Line, PickerV10LineProgress } from './types';

export interface SessionSummaryScreenProps {
  lines: PickerV10Line[];
  progress: Record<number, PickerV10LineProgress>;
  boxCount: number;
  onBoxCountChange: (n: number) => void;
  onHandoff: () => void;
}

export function SessionSummaryScreen({
  lines,
  progress,
  boxCount,
  onBoxCountChange,
  onHandoff,
}: SessionSummaryScreenProps): React.JSX.Element {
  const doneLines = lines.filter((l) => progress[l.id]?.status === 'done' || progress[l.id]?.status === 'flagged');

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--bg-primary)]">
      <div className="shrink-0 px-4 pb-3 pt-4">
        <p className="text-lg font-bold text-[var(--content-primary)]">Session summary</p>
        <p className="mt-1 text-sm text-[var(--content-tertiary)]">
          {doneLines.length} of {lines.length} lines picked
        </p>
      </div>

      <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-4">
        {doneLines.map((line) => {
          const prog = progress[line.id]!;
          return (
            <li
              key={line.id}
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3"
            >
              <p className="font-mono text-sm font-bold text-[var(--content-primary)]">{line.code}</p>
              <p className="text-xs text-[var(--content-secondary)]">
                {prog.loggedQty} / {line.qty}
                {prog.flagged ? ' · flagged' : ''}
              </p>
              {prog.batches.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  {prog.batches.map((b, i) => (
                    <span
                      key={`${b.mrp}-${i}`}
                      className="rounded-full bg-[var(--bg-tertiary)] px-2 py-0.5 text-[9px] font-semibold text-[var(--content-secondary)]"
                    >
                      ₹{Math.round(b.mrp)}×{b.qty}
                      {b.picker_note ? ' · note' : ''}
                    </span>
                  ))}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      <div className="shrink-0 space-y-3 border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4">
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
            Box count
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => onBoxCountChange(Math.max(0, boxCount - 1))}
              className="flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] text-lg font-bold pick-pressable"
            >
              −
            </button>
            <span className="min-w-[3rem] text-center font-mono text-3xl font-extrabold tabular-nums text-[var(--content-primary)]">
              {boxCount}
            </span>
            <button
              type="button"
              onClick={() => onBoxCountChange(boxCount + 1)}
              className="flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] text-lg font-bold pick-pressable"
            >
              +
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={onHandoff}
          className="w-full min-h-[56px] rounded-2xl bg-[var(--bg-inverse-primary)] text-base font-extrabold text-white pick-pressable"
        >
          Hand off to billing
        </button>
      </div>
    </div>
  );
}
