/**
 * Billing desk typescale — matches Live Queue (text-xs floor, text-sm titles).
 * Use these instead of arbitrary text-[9px]/text-[10px] sizes.
 */
export const deskType = {
  panelTitle: 'text-base font-semibold text-[var(--content-primary)] leading-tight',
  panelSub: 'text-xs text-[var(--content-quaternary)] leading-snug',
  tab: 'text-xs font-medium',
  tabBadge: 'text-[11px] font-semibold tabular-nums leading-none',
  sectionLabel: 'text-xs font-semibold uppercase tracking-wide text-[var(--content-quaternary)]',
  orderMeta: 'text-xs text-[var(--content-quaternary)] tabular-nums',
  orderTitle: 'text-sm font-semibold text-[var(--content-primary)] leading-snug',
  orderDetail: 'text-xs text-[var(--content-quaternary)]',
  pill: 'text-xs font-medium leading-none',
  btn: 'text-xs font-medium',
  chipName: 'text-xs font-medium leading-tight',
  chipStat: 'text-xs tabular-nums leading-tight text-[var(--content-quaternary)]',
  hint: 'text-xs text-[var(--content-quaternary)] leading-snug',
  progress: 'text-xs text-[var(--content-quaternary)]',
  tooltip: 'text-xs leading-snug',
} as const;

export const deskAvatar = {
  md: 'flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold',
  all: 'flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-semibold border',
} as const;

export const deskBtn = {
  action: 'inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md transition-colors',
  icon: 'inline-flex items-center justify-center w-8 h-8 rounded-md transition-colors',
} as const;
