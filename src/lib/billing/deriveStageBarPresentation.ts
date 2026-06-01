import type { BillingOperatorStage } from './deriveBillingOperatorStage';
import { billingStageBarIndex } from './deriveBillingOperatorStage';

export type StageBarModifier = 'neutral' | 'warning' | 'critical';

export interface StageBarPresentationInput {
  stage: BillingOperatorStage;
  editCount?: number;
  openFlagCount?: number;
  busyProgress?: { entered: number; total: number };
  allLinesRemoved?: boolean;
  checkerPending?: boolean;
}

export interface StageStepPresentation {
  id: string;
  label: string;
  isDone: boolean;
  isActive: boolean;
  modifier: StageBarModifier;
}

export interface StageBarPresentation {
  steps: StageStepPresentation[];
  barDoneTint: boolean;
}

const BASE_LABELS: Record<string, string> = {
  busy_entry: 'Busy entry',
  assign_picker: 'Assign',
  picking: 'Picking',
  resolve_flags: 'Resolve',
  review_finalise: 'Finalise',
  done: 'Done',
};

const STEP_IDS = [
  'busy_entry',
  'assign_picker',
  'picking',
  'resolve_flags',
  'review_finalise',
  'done',
] as const;

function activeLabel(
  stepId: string,
  input: StageBarPresentationInput,
): { label: string; modifier: StageBarModifier } {
  const base = BASE_LABELS[stepId] ?? stepId;

  switch (stepId) {
    case 'busy_entry': {
      const { busyProgress } = input;
      if (!busyProgress || busyProgress.total <= 0) {
        return { label: base, modifier: 'neutral' };
      }
      const complete =
        busyProgress.entered >= busyProgress.total && busyProgress.total > 0;
      const suffix = complete ? ' ✓' : '';
      return {
        label: `${base} · ${busyProgress.entered}/${busyProgress.total}${suffix}`,
        modifier: complete ? 'neutral' : 'warning',
      };
    }
    case 'picking': {
      if (input.allLinesRemoved) {
        return { label: `${base} · all removed`, modifier: 'critical' };
      }
      if (input.editCount && input.editCount > 0) {
        const edits = input.editCount === 1 ? 'edit' : 'edits';
        return {
          label: `${base} · ${input.editCount} ${edits}`,
          modifier: 'warning',
        };
      }
      return { label: base, modifier: 'neutral' };
    }
    case 'resolve_flags': {
      if (input.openFlagCount && input.openFlagCount > 0) {
        const flags = input.openFlagCount === 1 ? 'flag' : 'flags';
        return {
          label: `${base} · ${input.openFlagCount} ${flags}`,
          modifier: 'warning',
        };
      }
      return { label: base, modifier: 'neutral' };
    }
    case 'review_finalise': {
      if (input.checkerPending) {
        return { label: `${base} · checking`, modifier: 'warning' };
      }
      return { label: base, modifier: 'neutral' };
    }
    default:
      return { label: base, modifier: 'neutral' };
  }
}

export function deriveStageBarPresentation(
  input: StageBarPresentationInput,
): StageBarPresentation {
  const activeIdx = billingStageBarIndex(input.stage);
  const barDoneTint = input.stage === 'done';

  const steps: StageStepPresentation[] = STEP_IDS.map((stepId, idx) => {
    const isDone = idx < activeIdx || input.stage === 'done';
    const isActive = idx === activeIdx && input.stage !== 'done';

    if (isActive) {
      const { label, modifier } = activeLabel(stepId, input);
      return { id: stepId, label, isDone: false, isActive: true, modifier };
    }

    return {
      id: stepId,
      label: BASE_LABELS[stepId] ?? stepId,
      isDone,
      isActive: false,
      modifier: 'neutral',
    };
  });

  return { steps, barDoneTint };
}
