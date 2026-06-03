import { User, Calendar, Truck, FileText, NotePencil, Package } from '@phosphor-icons/react';
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
  pickProgress?: { done: number; total: number; flagged: number };
  lineCount?: number;
  pendingCount?: number;
  flagSummary?: string | null;
  pickingNotStarted?: boolean;
  ewayNeeded?: boolean;
  completedAt?: string | null;
  onPickerClick?: () => void;
}

function SalesNoteIcon({ note }: { note: string }): React.JSX.Element {
  return (
    <button
      type="button"
      className="billing-context-icon-btn billing-context-icon-btn--warning group"
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
  package: Package,
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
    <span className="billing-context-fact">
      {Icon ? (
        <span className="billing-context-fact__icon-well" aria-hidden>
          <Icon size={15} weight="duotone" />
        </span>
      ) : null}
      <span className="billing-context-fact__body">
        {fact.label ? (
          <span className="billing-context-fact__label">{fact.label}</span>
        ) : null}
        <span className="billing-context-fact__value">
          <span className="tabular-nums">{fact.text}</span>
          {fact.secondaryText ? (
            <>
              <span className="billing-context-fact__sep" aria-hidden>
                ·
              </span>
              <span className="billing-context-fact__value-secondary">{fact.secondaryText}</span>
            </>
          ) : null}
        </span>
      </span>
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
        {slots.left.length > 0 && slots.center.length > 0 ? (
          <span className="billing-context-fact__rule" aria-hidden />
        ) : null}
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
