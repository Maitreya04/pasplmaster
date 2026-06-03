import {
  CheckCircle,
  ClipboardText,
  Copy,
  Package,
  CheckSquare,
  UserPlus,
  type Icon,
} from '@phosphor-icons/react';
import type { PickLineProgress } from '../../../lib/cartSupply';
import type { BillingOperatorStage } from '../../../lib/billing/deriveBillingOperatorStage';
import {
  deriveStageBarPresentation,
  type StageBarModifier,
} from '../../../lib/billing/deriveStageBarPresentation';
import { billingShell } from './billingShell';

const STAGE_ICONS: Record<string, Icon> = {
  busy_entry: Copy,
  assign_picker: UserPlus,
  picking: Package,
  resolve_flags: CheckSquare,
  review_finalise: ClipboardText,
  done: CheckCircle,
};

function activeStepClasses(modifier: StageBarModifier): string {
  switch (modifier) {
    case 'warning':
      return 'border-[var(--border-warning)] bg-[var(--bg-warning-subtle)] text-[var(--content-warning-on-light)]';
    case 'critical':
      return 'border-[var(--border-negative)] bg-[var(--bg-negative-subtle)] text-[var(--content-negative)]';
    default:
      return 'border-[var(--border-opaque)] bg-[var(--bg-primary)] text-[var(--content-primary)]';
  }
}

interface BillingStageBarProps {
  stage: BillingOperatorStage;
  editCount?: number;
  compact?: boolean;
  busyProgress?: { entered: number; total: number };
  pickProgress?: PickLineProgress;
  openFlagCount?: number;
  allLinesRemoved?: boolean;
  checkerPending?: boolean;
  skipWarehousePick?: boolean;
}

export function BillingStageBar({
  stage,
  editCount = 0,
  compact = false,
  busyProgress,
  pickProgress,
  openFlagCount = 0,
  allLinesRemoved = false,
  checkerPending = false,
  skipWarehousePick = false,
}: BillingStageBarProps): React.JSX.Element {
  const { steps, barDoneTint } = deriveStageBarPresentation({
    stage,
    editCount,
    busyProgress,
    pickProgress,
    openFlagCount,
    allLinesRemoved,
    checkerPending,
    skipWarehousePick,
  });

  return (
    <nav
      className={barDoneTint ? billingShell.stagesDone : billingShell.stages}
      aria-label="Billing progress"
    >
      <ol className="flex items-center min-w-0 list-none m-0 p-0 gap-0">
        {steps.map((step, idx) => {
          const Icon = STAGE_ICONS[step.id];
          const displayLabel = compact ? step.label.split(' ')[0] : step.label;

          return (
            <li key={step.id} className="flex items-center shrink-0">
              {idx > 0 && (
                <span
                  className="billing-chrome-stage-step px-0.5 text-[var(--border-opaque)]"
                  aria-hidden
                >
                  ›
                </span>
              )}

              {step.isActive ? (
                <span
                  className={`billing-chrome-stage-step inline-flex items-center gap-1 px-2 py-0.5 rounded-lg font-medium whitespace-nowrap border-[0.5px] ${activeStepClasses(step.modifier)}`}
                  aria-current="step"
                >
                  {Icon ? <Icon size={13} /> : null}
                  {displayLabel}
                </span>
              ) : step.isDone ? (
                <span className="billing-chrome-stage-step inline-flex items-center gap-1 px-1 whitespace-nowrap text-[var(--content-positive)]">
                  <CheckCircle size={13} weight="fill" />
                  {displayLabel}
                </span>
              ) : step.isSkipped ? (
                <span
                  className="billing-chrome-stage-step inline-flex items-center px-1 whitespace-nowrap text-[var(--content-quaternary)] opacity-50 line-through decoration-[var(--content-quaternary)]/50"
                  aria-label={`${displayLabel} skipped`}
                >
                  {displayLabel}
                </span>
              ) : (
                <span className="billing-chrome-stage-step inline-flex items-center px-1 whitespace-nowrap text-[var(--content-quaternary)]">
                  {displayLabel}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
