import { useMemo } from 'react';
import type { PickerLoadInfo } from '../../../hooks/usePickerLoad';
import type { DeskOrderRow } from '../../../hooks/useBillingDeskOrders';
import { DeskTooltip } from './DeskTooltip';
import { computePickerDeskStats, type PickerDeskStats } from './deskPickerMatch';
import { deskAvatar, deskType } from './deskTypography';

interface DeskPickerToolbarProps {
  pickers: PickerLoadInfo[];
  pickerColors: Array<{ bg: string; text: string }>;
  allOrders: DeskOrderRow[];
  selectedPickerId: number | null;
  onSelectPicker: (pickerId: number | null) => void;
  compact?: boolean;
}

function statsLabel(stats: PickerDeskStats): string {
  return `${stats.activeCount} active · ${stats.completedToday} done today`;
}

function filterChipClass(selected: boolean): string {
  const base =
    'shrink-0 flex flex-col items-center gap-1 rounded-lg px-2.5 py-2 min-w-[60px] border transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--role-primary)]';
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
  compact = false,
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
      <div className={`px-3.5 ${compact ? 'pt-1.5 pb-2' : 'pt-2.5 pb-3'}`}>
        {!compact && (
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className={deskType.sectionLabel}>Filter by picker</span>
            <span className={`${deskType.chipStat} normal-case tracking-normal`}>
              active · done
            </span>
          </div>
        )}

        <div className={`flex items-start gap-2 overflow-x-auto overscroll-x-contain ${compact ? 'py-0.5' : 'py-1'}`}>
          <DeskTooltip label="Show every picker's orders" side="bottom">
            <button
              type="button"
              onClick={() => onSelectPicker(null)}
              className={filterChipClass(selectedPickerId === null)}
            >
              <span
                className={`${deskAvatar.all} ${
                  selectedPickerId === null
                    ? 'bg-[var(--bg-primary)] text-[var(--content-primary)] border-[var(--border-opaque)]'
                    : 'bg-[var(--bg-primary)] text-[var(--content-quaternary)] border-[var(--border-faint)]'
                }`}
              >
                All
              </span>
              <span
                className={`${deskType.chipName} ${
                  selectedPickerId === null
                    ? 'text-[var(--content-primary)]'
                    : 'text-[var(--content-quaternary)]'
                }`}
              >
                Everyone
              </span>
              <span className={`${deskType.chipStat} invisible`}>0 · 0</span>
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
                    className={deskAvatar.md}
                    style={{ background: color.bg, color: color.text }}
                  >
                    {picker.initials}
                  </span>
                  <span
                    className={`${deskType.chipName} max-w-[64px] truncate ${
                      isSelected
                        ? 'text-[var(--content-primary)]'
                        : 'text-[var(--content-secondary)]'
                    }`}
                  >
                    {picker.firstName}
                  </span>
                  <span className={deskType.chipStat}>
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
