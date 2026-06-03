import { Check, Minus } from '@phosphor-icons/react';

interface BusyEntryCheckboxProps {
  entered: boolean;
  itemName: string;
  forceVisible?: boolean;
  onToggle: () => void;
}

/** Checklist control for busy entry — 16×16px checkbox with animated checkmark. */
export function BusyEntryCheckbox({
  entered,
  itemName,
  onToggle,
}: BusyEntryCheckboxProps): React.JSX.Element {
  const ariaLabel = entered
    ? `${itemName} entered in Busy — click to undo`
    : `Mark ${itemName} entered in Busy`;

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={entered}
      aria-label={ariaLabel}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className="group/chk relative flex items-center justify-center w-10 h-full shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-accent)] focus-visible:ring-offset-1"
      style={{
        background: 'transparent',
      }}
    >
      <span
        className={`flex size-4 items-center justify-center rounded transition-all duration-[120ms] ease-out ${
          entered
            ? 'opacity-100 bg-[var(--content-positive)] border-[var(--content-positive)] text-white'
            : 'opacity-100 border-[1.5px] border-[var(--border-opaque)] bg-[var(--bg-primary)] group-hover/chk:border-[var(--content-quaternary)] group-active/chk:scale-95'
        }`}
      >
        {entered ? <Check size={10} weight="bold" /> : null}
      </span>
    </button>
  );
}

interface BusyEntryMasterCheckboxProps {
  enteredCount: number;
  totalCount: number;
  onToggleAll?: () => void;
  className?: string;
}

export function BusyEntryMasterCheckbox({
  enteredCount,
  totalCount,
  onToggleAll,
  className = '',
}: BusyEntryMasterCheckboxProps): React.JSX.Element {
  const allEntered = totalCount > 0 && enteredCount >= totalCount;
  const partiallyEntered = enteredCount > 0 && !allEntered;

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={allEntered ? true : partiallyEntered ? 'mixed' : false}
      aria-label={
        allEntered
          ? 'Mark all billable items not entered'
          : 'Mark all billable items entered'
      }
      disabled={totalCount === 0 || !onToggleAll}
      onClick={(e) => {
        e.stopPropagation();
        onToggleAll?.();
      }}
      className={`flex h-7 w-10 items-center justify-center disabled:opacity-35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-accent)] focus-visible:ring-offset-1 ${className}`}
    >
      <span
        className={`flex size-4 items-center justify-center rounded border-[1.5px] transition-all ${
          allEntered || partiallyEntered
            ? 'border-[var(--content-positive)] bg-[var(--content-positive)] text-white'
            : 'border-[var(--border-opaque)] bg-[var(--bg-primary)]'
        }`}
      >
        {allEntered ? <Check size={10} weight="bold" /> : null}
        {partiallyEntered ? <Minus size={10} weight="bold" /> : null}
      </span>
    </button>
  );
}

interface BusyEntryCheckboxHeaderProps {
  enteredCount?: number;
  totalCount?: number;
  onToggleAll?: () => void;
}

export function BusyEntryCheckboxHeader({
  enteredCount = 0,
  totalCount = 0,
  onToggleAll,
}: BusyEntryCheckboxHeaderProps): React.JSX.Element {
  return (
    <th
      className="w-10 px-0 text-center"
      style={{
        padding: 0,
        width: '40px',
        minWidth: '40px',
        background: 'var(--bg-secondary)',
      }}
    >
      <BusyEntryMasterCheckbox
        enteredCount={enteredCount}
        totalCount={totalCount}
        onToggleAll={onToggleAll}
        className="mx-auto"
      />
    </th>
  );
}
