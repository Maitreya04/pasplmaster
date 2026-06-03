import type { BillingOperatorStage } from './deriveBillingOperatorStage';
import { isOrderAgeUrgent } from './orderAgeTier';

export type ContextBarIcon = 'user' | 'calendar' | 'transport' | 'document' | 'package';

export interface ContextBarFact {
  key: string;
  icon?: ContextBarIcon;
  label?: string;
  text: string;
  /** Muted suffix on the value line — e.g. "2 pending". */
  secondaryText?: string;
  pill?: 'positive' | 'warning' | 'negative';
}

export interface ContextBarInput {
  stage: BillingOperatorStage;
  salesperson: string | null;
  createdAt?: string | null;
  transportName?: string | null;
  carrierName?: string | null;
  deadline?: string | null;
  pickerName?: string | null;
  reviewerName?: string | null;
  busyProgress?: { entered: number; total: number };
  pickProgress?: { done: number; total: number; flagged: number };
  lineCount?: number;
  pendingCount?: number;
  flagSummary?: string | null;
  pickingNotStarted?: boolean;
  ewayNeeded?: boolean;
  completedAt?: string | null;
}

export interface ContextBarSlots {
  urgentTint: boolean;
  left: ContextBarFact[];
  center: ContextBarFact[];
  right: ContextBarFact[];
  showPicker: boolean;
  pickerActive: boolean;
}

function transportLabel(input: ContextBarInput): string | null {
  if (!input.transportName) return null;
  const carrier = input.carrierName?.trim();
  const base = carrier ? `${input.transportName} · ${carrier}` : input.transportName;
  if (input.deadline) return `${base} · ${input.deadline}`;
  return `${base} · no deadline set`;
}

function transportShortLabel(input: ContextBarInput): string {
  if (!input.transportName) return 'Local';
  const carrier = input.carrierName?.trim();
  return carrier ? `${input.transportName} · ${carrier}` : input.transportName;
}

function lineCountFact(lineCount?: number, pendingCount?: number): ContextBarFact | null {
  if (lineCount == null) return null;
  const pending =
    pendingCount != null && pendingCount > 0 ? ` · ${pendingCount} pending` : '';
  return {
    key: 'line-count',
    text: `${lineCount} lines${pending}`,
  };
}

function itemCountFact(lineCount?: number, pendingCount?: number): ContextBarFact | null {
  if (lineCount == null) return null;
  return {
    key: 'item-count',
    icon: 'package',
    label: 'Items',
    text: String(lineCount),
    secondaryText:
      pendingCount != null && pendingCount > 0 ? `${pendingCount} pending` : undefined,
  };
}

function formatCompletedTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'Completed';
  const time = d.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `Completed ${time}`;
}

function formatSubmittedLabel(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const date = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
  });
  return `${date}, ${time}`;
}

export function deriveContextBarSlots(input: ContextBarInput): ContextBarSlots {
  const urgentTint = input.createdAt ? isOrderAgeUrgent(input.createdAt) : false;
  const left: ContextBarFact[] = [];
  const center: ContextBarFact[] = [];
  const right: ContextBarFact[] = [];

  if (input.salesperson) {
    left.push({ key: 'salesperson', icon: 'user', label: 'Sales', text: input.salesperson });
  }

  let showPicker = false;
  let pickerActive = false;

  switch (input.stage) {
    case 'busy_entry': {
      if (input.createdAt) {
        left.push({
          key: 'created',
          icon: 'calendar',
          label: 'Submitted',
          text: formatSubmittedLabel(input.createdAt),
        });
      }
      right.push({
        key: 'transport',
        icon: 'transport',
        label: 'Transport',
        text: transportShortLabel(input),
      });
      {
        const lines = itemCountFact(input.lineCount, input.pendingCount);
        if (lines) right.push(lines);
      }
      break;
    }
    case 'assign_picker': {
      const transport = transportLabel(input);
      if (transport) {
        left.push({ key: 'transport', icon: 'transport', text: transport });
      } else if (input.createdAt) {
        left.push({
          key: 'created',
          icon: 'calendar',
          label: 'Submitted',
          text: formatSubmittedLabel(input.createdAt),
        });
      }
      const lines = lineCountFact(input.lineCount, input.pendingCount);
      if (lines) right.push(lines);
      break;
    }
    case 'picking': {
      if (input.flagSummary) {
        center.push({
          key: 'flags',
          text: input.flagSummary,
          pill: 'warning',
        });
      } else if (input.pickingNotStarted) {
        center.push({
          key: 'pick-wait',
          text: 'Waiting for picker to start',
          pill: 'warning',
        });
      } else if (input.pickProgress && input.pickProgress.total > 0) {
        center.push({
          key: 'pick-progress',
          text: `${input.pickProgress.done}/${input.pickProgress.total} lines picked`,
        });
      }
      showPicker = Boolean(input.pickerName);
      pickerActive = true;
      break;
    }
    case 'resolve_flags': {
      if (input.flagSummary) {
        center.push({
          key: 'flags',
          text: input.flagSummary,
          pill: 'warning',
        });
      }
      showPicker = Boolean(input.pickerName);
      break;
    }
    case 'review_finalise': {
      if (input.ewayNeeded) {
        left.push({
          key: 'eway',
          icon: 'document',
          text: 'E-way needed',
          pill: 'warning',
        });
      }
      showPicker = Boolean(input.pickerName);
      break;
    }
    case 'done': {
      if (input.completedAt) {
        right.push({
          key: 'completed',
          text: formatCompletedTime(input.completedAt),
          pill: 'positive',
        });
      }
      break;
    }
    default:
      break;
  }

  return { urgentTint, left, center, right, showPicker, pickerActive };
}
