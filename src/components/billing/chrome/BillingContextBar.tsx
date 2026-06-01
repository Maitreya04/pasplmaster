import { User, Calendar, Truck, FileText } from '@phosphor-icons/react';
import { PickerAttributionChip } from '../../shared/AttributionChips';
import type { BillingOperatorStage } from '../../../lib/billing/deriveBillingOperatorStage';
import {
  deriveContextBarSlots,
  type ContextBarFact,
  type ContextBarIcon,
} from '../../../lib/billing/deriveContextBarContent';
import { billingShell } from './billingShell';

export interface BillingContextBarProps {
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
  onPickerClick?: () => void;
}

const ICONS: Record<ContextBarIcon, typeof User> = {
  user: User,
  calendar: Calendar,
  transport: Truck,
  document: FileText,
};

function pillClass(pill?: ContextBarFact['pill']): string {
  switch (pill) {
    case 'positive':
      return billingShell.metaPillPositive;
    case 'warning':
      return billingShell.metaPillWarning;
    case 'negative':
      return billingShell.metaPillNegative;
    default:
      return '';
  }
}

function ContextFact({ fact }: { fact: ContextBarFact }): React.JSX.Element {
  const Icon = fact.icon ? ICONS[fact.icon] : null;

  if (fact.pill) {
    return (
      <span className={pillClass(fact.pill)} aria-label={fact.text}>
        {fact.text}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-[3px] shrink-0 min-w-0">
      {Icon ? (
        <Icon size={15} className="text-[var(--content-secondary)] shrink-0" aria-hidden />
      ) : null}
      {fact.label ? (
        <span className="inline-flex items-baseline gap-1 min-w-0">
          <span className="font-ds-micro font-semibold uppercase text-[var(--content-quaternary)] tracking-normal shrink-0">
            {fact.label}
          </span>
          <span className="font-ds-body-size font-medium text-[var(--content-primary)] truncate">
            {fact.text}
          </span>
        </span>
      ) : (
        <span className="font-ds-body-size font-medium text-[var(--content-primary)] truncate">
          {fact.text}
        </span>
      )}
    </span>
  );
}

export function BillingContextBar(props: BillingContextBarProps): React.JSX.Element {
  const slots = deriveContextBarSlots(props);
  const barClass = slots.urgentTint ? billingShell.contextUrgent : billingShell.context;

  return (
    <div className={barClass}>
      <div className="flex items-center gap-3 min-w-0 overflow-hidden">
        {slots.left.map((fact) => (
          <ContextFact key={fact.key} fact={fact} />
        ))}
        {slots.center.map((fact) => (
          <ContextFact key={fact.key} fact={fact} />
        ))}
      </div>

      <div className="flex items-center gap-3 shrink-0">
        {slots.right.map((fact) => (
          <ContextFact key={fact.key} fact={fact} />
        ))}

        {slots.showPicker && props.pickerName ? (
          <button
            type="button"
            onClick={props.onPickerClick}
            className="shrink-0 inline-flex items-center rounded-md px-1 py-0.5 hover:bg-[var(--bg-tertiary)]"
          >
            <PickerAttributionChip name={props.pickerName} active={slots.pickerActive} />
          </button>
        ) : null}

        {props.stage === 'review_finalise' && props.reviewerName ? (
          <span className="font-ds-caption-size text-[var(--content-secondary)] shrink-0">
            {props.reviewerName}
          </span>
        ) : null}
      </div>
    </div>
  );
}
