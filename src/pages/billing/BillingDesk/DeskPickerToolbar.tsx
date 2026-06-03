import { Users } from '@phosphor-icons/react';
import { useMemo } from 'react';
import type { PickerLoadInfo } from '../../../hooks/usePickerLoad';
import type { DeskOrderRow } from '../../../hooks/useBillingDeskOrders';
import { DeskTooltip } from './DeskTooltip';
import {
  computeEveryoneDeskStats,
  computePickerDeskStats,
  type PickerDeskStats,
} from './deskPickerMatch';
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

function PickerChipStats({ stats }: { stats: PickerDeskStats }): React.JSX.Element {
  return (
    <span className={deskType.chipStat}>
      <span className="desk-picker-chip__stat-active">{stats.activeCount}</span>
      <span className="desk-picker-chip__stat-sep" aria-hidden>
        ·
      </span>
      <span className="desk-picker-chip__stat-done">{stats.completedToday}</span>
    </span>
  );
}

function filterChipClass(selected: boolean): string {
  const base =
    'desk-picker-chip shrink-0 flex flex-col items-center gap-1.5 rounded-xl px-3 py-2.5 min-w-[4.75rem] border transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--role-primary)]';
  if (selected) {
    return `${base} desk-picker-chip--selected`;
  }
  return `${base} desk-picker-chip--idle`;
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

  const everyoneStats = useMemo(() => computeEveryoneDeskStats(allOrders), [allOrders]);

  return (
    <div className="shrink-0 border-b border-[var(--border-faint)] bg-[var(--bg-secondary)]">
      <div className={`px-3.5 ${compact ? 'pt-1.5 pb-2' : 'pt-2.5 pb-3'}`}>
        {!compact && (
          <div className="flex items-center justify-between gap-2 mb-2.5">
            <span className={deskType.sectionLabel}>Filter by picker</span>
            <span className="text-[11px] font-medium text-[var(--content-quaternary)] normal-case tracking-normal">
              active · done
            </span>
          </div>
        )}

        <div className="flex items-start gap-2 overflow-x-auto overscroll-x-contain pb-0.5 [scrollbar-width:thin]">
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
                <Users size={17} weight="duotone" aria-hidden />
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
              <PickerChipStats stats={everyoneStats} />
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
                  onClick={() => onSelectPicker(isSelected ? null : picker.userId)}
                  className={filterChipClass(isSelected)}
                >
                  <span
                    className={deskAvatar.md}
                    style={{ background: color.bg, color: color.text }}
                  >
                    {picker.initials}
                  </span>
                  <span
                    className={`${deskType.chipName} ${
                      isSelected
                        ? 'text-[var(--content-primary)]'
                        : 'text-[var(--content-secondary)]'
                    }`}
                  >
                    {picker.firstName}
                  </span>
                  <PickerChipStats stats={stats} />
                </button>
              </DeskTooltip>
            );
          })}
        </div>
      </div>
    </div>
  );
}
