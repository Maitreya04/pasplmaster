import { useCallback } from 'react';
import { ReviewBillTable } from '../ReviewBillTable';
import { buildBusyPasteText } from '../../../lib/billing/sortBillLines';
import { useCopyToClipboard } from '../../../hooks/useCopyToClipboard';
import type { BillSheetEdits } from '../../../hooks/useBillSheetEdits';
import { BillingActionBar } from '../chrome/BillingActionBar';

interface PostPickReviewStageProps {
  billSheet: BillSheetEdits;
  flaggedMode?: boolean;
  onReadyToFinalise?: () => void;
  showCopyForBusy?: boolean;
  /** Archived / completed bill — table only, no finalise actions. */
  readOnly?: boolean;
}

export function PostPickReviewStage({
  billSheet,
  onReadyToFinalise,
  showCopyForBusy = true,
  readOnly = false,
}: PostPickReviewStageProps): React.JSX.Element {
  const { copy } = useCopyToClipboard();
  const { visibleItems, edits, unresolvedFlagged, allFlagsResolved } = billSheet;

  const copyForBusy = useCallback(() => {
    const billable = visibleItems.filter((item) => {
      const edit = edits[item.id];
      if (edit?.removed) return false;
      if (item.state === 'flagged' && edit?.resolution == null) return false;
      return true;
    });
    copy(buildBusyPasteText(billable, { lineEdits: edits }), 'busy-final');
  }, [visibleItems, edits, copy]);

  const unresolved = unresolvedFlagged.length;

  return (
    <div className="flex flex-col min-h-0">
      <div className="flex-1 min-h-0 overflow-y-auto p-2">
        <ReviewBillTable
          billSheet={billSheet}
          readOnly={readOnly}
          onCopyForBusy={showCopyForBusy ? copyForBusy : undefined}
        />
      </div>
      {!readOnly && onReadyToFinalise ? (
        <BillingActionBar
          warningText={
            unresolved > 0 ? `Resolve ${unresolved} edits to finalise` : null
          }
          primaryLabel="Ready to finalise"
          primaryDisabled={unresolved > 0 || !allFlagsResolved}
          onPrimary={onReadyToFinalise}
        />
      ) : null}
      {readOnly && showCopyForBusy ? (
        <BillingActionBar
          bare
          primaryLabel=""
          secondaryCopyLabel="Copy for Busy"
          onSecondaryCopy={copyForBusy}
        />
      ) : null}
    </div>
  );
}
