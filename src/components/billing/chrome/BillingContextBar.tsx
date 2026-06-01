import { User, Calendar, Truck, FileText, NotePencil } from '@phosphor-icons/react';
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
  salesNote?: string | null;
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

function SalesNoteIcon({ note }: { note: string }): React.JSX.Element {
  return (
    <button
      type="button"
      className="group relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--border-warning)] bg-[var(--bg-warning-subtle)] text-[var(--content-warning-on-light)] transition-colors hover:bg-[var(--bg-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-warning)]"
      style={{ borderWidth: '0.5px' }}
      aria-label="Sales note"
    >
      <NotePencil size={15} weight="bold" aria-hidden />
      <span className="pointer-events-none absolute right-0 top-full z-50 mt-2 hidden w-[min(28rem,70vw)] max-h-40 overflow-y-auto rounded-lg border border-[var(--border-opaque)] bg-[var(--bg-primary)] px-3 py-2 text-left shadow-lg group-hover:block group-focus-visible:block">
        <span className="mb-1 block font-ds-micro font-semibold uppercase text-[var(--content-quaternary)]">
          Sales note
        </span>
        <span className="block whitespace-pre-wrap font-ds-caption-size font-medium leading-snug text-[var(--content-primary)]">
          {note}
        </span>
      </span>
    </button>
  );
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
        {props.salesNote?.trim() ? (
          <SalesNoteIcon note={props.salesNote.trim()} />
        ) : null}

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
