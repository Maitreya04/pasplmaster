import { Link } from 'react-router-dom';
import type { ReactElement } from 'react';
import { Check } from '@phosphor-icons/react';
import { canAdvanceToStep, isStepComplete } from '../../lib/receiving/receivingWorkflow';
import type { ReceivingJobLineRow, ReceivingJobRow, ReceivingWorkflowStep } from '../../types/receiving';

const STEPS: { id: ReceivingWorkflowStep; label: string }[] = [
  { id: 'truck', label: 'Truck arrives' },
  { id: 'count', label: 'Count + labels' },
  { id: 'mrp', label: 'MRP check' },
  { id: 'putaway', label: 'Putaway' },
];

export function ReceivingStepper({
  currentStep,
  job,
  lines,
  platesByLineId,
  onStepClick,
}: {
  currentStep: ReceivingWorkflowStep;
  job: ReceivingJobRow;
  lines: ReceivingJobLineRow[];
  platesByLineId: Map<number, { receiving_lp_state?: string | null; receiving_putaway_ea_remaining?: number | null }[]>;
  onStepClick: (step: ReceivingWorkflowStep) => void;
}): ReactElement {
  return (
    <nav
      className="sticky top-0 z-20 -mx-4 border-b border-[var(--border-subtle)] bg-[var(--bg-primary)]/95 px-4 py-3 backdrop-blur-sm lg:-mx-6 lg:px-6"
      aria-label="Receiving steps"
    >
      <div className="flex items-center gap-1 overflow-x-auto pb-1 text-[10px] font-bold uppercase tracking-[0.08em] sm:text-xs">
        <Link
          to="/purchase"
          className="shrink-0 rounded-full px-2 py-1 text-[var(--content-tertiary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--content-primary)]"
        >
          PO
        </Link>
        <span className="shrink-0 text-[var(--content-tertiary)]" aria-hidden>
          →
        </span>
        {STEPS.map((step) => {
          const isActive = step.id === currentStep;
          const completed = isStepComplete(step.id, job, lines, platesByLineId);
          const reachable = canAdvanceToStep(step.id, job, lines, platesByLineId);

          return (
            <button
              key={step.id}
              type="button"
              disabled={!reachable && !isActive}
              onClick={() => (reachable || isActive) && onStepClick(step.id)}
              className={`flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1.5 transition-colors sm:px-3 ${
                isActive
                  ? 'bg-[var(--bg-accent)] text-[var(--content-on-color)]'
                  : completed
                    ? 'bg-[var(--bg-secondary)] text-[var(--content-secondary)]'
                    : reachable
                      ? 'text-[var(--content-secondary)] hover:bg-[var(--bg-secondary)]'
                      : 'cursor-not-allowed text-[var(--content-tertiary)] opacity-50'
              }`}
            >
              {completed && !isActive ? <Check size={14} weight="bold" aria-hidden /> : null}
              <span>{step.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
