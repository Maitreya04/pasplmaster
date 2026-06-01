import type { BillingOperatorStage } from './deriveBillingOperatorStage';
import { isOrderAgeUrgent } from './orderAgeTier';

export type ContextBarIcon = 'user' | 'calendar' | 'transport' | 'document';

export interface ContextBarFact {
  key: string;
  icon?: ContextBarIcon;
  label?: string;
  text: string;
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
  lineCount?: number;
  pendingCount?: number;
  flagSummary?: string | null;
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

function busyProgressFact(
  busyProgress: { entered: number; total: number },
): ContextBarFact {
  const complete =
    busyProgress.total > 0 && busyProgress.entered >= busyProgress.total;
  return {
    key: 'busy-progress',
    text: complete
      ? `All ${busyProgress.total} entered`
      : `${busyProgress.entered} of ${busyProgress.total} entered`,
    pill: complete ? 'positive' : 'warning',
  };
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
          label: 'Arrived',
          text: formatShortDateLabel(input.createdAt),
        });
      }
      right.push({
        key: 'transport',
        icon: 'transport',
        label: 'Transport',
        text: transportShortLabel(input),
      });
      if (input.busyProgress) {
        center.push(busyProgressFact(input.busyProgress));
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
          label: 'Arrived',
          text: formatShortDateLabel(input.createdAt),
        });
      }
      const lines = lineCountFact(input.lineCount, input.pendingCount);
      if (lines) right.push(lines);
      break;
    }
    case 'picking': {
      if (input.createdAt) {
        left.push({
          key: 'created',
          icon: 'calendar',
          label: 'Arrived',
          text: formatShortDateLabel(input.createdAt),
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

function formatShortDateLabel(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}
