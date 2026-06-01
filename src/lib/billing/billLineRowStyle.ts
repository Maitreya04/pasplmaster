import type { BillLineFulfillment } from './billLineFulfillment';
import type { DeskFlagAccent } from './deskLineFlagKind';

/** Maps desk flag accent → left stripe + row tint (uses .ds-row--stripe-* when on .ds-row). */
export function billLineStripeClasses(accent: DeskFlagAccent): string {
  if (accent === 'red') return 'ds-row--stripe-negative';
  if (accent === 'blue') return 'ds-row--stripe-accent';
  return 'ds-row--stripe-warning';
}

export function billLineResolvedStripeClasses(): string {
  return 'ds-row--stripe-positive';
}

export function billLineRemovedStripeClasses(): string {
  return 'border-l-[var(--border-subtle)] bg-[var(--bg-tertiary)]/70 opacity-80';
}

export function billLineFlagChipClasses(accent: DeskFlagAccent): string {
  if (accent === 'red') {
    return 'bg-[var(--bg-negative-subtle)] text-[var(--content-negative)] border-[var(--border-negative)]';
  }
  if (accent === 'blue') {
    return 'bg-[var(--bg-accent-subtle)] text-[var(--content-accent)] border-[var(--border-accent)]';
  }
  return 'bg-[var(--bg-warning-subtle)] text-[var(--content-warning-on-light)] border-[var(--border-warning)]';
}

export function billLineChipClasses(tone: BillLineFulfillment['chipTone']): string {
  if (tone === 'green') {
    return 'bg-[var(--bg-positive-subtle)] text-[var(--content-positive)] border-[var(--border-positive)]';
  }
  if (tone === 'blue') {
    return 'bg-[var(--bg-accent-subtle)] text-[var(--content-accent)] border-[var(--border-accent)]';
  }
  if (tone === 'red') {
    return 'bg-[var(--bg-negative-subtle)] text-[var(--content-negative)] border-[var(--border-negative)]';
  }
  if (tone === 'amber') {
    return 'bg-[var(--bg-warning-subtle)] text-[var(--content-warning-on-light)] border-[var(--border-warning)]';
  }
  return 'bg-[var(--bg-tertiary)] text-[var(--content-secondary)] border-[var(--border-subtle)]';
}

export function billLinePositiveChipClasses(): string {
  return 'bg-[var(--bg-positive-subtle)] text-[var(--content-positive)] border-[var(--border-positive)]';
}

/** ds-chip base + tone for ReviewBillTable status pills. */
export function billLineStatusChipClasses(tone: BillLineFulfillment['chipTone']): string {
  const base = 'ds-chip ds-chip--sm border';
  const toneClass = billLineChipClasses(tone);
  return `${base} ${toneClass}`;
}

export type ReviewStatusTone = 'bill' | 'foc' | 'po' | 'oos' | 'warn' | 'flag';

const REVIEW_TONE_MAP: Record<ReviewStatusTone, BillLineFulfillment['chipTone']> = {
  bill: 'green',
  foc: 'blue',
  po: 'amber',
  oos: 'red',
  warn: 'amber',
  flag: 'blue',
};

export function reviewStatusChipClasses(tone: ReviewStatusTone): string {
  return billLineStatusChipClasses(REVIEW_TONE_MAP[tone]);
}
