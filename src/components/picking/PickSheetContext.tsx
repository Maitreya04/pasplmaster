/**
 * Compact line context so pickers always know which rack + item a sheet applies to.
 */
export interface PickSheetContextProps {
  partCode: string | null;
  rackNo: string | null;
  className?: string;
}

export function PickSheetContext({
  partCode,
  rackNo,
  className = '',
}: PickSheetContextProps): React.JSX.Element | null {
  if (!partCode && !rackNo) return null;

  return (
    <div
      className={`mb-3 flex min-w-0 items-center gap-2 rounded-xl border border-[var(--border-faint)] bg-[var(--bg-tertiary)] px-2.5 py-2 sm:mb-4 sm:px-3 sm:py-2.5 ${className}`}
    >
      {rackNo ? (
        <span className="shrink-0 rounded-md bg-[var(--bg-inverse-primary)] px-2 py-0.5 font-mono text-xs font-bold text-white">
          {rackNo}
        </span>
      ) : null}
      {partCode ? (
        <span className="min-w-0 truncate font-mono text-sm font-bold text-[var(--content-primary)]">
          {partCode}
        </span>
      ) : null}
    </div>
  );
}
