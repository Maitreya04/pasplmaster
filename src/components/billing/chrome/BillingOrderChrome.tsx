import type { ReactNode } from 'react';
import type { PickLineProgress } from '../../../lib/cartSupply';
import type { BillingOperatorStage } from '../../../lib/billing/deriveBillingOperatorStage';
import { BillingNavBar } from './BillingNavBar';
import { BillingContextBar } from './BillingContextBar';
import { BillingStageBar } from './BillingStageBar';
import type { BillingSummaryStat, BillingSummaryChip } from './BillingSummaryBar';
import { BillingSummaryBar } from './BillingSummaryBar';
import { OrderHandoffRow } from './OrderHandoffRow';
import type { OrderHandoffSummary } from '../../../lib/billing/orderHandoffFromEvents';
import { hasHandoffContent } from '../../../lib/billing/orderHandoffFromEvents';

export interface BillingOrderContext {
  customerName?: string;
  salesperson: string | null;
  createdAt?: string | null;
  pickerName?: string | null;
  transportName?: string | null;
  carrierName?: string | null;
  salesNote?: string | null;
  deadline?: string | null;
  reviewerName?: string | null;
  priority?: string;
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

interface BillingOrderChromeProps {
  stage: BillingOperatorStage;
  embedded?: boolean;
  editCount?: number;
  openFlagCount?: number;
  allLinesRemoved?: boolean;
  checkerPending?: boolean;
  skipWarehousePick?: boolean;
  pickProgress?: PickLineProgress;
  /** Custom header slot (replaces nav bar if provided). */
  header?: ReactNode;
  /** Bill header component. */
  billHeader?: ReactNode;
  /** When bill header includes subline facts, skip the separate context band. */
  suppressContextBar?: boolean;
  /** Show the nav bar with back/reject. */
  showNavBar?: boolean;
  onBack?: () => void;
  onReject?: () => void;
  rejectDisabled?: boolean;
  context: BillingOrderContext;
  handoffSummary?: OrderHandoffSummary | null;
  summaryStats?: BillingSummaryStat[];
  summaryChips?: BillingSummaryChip[];
  summaryRight?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function BillingOrderChrome({
  stage,
  embedded = false,
  editCount,
  openFlagCount = 0,
  allLinesRemoved = false,
  checkerPending = false,
  skipWarehousePick = false,
  pickProgress,
  header,
  billHeader,
  suppressContextBar = false,
  showNavBar = false,
  onBack,
  onReject,
  rejectDisabled = false,
  context,
  handoffSummary,
  summaryStats,
  summaryChips,
  summaryRight,
  actions,
  children,
  className = '',
}: BillingOrderChromeProps): React.JSX.Element {
  const hasSummary =
    (summaryStats && summaryStats.length > 0) || (summaryChips && summaryChips.length > 0);

  const resolvedCheckerPending =
    checkerPending || (stage === 'review_finalise' && !context.reviewerName);

  const showHandoffBand =
    (stage === 'review_finalise' || stage === 'done') &&
    handoffSummary != null &&
    hasHandoffContent(handoffSummary, context.salesperson);
  const hideContextForUnifiedHandoff = showHandoffBand && stage === 'done';

  return (
    <div
      className={`@container/billing-order density-billing-work flex flex-col min-h-0 flex-1 bg-[var(--bg-secondary)] ${className}`}
    >
      {header ? (
        <div className="shrink-0 bg-[var(--bg-secondary)]">{header}</div>
      ) : showNavBar ? (
        <BillingNavBar onBack={onBack} onReject={onReject} rejectDisabled={rejectDisabled} />
      ) : null}

      {billHeader ? <div className="shrink-0">{billHeader}</div> : null}

      <BillingStageBar
        stage={stage}
        editCount={editCount}
        compact={embedded}
        busyProgress={context.busyProgress}
        openFlagCount={openFlagCount}
        allLinesRemoved={allLinesRemoved}
        checkerPending={resolvedCheckerPending}
        skipWarehousePick={skipWarehousePick}
        pickProgress={pickProgress}
      />

      {!suppressContextBar && !hideContextForUnifiedHandoff ? (
        <BillingContextBar
          stage={stage}
          salesperson={context.salesperson}
          createdAt={context.createdAt}
          transportName={context.transportName}
          carrierName={context.carrierName}
          salesNote={context.salesNote}
          deadline={context.deadline}
          pickerName={context.pickerName}
          reviewerName={context.reviewerName}
          busyProgress={context.busyProgress}
          pickProgress={context.pickProgress}
          lineCount={context.lineCount}
          pendingCount={context.pendingCount}
          flagSummary={context.flagSummary}
          pickingNotStarted={context.pickingNotStarted}
          ewayNeeded={context.ewayNeeded}
          completedAt={context.completedAt}
          onPickerClick={context.onPickerClick}
        />
      ) : null}

      {showHandoffBand ? (
        <OrderHandoffRow
          summary={handoffSummary}
          salesperson={context.salesperson}
        />
      ) : null}

      <div className="flex-1 min-h-0 overflow-y-auto bg-[var(--bg-secondary)]">
        {children}
      </div>

      {hasSummary && (
        <BillingSummaryBar
          stats={summaryStats ?? []}
          chips={summaryChips}
          rightSlot={summaryRight}
        />
      )}

      {actions ? <div className="shrink-0">{actions}</div> : null}
    </div>
  );
}
