export interface PickOrderProgressBarProps {
  doneCount: number;
  totalCount: number;
  onPress?: () => void;
}

export function PickOrderProgressBar({
  doneCount,
  totalCount,
  onPress,
}: PickOrderProgressBarProps): React.JSX.Element {
  const pct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;
  const label = `${doneCount} of ${totalCount} line${totalCount === 1 ? '' : 's'} done`;

  const bar = (
    <>
      <div
        className="pick-order-progress-track"
        role="progressbar"
        aria-valuenow={doneCount}
        aria-valuemin={0}
        aria-valuemax={totalCount}
        aria-label={label}
      >
        <div className="pick-order-progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <p className="pick-order-progress-label">{label}</p>
    </>
  );

  if (onPress) {
    return (
      <button
        type="button"
        onClick={onPress}
        className="pick-order-progress pick-pressable w-full text-left"
        aria-label={`${label}. Open line list.`}
      >
        {bar}
      </button>
    );
  }

  return <div className="pick-order-progress">{bar}</div>;
}
