import type { ReactNode } from 'react';
import { Package, Truck, Warning, type Icon } from '@phosphor-icons/react';
import { formatCurrencyRaw } from '../../../utils/formatters';
import { BillingFigure } from '../shared/BillingFigure';
import { billingShell } from './billingShell';

export interface BillingSummaryStat {
  label: string;
  value: string;
  tone?: 'default' | 'positive' | 'warning' | 'info';
}

export interface BillingSummaryChip {
  type: 'boxes' | 'carrier' | 'eway';
  label: string;
}

interface BillingSummaryBarProps {
  stats: BillingSummaryStat[];
  chips?: BillingSummaryChip[];
  rightSlot?: ReactNode;
  inline?: boolean;
}

const TONE_CLASS: Record<NonNullable<BillingSummaryStat['tone']>, string> = {
  default: 'text-[var(--content-primary)]',
  positive: 'text-[var(--content-positive)]',
  warning: 'text-[var(--content-warning-on-light)]',
  info: 'text-[var(--content-accent)]',
};

const CHIP_ICONS: Record<BillingSummaryChip['type'], Icon> = {
  boxes: Package,
  carrier: Truck,
  eway: Warning,
};

export function BillingSummaryBar({
  stats,
  chips = [],
  rightSlot,
  inline = false,
}: BillingSummaryBarProps): React.JSX.Element | null {
  if (stats.length === 0 && chips.length === 0 && !rightSlot) return null;

  if (inline) {
    const [primary, ...rest] = stats;
    return (
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 min-w-0">
        {primary ? (
          <span className="inline-flex items-baseline gap-1.5 shrink-0">
            <span className="font-ds-body-size text-[var(--content-tertiary)]">
              {primary.label}
            </span>
            <BillingFigure
              value={primary.value}
              kind="text"
              size="inherit"
              className={`font-ds-stat font-medium tracking-tight leading-none ${TONE_CLASS[primary.tone ?? 'default']}`}
            />
          </span>
        ) : null}
        {rest.length > 0 ? (
          <span className="font-ds-body-size text-[var(--content-quaternary)]">
            {rest.map((stat, i) => (
              <span key={stat.label}>
                {i === 0 ? null : <span className="px-1">·</span>}
                <span className="text-[var(--content-tertiary)]">{stat.label} </span>
                <BillingFigure
                  value={stat.value}
                  kind="text"
                  size="inherit"
                  className={`font-medium ${TONE_CLASS[stat.tone ?? 'default']}`}
                />
              </span>
            ))}
          </span>
        ) : null}
        {rightSlot ? (
          <span className="font-ds-caption-size text-[var(--content-quaternary)] tabular-nums">
            {rightSlot}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div className={`${billingShell.summary} shrink-0`}>
      <div className="flex items-center gap-4 min-w-0">
        {stats.map((stat) => (
          <div key={stat.label} className="flex flex-col gap-0.5 shrink-0">
            <span className="font-ds-caption-size text-[var(--content-tertiary)]">{stat.label}</span>
            <BillingFigure
              value={stat.value}
              kind="text"
              size="inherit"
              className={`font-ds-prose font-semibold ${TONE_CLASS[stat.tone ?? 'default']}`}
            />
          </div>
        ))}
      </div>

      {(chips.length > 0 || rightSlot) && (
        <div className="flex items-center gap-2 shrink-0 ml-auto">
          {chips.map((chip) => {
            const Icon = CHIP_ICONS[chip.type];
            const isWarning = chip.type === 'eway';
            return (
              <span
                key={`${chip.type}-${chip.label}`}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg font-ds-caption-size border border-[var(--border-opaque)] bg-[var(--bg-primary)] ${
                  isWarning
                    ? 'text-[var(--content-warning-on-light)]'
                    : 'text-[var(--content-primary)]'
                }`}
              >
                <Icon size={13} weight={isWarning ? 'fill' : undefined} />
                {chip.label}
              </span>
            );
          })}
          {rightSlot}
        </div>
      )}
    </div>
  );
}

export function formatSummaryTotal(amount: number, uncertain?: boolean): string {
  const base = formatCurrencyRaw(amount);
  return uncertain ? `${base} ±` : base;
}
