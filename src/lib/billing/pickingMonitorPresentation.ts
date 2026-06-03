import type { PickLineProgress } from '../cartSupply';
import type { DeskOrderStatus } from './deskOrderQueue';
import type { WorkflowStatus } from '../../types';

export interface PickingMonitorInput {
  deskStatus: DeskOrderStatus;
  pickingClaimStale: boolean;
  pickerName?: string | null;
  workflowStatus: WorkflowStatus;
  progress?: PickLineProgress | null;
}

export interface PickingMonitorBanner {
  title: string;
  body: string;
  variant: 'stale' | 'not_started' | 'activity_without_claim';
}

/** Shared copy for desk cards, context bar, and picking bill header. */
export function derivePickingMonitorPresentation(input: PickingMonitorInput): {
  contextNotStarted: boolean;
  progressWarningTint: boolean;
  banner: PickingMonitorBanner | null;
  progressStatusLine: (
    progress: PickLineProgress,
    pickerFirst: string | null,
  ) => string;
} {
  const progress = input.progress ?? {
    total: 0,
    picked: 0,
    flagged: 0,
    done: 0,
    remaining: 0,
  };
  const pickerFirst = input.pickerName?.split(/\s+/)[0] ?? input.pickerName ?? null;
  const hasLineActivity = progress.done > 0;
  const inPickWorkflow = input.workflowStatus === 'picking';

  const progressStatusLine = (
    pp: PickLineProgress,
    first: string | null,
  ): string => {
    if (input.deskStatus === 'checking') {
      return 'Pick complete · bill unlocks when verified';
    }
    if (input.pickingClaimStale) {
      const base = `${pp.done}/${pp.total} lines done`;
      return hasLineActivity ? `${base} · session stale` : 'Picker session stale — check device';
    }
    if (input.deskStatus === 'no_ack' && !hasLineActivity && !inPickWorkflow) {
      return first
        ? `Assigned to ${first} · waiting to start`
        : 'Assigned · waiting to start';
    }
    if (input.deskStatus === 'no_ack' && hasLineActivity) {
      return `${pp.done}/${pp.total} lines done · picker not on device`;
    }
    if (pp.total === 0) return 'No pickable warehouse lines';
    const parts = [`${pp.done}/${pp.total} lines done`];
    if (pp.picked > 0) parts.push(`${pp.picked} picked`);
    if (pp.flagged > 0) parts.push(`${pp.flagged} flagged`);
    if (pp.remaining > 0) parts.push(`${pp.remaining} left`);
    return parts.join(' · ');
  };

  if (input.pickingClaimStale) {
    return {
      contextNotStarted: false,
      progressWarningTint: true,
      banner: {
        variant: 'stale',
        title: 'Picker session stale — consider re-assign',
        body: hasLineActivity
          ? `${progress.done}/${progress.total} lines already scanned. If ${pickerFirst ?? 'the picker'} is done, use Complete on the queue card; otherwise re-assign.`
          : 'No heartbeat from the picker app. Re-assign if someone else should take this order.',
      },
      progressStatusLine,
    };
  }

  if (input.deskStatus === 'no_ack' && hasLineActivity) {
    return {
      contextNotStarted: false,
      progressWarningTint: true,
      banner: {
        variant: 'activity_without_claim',
        title: `${progress.done}/${progress.total} lines scanned · picker not on device`,
        body: `Warehouse activity is updating, but ${pickerFirst ?? 'the assigned picker'} may not have opened this order in the pick app. Monitor lines below or re-assign if needed.`,
      },
      progressStatusLine,
    };
  }

  if (input.deskStatus === 'no_ack' && !hasLineActivity && !inPickWorkflow) {
    return {
      contextNotStarted: true,
      progressWarningTint: true,
      banner: {
        variant: 'not_started',
        title: pickerFirst
          ? `Assigned to ${pickerFirst} · not started yet`
          : 'Assigned · waiting for picker to start',
        body: 'Lines move to Picked as the warehouse scans them. Re-assign from the queue card or picker chip if you need a different picker.',
      },
      progressStatusLine,
    };
  }

  return {
    contextNotStarted: false,
    progressWarningTint: false,
    banner: null,
    progressStatusLine,
  };
}
