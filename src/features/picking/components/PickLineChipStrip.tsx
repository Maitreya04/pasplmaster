import { useEffect, useRef } from 'react';
import { CheckCircle, Circle, Flag, Minus } from '@phosphor-icons/react';

export type PickLineChipStatus =
  | 'pending'
  | 'now'
  | 'partial'
  | 'picked'
  | 'flagged';

export interface PickLineChip {
  index: number;
  status: PickLineChipStatus;
}

export interface PickLineChipStripProps {
  chips: PickLineChip[];
  currentIndex: number;
  onSelectLine: (index: number) => void;
}

function ChipIcon({ status }: { status: PickLineChipStatus }): React.JSX.Element | null {
  switch (status) {
    case 'picked':
      return <CheckCircle size={11} weight="fill" className="text-[var(--content-positive)]" />;
    case 'partial':
      return <Minus size={10} weight="bold" className="text-[var(--content-warning-on-light)]" />;
    case 'flagged':
      return <Flag size={10} weight="fill" className="text-[var(--content-negative)]" />;
    case 'now':
      return null;
    default:
      return <Circle size={8} weight="regular" className="text-[var(--content-quaternary)]" />;
  }
}

export function PickLineChipStrip({
  chips,
  currentIndex,
  onSelectLine,
}: PickLineChipStripProps): React.JSX.Element {
  const stripRef = useRef<HTMLDivElement>(null);
  const currentRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    currentRef.current?.scrollIntoView({
      inline: 'center',
      block: 'nearest',
      behavior: 'smooth',
    });
  }, [currentIndex]);

  return (
    <div ref={stripRef} className="pick-line-chip-strip" role="tablist" aria-label="Pick lines">
      {chips.map((chip) => {
        const isCurrent = chip.index === currentIndex;
        const statusClass =
          chip.status === 'picked'
            ? 'pick-line-chip--picked'
            : chip.status === 'partial'
              ? 'pick-line-chip--partial'
              : chip.status === 'flagged'
                ? 'pick-line-chip--flagged'
                : isCurrent
                  ? 'pick-line-chip--current'
                  : '';

        return (
          <button
            key={chip.index}
            ref={isCurrent ? currentRef : undefined}
            type="button"
            role="tab"
            aria-selected={isCurrent}
            aria-label={`Line ${chip.index + 1}${isCurrent ? ', current' : ''}`}
            onClick={() => onSelectLine(chip.index)}
            className={`pick-line-chip pick-pressable ${statusClass}`}
          >
            <ChipIcon status={isCurrent ? 'now' : chip.status} />
            <span>{chip.index + 1}</span>
          </button>
        );
      })}
    </div>
  );
}
