import { QueueSheet, type QueueSheetCounts, type QueueSheetRow } from '../../pages/picking/QueueSheet';

interface JumpListSheetProps {
  isOpen: boolean;
  onClose: () => void;
  rows: QueueSheetRow[];
  counts: QueueSheetCounts;
  currentItemId: number | null;
  onSkipItem: (itemId: number, reason: string) => void;
  onJump: (itemId: number) => void;
}

export function JumpListSheet({
  isOpen,
  onClose,
  rows,
  counts,
  currentItemId,
  onSkipItem,
  onJump,
}: JumpListSheetProps): React.JSX.Element | null {
  return (
    <QueueSheet
      isOpen={isOpen}
      onClose={onClose}
      rows={rows}
      counts={counts}
      currentItemId={currentItemId}
      onSkipItem={onSkipItem}
      onJump={onJump}
    />
  );
}
