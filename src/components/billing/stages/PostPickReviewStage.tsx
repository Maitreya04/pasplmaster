import { ReviewBillTable } from '../ReviewBillTable';
import type { BillSheetEdits } from '../../../hooks/useBillSheetEdits';

interface PostPickReviewStageProps {
  billSheet: BillSheetEdits;
  flaggedMode?: boolean;
  /** Archived / completed bill — table only, no finalise actions. */
  readOnly?: boolean;
}

export function PostPickReviewStage({
  billSheet,
  readOnly = false,
}: PostPickReviewStageProps): React.JSX.Element {
  return (
    <div className="flex flex-col min-h-0">
      <div className="flex-1 min-h-0 overflow-y-auto p-2">
        <ReviewBillTable billSheet={billSheet} readOnly={readOnly} />
      </div>
    </div>
  );
}
