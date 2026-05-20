import { shouldBlockJobOnUnmapped } from '../labelStudio/resolveSupplier';
import type {
  ReceivingJobLineRow,
  ReceivingJobRow,
  ReceivingLineStatus,
  ReceivingWorkflowStep,
} from '../../types/receiving';

const TERMINAL_LP_STATES = new Set(['sold_whole', 'overflow']);

export function deriveReceiveModeFromCounts(args: {
  looseOnly: boolean;
  masterLabels: number;
}): 'structured' | 'inner_only' | 'loose' {
  if (args.looseOnly) return 'loose';
  if (args.masterLabels > 0) return 'structured';
  return 'inner_only';
}

export function lineLabelsComplete(line: ReceivingJobLineRow): boolean {
  if (line.receive_mode === 'loose') {
    return Boolean(line.ratio_verified_at && line.loose_target_bin_id?.trim());
  }
  if (!line.ratio_verified_at) return false;
  const needsInner = line.inner_labels_count > 0;
  const needsMaster = line.master_labels_count > 0;
  const pieceOnly = !needsInner && !needsMaster && line.each_labels_count > 0;
  if (pieceOnly) return true;
  if (needsMaster && !line.master_labels_printed_at) return false;
  if (needsInner && !line.inner_labels_printed_at) return false;
  if (!needsInner && !needsMaster && line.each_labels_count <= 0) return false;
  return true;
}

export function lineMrpComplete(line: ReceivingJobLineRow): boolean {
  return line.mrp_per_ea != null && Number(line.mrp_per_ea) > 0;
}

export function linePutawayComplete(
  line: ReceivingJobLineRow,
  plates: { receiving_lp_state?: string | null; receiving_putaway_ea_remaining?: number | null }[],
): boolean {
  if (line.purchase_roll_up_applied_at) return true;
  if (line.receive_mode === 'loose') {
    return Boolean(line.ratio_verified_at && line.loose_target_bin_id?.trim());
  }
  if (plates.length === 0) return false;
  return plates.every((p) => {
    const state = p.receiving_lp_state ?? '';
    if (TERMINAL_LP_STATES.has(state)) return true;
    if (state === 'broken') {
      return p.receiving_putaway_ea_remaining == null || p.receiving_putaway_ea_remaining <= 0;
    }
    return false;
  });
}

export function deriveLineStatus(
  job: ReceivingJobRow,
  line: ReceivingJobLineRow,
  plates: { receiving_lp_state?: string | null; receiving_putaway_ea_remaining?: number | null }[] = [],
): ReceivingLineStatus {
  if (shouldBlockJobOnUnmapped(job.triggered_by, line.supplier_code_status)) {
    return 'blocked_unmapped';
  }
  if (!lineLabelsComplete(line)) return 'pending_labels';
  if (!lineMrpComplete(line)) return 'labels_done';
  if (!linePutawayComplete(line, plates)) return 'ready_putaway';
  return 'putaway_done';
}

export function lineStatusLabel(status: ReceivingLineStatus): string {
  switch (status) {
    case 'blocked_unmapped':
      return 'Map barcode';
    case 'pending_labels':
      return 'Count + labels';
    case 'labels_done':
      return 'MRP needed';
    case 'ready_putaway':
      return 'Putaway';
    case 'putaway_done':
      return 'Done';
    default:
      return status;
  }
}

export function isStepComplete(
  step: ReceivingWorkflowStep,
  job: ReceivingJobRow,
  lines: ReceivingJobLineRow[],
  platesByLineId: Map<number, { receiving_lp_state?: string | null; receiving_putaway_ea_remaining?: number | null }[]>,
): boolean {
  if (lines.length === 0) return step === 'truck' ? Boolean(job.dock_arrived_at) : false;

  switch (step) {
    case 'truck':
      return Boolean(job.dock_arrived_at);
    case 'count':
      return lines.every((l) => lineLabelsComplete(l));
    case 'mrp':
      return lines.every((l) => lineMrpComplete(l));
    case 'putaway':
      return lines.every((l) => linePutawayComplete(l, platesByLineId.get(l.id) ?? []));
    default:
      return false;
  }
}

/** First incomplete step, or putaway if all done. */
export function deriveActiveStep(
  job: ReceivingJobRow,
  lines: ReceivingJobLineRow[],
  platesByLineId: Map<number, { receiving_lp_state?: string | null; receiving_putaway_ea_remaining?: number | null }[]>,
): ReceivingWorkflowStep {
  const order: ReceivingWorkflowStep[] = ['truck', 'count', 'mrp', 'putaway'];
  for (const step of order) {
    if (!isStepComplete(step, job, lines, platesByLineId)) return step;
  }
  return 'putaway';
}

export function parseWorkflowStep(raw: string | null | undefined): ReceivingWorkflowStep | null {
  if (raw === 'truck' || raw === 'count' || raw === 'mrp' || raw === 'putaway') return raw;
  return null;
}

/** Resolve URL step: honor explicit step if allowed (back navigation); else active step. */
export function resolveWorkflowStep(
  requested: ReceivingWorkflowStep | null,
  job: ReceivingJobRow,
  lines: ReceivingJobLineRow[],
  platesByLineId: Map<number, { receiving_lp_state?: string | null; receiving_putaway_ea_remaining?: number | null }[]>,
): ReceivingWorkflowStep {
  const active = deriveActiveStep(job, lines, platesByLineId);
  if (!requested) return active;
  const order: ReceivingWorkflowStep[] = ['truck', 'count', 'mrp', 'putaway'];
  const reqIdx = order.indexOf(requested);
  const activeIdx = order.indexOf(active);
  if (reqIdx <= activeIdx) return requested;
  return active;
}

export function canAdvanceToStep(
  target: ReceivingWorkflowStep,
  job: ReceivingJobRow,
  lines: ReceivingJobLineRow[],
  platesByLineId: Map<number, { receiving_lp_state?: string | null; receiving_putaway_ea_remaining?: number | null }[]>,
): boolean {
  const order: ReceivingWorkflowStep[] = ['truck', 'count', 'mrp', 'putaway'];
  const targetIdx = order.indexOf(target);
  for (let i = 0; i < targetIdx; i++) {
    if (!isStepComplete(order[i], job, lines, platesByLineId)) return false;
  }
  return true;
}

export function jobIsFullyComplete(
  job: ReceivingJobRow,
  lines: ReceivingJobLineRow[],
  platesByLineId: Map<number, { receiving_lp_state?: string | null; receiving_putaway_ea_remaining?: number | null }[]>,
): boolean {
  return isStepComplete('putaway', job, lines, platesByLineId);
}
