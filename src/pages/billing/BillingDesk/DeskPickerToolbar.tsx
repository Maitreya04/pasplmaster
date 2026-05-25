import { useMemo } from 'react';
import type { PickerLoadInfo } from '../../../hooks/usePickerLoad';
import type { DeskOrderRow } from '../../../hooks/useBillingDeskOrders';
import { DeskTooltip } from './DeskTooltip';
import { computePickerDeskStats, type PickerDeskStats } from './deskPickerMatch';

interface DeskPickerToolbarProps {
  pickers: PickerLoadInfo[];
  pickerColors: Array<{ bg: string; text: string }>;
  allOrders: DeskOrderRow[];
  selectedPickerId: number | null;
  onSelectPicker: (pickerId: number | null) => void;
}

function statsLabel(stats: PickerDeskStats): string {
  return `${stats.activeCount} active · ${stats.completedToday} done today`;
}

function filterChipClass(selected: boolean): string {
  const base =
    'shrink-0 flex flex-col items-center gap-1 rounded-lg px-2 py-2 min-w-[54px] border transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--role-primary)]';
  if (selected) {
    return `${base} bg-[var(--bg-tertiary)] border-[var(--border-opaque)] shadow-sm`;
  }
  return `${base} bg-transparent border-transparent hover:bg-[var(--bg-tertiary)]/70 hover:border-[var(--border-faint)]`;
}

export function DeskPickerToolbar({
  pickers,
  pickerColors,
  allOrders,
  selectedPickerId,
  onSelectPicker,
}: DeskPickerToolbarProps): React.JSX.Element {
  const statsByPicker = useMemo(() => {
    const map = new Map<number, PickerDeskStats>();
    for (const picker of pickers) {
      map.set(picker.userId, computePickerDeskStats(allOrders, picker));
    }
    return map;
  }, [allOrders, pickers]);

  return (
    <div className="shrink-0 border-b border-[var(--border-faint)] bg-[var(--bg-secondary)]">
      <div className="px-3 pt-2 pb-2.5">
        <div className="flex items-center justify-between gap-2 mb-2">
          <span className="text-[9px] font-medium uppercase tracking-wide text-[var(--content-quaternary)]">
            Filter by picker
          </span>
          <span className="text-[9px] text-[var(--content-quaternary)] tabular-nums">
            active · done
          </span>
        </div>

        <div className="flex items-start gap-1.5 overflow-x-auto overscroll-x-contain py-0.5">
          <DeskTooltip label="Show every picker's orders" side="bottom">
            <button
              type="button"
              onClick={() => onSelectPicker(null)}
              className={filterChipClass(selectedPickerId === null)}
            >
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-full text-[9px] font-semibold border ${
                  selectedPickerId === null
                    ? 'bg-[var(--bg-primary)] text-[var(--content-primary)] border-[var(--border-opaque)]'
                    : 'bg-[var(--bg-primary)] text-[var(--content-quaternary)] border-[var(--border-faint)]'
                }`}
              >
                All
              </span>
              <span
                className={`text-[10px] font-medium leading-none ${
                  selectedPickerId === null
                    ? 'text-[var(--content-primary)]'
                    : 'text-[var(--content-quaternary)]'
                }`}
              >
                Everyone
              </span>
              <span className="text-[9px] tabular-nums leading-none text-[var(--content-quaternary)] invisible">
                0 · 0
              </span>
            </button>
          </DeskTooltip>

          {pickers.map((picker) => {
            const color = pickerColors[picker.colorIndex]!;
            const stats = statsByPicker.get(picker.userId) ?? {
              activeCount: 0,
              completedToday: 0,
            };
            const isSelected = selectedPickerId === picker.userId;

            return (
              <DeskTooltip
                key={picker.userId}
                label={`${picker.name} · ${statsLabel(stats)}`}
                side="bottom"
              >
                <button
                  type="button"
                  onClick={() =>
                    onSelectPicker(isSelected ? null : picker.userId)
                  }
                  className={filterChipClass(isSelected)}
                >
                  <span
                    className="flex h-7 w-7 items-center justify-center rounded-full text-[9px] font-bold"
                    style={{ background: color.bg, color: color.text }}
                  >
                    {picker.initials}
                  </span>
                  <span
                    className={`max-w-[56px] truncate text-[10px] font-medium leading-none ${
                      isSelected
                        ? 'text-[var(--content-primary)]'
                        : 'text-[var(--content-secondary)]'
                    }`}
                  >
                    {picker.firstName}
                  </span>
                  <span className="text-[9px] tabular-nums leading-none text-[var(--content-quaternary)]">
                    {stats.activeCount} · {stats.completedToday}
                  </span>
                </button>
              </DeskTooltip>
            );
          })}
        </div>
      </div>
    </div>
  );
}
