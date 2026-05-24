import { QueueSheet, type QueueSheetCounts, type QueueSheetRow } from '../../pages/picking/QueueSheet';

interface JumpListSheetProps {
  isOpen: boolean;
  onClose: () => void;
  rows: QueueSheetRow[];
  counts: QueueSheetCounts;
  currentItemId: number | null;
  transportName?: string | null;
  customerName?: string | null;
  billedAt?: string | null;
  orderNumber?: string | null;
  onSkipItem: (itemId: number, reason: string) => void;
  onJump: (itemId: number) => void;
  onCompleteItem?: (itemId: number) => void;
}

export function JumpListSheet({
  isOpen,
  onClose,
  rows,
  counts,
  currentItemId,
  transportName,
  customerName,
  billedAt,
  orderNumber,
  onSkipItem,
  onJump,
  onCompleteItem,
}: JumpListSheetProps): React.JSX.Element | null {
  return (
    <QueueSheet
      isOpen={isOpen}
      onClose={onClose}
      rows={rows}
      counts={counts}
      currentItemId={currentItemId}
      transportName={transportName}
      customerName={customerName}
      billedAt={billedAt}
      orderNumber={orderNumber}
      onSkipItem={onSkipItem}
      onJump={onJump}
      onCompleteItem={onCompleteItem}
    />
  );
}
