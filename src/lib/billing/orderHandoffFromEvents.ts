import type { FulfillmentPath } from '../../types';

export interface OrderHandoffSummary {
  claimedBy: string | null;
  checkedBy: string | null;
  assignedBy: string | null;
  pickedBy: string | null;
  resolvedBy: string | null;
  completedBy: string | null;
  changeCount: number;
  fulfillmentPath: FulfillmentPath | null;
  submittedAt: string | null;
  completedAt: string | null;
}

export interface OrderHandoffFallback {
  picker_name?: string | null;
  reviewer_name?: string | null;
  fulfillment_path?: FulfillmentPath | null;
  created_at?: string | null;
  completed_at?: string | null;
}

function trimName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseFulfillmentPath(value: unknown): FulfillmentPath | null {
  return value === 'warehouse_pick' || value === 'direct_bill' ? value : null;
}

function parseTimestamp(value: unknown): string | null {
  return trimName(value);
}

export function parseOrderHandoffRpc(data: unknown): OrderHandoffSummary | null {
  if (data == null || typeof data !== 'object') return null;
  const row = data as Record<string, unknown>;
  return {
    claimedBy: trimName(row.claimedBy),
    checkedBy: trimName(row.checkedBy),
    assignedBy: trimName(row.assignedBy),
    pickedBy: trimName(row.pickedBy),
    resolvedBy: trimName(row.resolvedBy),
    completedBy: trimName(row.completedBy),
    changeCount: typeof row.changeCount === 'number' ? row.changeCount : 0,
    fulfillmentPath: parseFulfillmentPath(row.fulfillmentPath),
    submittedAt: parseTimestamp(row.submittedAt),
    completedAt: parseTimestamp(row.completedAt),
  };
}

export function mergeOrderHandoffSummary(
  rpc: unknown,
  fallback?: OrderHandoffFallback,
): OrderHandoffSummary | null {
  const parsed = parseOrderHandoffRpc(rpc);
  if (!parsed && !fallback) return null;

  return {
    claimedBy: parsed?.claimedBy ?? null,
    checkedBy: parsed?.checkedBy ?? null,
    assignedBy: parsed?.assignedBy ?? null,
    pickedBy: parsed?.pickedBy ?? trimName(fallback?.picker_name) ?? null,
    resolvedBy: parsed?.resolvedBy ?? null,
    completedBy: parsed?.completedBy ?? trimName(fallback?.reviewer_name) ?? null,
    changeCount: parsed?.changeCount ?? 0,
    fulfillmentPath:
      parsed?.fulfillmentPath ?? parseFulfillmentPath(fallback?.fulfillment_path) ?? null,
    submittedAt: parsed?.submittedAt ?? parseTimestamp(fallback?.created_at) ?? null,
    completedAt: parsed?.completedAt ?? parseTimestamp(fallback?.completed_at) ?? null,
  };
}

export function handoffFirstName(name: string): string {
  return name.split(/\s+/)[0] ?? name;
}

function samePerson(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  return handoffFirstName(a).toLowerCase() === handoffFirstName(b).toLowerCase();
}

export type HandoffScanStep = {
  key: string;
  label: string;
  name: string;
};

const WAREHOUSE_PICK: FulfillmentPath = 'warehouse_pick';

/**
 * Scannable bill-header steps: Sold → Checked → Picked → Done.
 * Omits internal claimed/assigned unless assigner differs from checker.
 */
export function buildHandoffScanSteps(
  summary: OrderHandoffSummary,
  salesperson?: string | null,
): HandoffScanStep[] {
  const steps: HandoffScanStep[] = [];
  const isWarehousePick = summary.fulfillmentPath === WAREHOUSE_PICK;

  if (salesperson?.trim()) {
    steps.push({
      key: 'sold',
      label: 'Sold',
      name: handoffFirstName(salesperson.trim()),
    });
  }

  const checked =
    summary.checkedBy ?? summary.claimedBy ?? summary.assignedBy ?? null;
  if (checked) {
    steps.push({
      key: 'checked',
      label: 'Checked',
      name: handoffFirstName(checked),
    });
  }

  if (
    summary.assignedBy &&
    !samePerson(summary.assignedBy, checked) &&
    isWarehousePick
  ) {
    steps.push({
      key: 'assigned',
      label: 'Assigned',
      name: handoffFirstName(summary.assignedBy),
    });
  }

  if (isWarehousePick && summary.pickedBy) {
    steps.push({
      key: 'picked',
      label: 'Picked',
      name: handoffFirstName(summary.pickedBy),
    });
  }

  const resolvedName = summary.resolvedBy ? handoffFirstName(summary.resolvedBy) : null;
  const doneName = summary.completedBy ? handoffFirstName(summary.completedBy) : null;

  if (resolvedName && resolvedName !== doneName) {
    steps.push({
      key: 'resolved',
      label: 'Resolved',
      name: resolvedName,
    });
  }

  if (doneName) {
    steps.push({
      key: 'done',
      label: 'Done',
      name: doneName,
    });
  }

  return steps;
}

export function formatHandoffCompletedClock(completedAt: string | null): string | null {
  if (!completedAt) return null;
  const d = new Date(completedAt);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function hasHandoffContent(
  summary: OrderHandoffSummary | null | undefined,
  salesperson?: string | null,
): boolean {
  if (!summary) return false;
  return (
    buildHandoffScanSteps(summary, salesperson).length > 0 ||
    summary.changeCount > 0 ||
    formatHandoffDuration(summary.submittedAt, summary.completedAt) != null
  );
}

export function formatHandoffDuration(
  submittedAt: string | null,
  completedAt: string | null,
): string | null {
  if (!submittedAt || !completedAt) return null;
  const start = new Date(submittedAt).getTime();
  const end = new Date(completedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;

  const totalMins = Math.max(1, Math.round((end - start) / 60_000));
  if (totalMins < 60) return `${totalMins} min`;

  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

export function formatHandoffMetaLine(
  duration: string | null,
  completedClock: string | null,
): string | null {
  const parts = [duration, completedClock].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : null;
}

export function formatChangeCountLine(changeCount: number): string | null {
  if (changeCount <= 0) return null;
  const noun = changeCount === 1 ? 'change' : 'changes';
  return `${changeCount} bill ${noun} on file`;
}

/** @deprecated use buildHandoffScanSteps */
export type HandoffEntry = { key: string; label: string; name: string };
/** @deprecated */
export type HandoffPipelineStep = { key: string; shortLabel: string; name: string };
/** @deprecated */
export function buildHandoffEntries(summary: OrderHandoffSummary): HandoffEntry[] {
  return buildHandoffScanSteps(summary).map((s) => ({
    key: s.key,
    label: `${s.label} by`,
    name: s.name,
  }));
}
/** @deprecated */
export function buildHandoffPipeline(
  summary: OrderHandoffSummary,
  salesperson?: string | null,
): HandoffPipelineStep[] {
  return buildHandoffScanSteps(summary, salesperson).map((s) => ({
    key: s.key,
    shortLabel: s.label,
    name: s.name,
  }));
}
