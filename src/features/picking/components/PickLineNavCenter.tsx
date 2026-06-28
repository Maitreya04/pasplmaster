import { ListBullets } from '@phosphor-icons/react';
import { usePickLineChipStrip } from '../lib/pickLineNav';
import { PickLineChipStrip, type PickLineChip } from './PickLineChipStrip';

export interface PickLineNavCenterProps {
  chips: PickLineChip[];
  currentIndex: number;
  totalLines: number;
  doneCount: number;
  onSelectLine: (index: number) => void;
  onSeeAllLines: () => void;
}

export function PickLineNavCenter({
  chips,
  currentIndex,
  totalLines,
  doneCount,
  onSelectLine,
  onSeeAllLines,
}: PickLineNavCenterProps): React.JSX.Element {
  const showChipStrip = usePickLineChipStrip(totalLines);
  const lineProgress = `Line ${currentIndex + 1} of ${totalLines}`;

  if (showChipStrip) {
    return (
      <PickLineChipStrip
        chips={chips}
        currentIndex={currentIndex}
        onSelectLine={onSelectLine}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={onSeeAllLines}
      className="pick-line-nav-compact pick-pressable min-w-0"
      aria-label={`${lineProgress}. ${doneCount} done. Open all lines.`}
    >
      <span className="pick-line-nav-compact-position font-ds-caption-size font-bold tabular-nums text-[var(--content-primary)]">
        {lineProgress}
      </span>
      <span className="pick-line-nav-compact-meta font-ds-micro tabular-nums text-[var(--content-tertiary)]">
        {doneCount} done · {totalLines - doneCount} left
      </span>
      <span className="pick-line-nav-compact-action mt-0.5 inline-flex items-center justify-center gap-1 font-ds-micro font-semibold text-[var(--role-primary)]">
        <ListBullets size={12} weight="bold" aria-hidden />
        All lines
      </span>
      <span
        className="pick-line-nav-compact-track mt-1.5"
        role="progressbar"
        aria-valuenow={currentIndex + 1}
        aria-valuemin={1}
        aria-valuemax={totalLines}
        aria-label={lineProgress}
      >
        <span
          className="pick-line-nav-compact-thumb"
          style={{ left: `${((currentIndex + 0.5) / totalLines) * 100}%` }}
        />
      </span>
    </button>
  );
}
