/** Qty entry visual state — drives feedback, CTA, and banner on the core pick screen. */
export type QtyState = 'empty' | 'partial' | 'exact' | 'over';

export type QtyCtaTone = 'disabled' | 'primary' | 'success' | 'warning' | 'over';

export interface QtyStateStyle {
  qtyColor: string;
  feedbackColor: string;
  feedbackBg: string;
  previewBorder: string;
  ctaBg: string;
  ctaTone: QtyCtaTone;
  showOverBanner: boolean;
}

export function getQtyState(n: number, target: number): QtyState {
  if (!n || n === 0) return 'empty';
  if (n < target) return 'partial';
  if (n === target) return 'exact';
  return 'over';
}

export const QTY_STATE_STYLES: Record<QtyState, QtyStateStyle> = {
  empty: {
    qtyColor: 'var(--content-quaternary)',
    feedbackColor: 'var(--content-tertiary)',
    feedbackBg: 'transparent',
    previewBorder: 'var(--border-subtle)',
    ctaBg: 'var(--bg-tertiary)',
    ctaTone: 'disabled',
    showOverBanner: false,
  },
  partial: {
    qtyColor: 'var(--content-primary)',
    feedbackColor: 'var(--content-tertiary)',
    feedbackBg: 'transparent',
    previewBorder: 'var(--border-positive)',
    ctaBg: 'var(--bg-inverse-primary)',
    ctaTone: 'primary',
    showOverBanner: false,
  },
  exact: {
    qtyColor: 'var(--content-positive)',
    feedbackColor: 'var(--content-positive)',
    feedbackBg: 'var(--bg-positive-subtle)',
    previewBorder: 'var(--border-positive)',
    ctaBg: 'var(--bg-positive)',
    ctaTone: 'success',
    showOverBanner: false,
  },
  over: {
    qtyColor: 'var(--content-negative)',
    feedbackColor: 'var(--content-negative)',
    feedbackBg: 'var(--bg-negative-subtle)',
    previewBorder: 'var(--border-negative)',
    ctaBg: 'var(--bg-negative)',
    ctaTone: 'over',
    showOverBanner: true,
  },
};

/** CTA is disabled when empty, or over-target without a note. */
export function isQtyCtaDisabled(state: QtyState, note: string): boolean {
  if (state === 'empty') return true;
  if (state === 'over' && !note.trim()) return true;
  return false;
}

/** Remaining qty after logging a batch (for gap state). */
export function qtyRemainingAfterBatch(
  target: number,
  loggedQty: number,
  batchQty: number,
): number {
  return Math.max(0, target - loggedQty - batchQty);
}

/** True when over-pick is extreme (3×+ target) — stronger banner copy. */
export function isExtremeOverTarget(n: number, target: number): boolean {
  if (target <= 0) return false;
  return n >= target * 3;
}
