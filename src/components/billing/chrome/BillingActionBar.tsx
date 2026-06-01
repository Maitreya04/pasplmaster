import type { ReactNode } from 'react';
import { Copy, Warning } from '@phosphor-icons/react';
import { billingShell } from './billingShell';

interface BillingActionBarProps {
  left?: ReactNode;
  gateWarning?: string | null;
  primaryHint?: string | null;
  warningText?: string | null;
  primaryLabel: string;
  primaryDisabled?: boolean;
  primaryLoading?: boolean;
  onPrimary?: () => void;
  secondaryCopyLabel?: string;
  onSecondaryCopy?: () => void;
  secondaryCopyDisabled?: boolean;
  ghostLabel?: string;
  onGhostClick?: () => void;
  bare?: boolean;
}

export function BillingActionBar({
  left,
  gateWarning,
  primaryHint: _primaryHint,
  warningText: legacyWarning,
  primaryLabel,
  primaryDisabled = false,
  primaryLoading = false,
  onPrimary,
  secondaryCopyLabel,
  onSecondaryCopy,
  secondaryCopyDisabled = false,
  ghostLabel,
  onGhostClick,
  bare = false,
}: BillingActionBarProps): React.JSX.Element {
  const primaryBlocked = primaryDisabled || primaryLoading;
  const warningMessage = gateWarning ?? legacyWarning ?? null;

  const copyButton =
    secondaryCopyLabel && onSecondaryCopy ? (
      <button
        type="button"
        onClick={onSecondaryCopy}
        disabled={secondaryCopyDisabled}
        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg font-ds-caption-size border bg-[var(--bg-primary)] text-[var(--content-primary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-40 border-[var(--border-opaque)]"
      >
        <Copy size={14} weight="regular" />
        {secondaryCopyLabel}
      </button>
    ) : null;

  const ghostButton =
    ghostLabel && onGhostClick ? (
      <button
        type="button"
        onClick={onGhostClick}
        className="px-3 py-2 font-ds-caption-size text-[var(--content-secondary)] hover:bg-[var(--bg-tertiary)] rounded-md transition-colors"
      >
        {ghostLabel}
      </button>
    ) : null;

  return (
    <footer
      className={
        bare
          ? 'flex flex-wrap items-center justify-end gap-2 shrink-0'
          : `${billingShell.actions} justify-between`
      }
    >
      {!bare ? (
        <div className="flex items-center gap-2 min-w-0">
          {left}
          {copyButton}
          {ghostButton}
        </div>
      ) : null}

      <div className={`flex items-center gap-3 shrink-0 ${bare ? '' : 'ml-auto'}`}>
        {bare ? copyButton : null}
        {bare ? ghostButton : null}

        {warningMessage && primaryBlocked ? (
          <span
            className="inline-flex items-center gap-1 font-ds-caption-size text-[var(--content-warning-on-light)]"
            role="status"
          >
            <Warning size={13} weight="fill" />
            {warningMessage}
          </span>
        ) : null}

        {onPrimary ? (
          <button
            type="button"
            onClick={onPrimary}
            disabled={primaryBlocked}
            aria-disabled={primaryBlocked}
            className="px-4 py-2 rounded-lg font-ds-body-size font-semibold whitespace-nowrap transition-opacity"
            style={{
              background: 'var(--content-primary)',
              color: 'var(--bg-primary)',
              opacity: primaryBlocked ? 0.35 : 1,
              pointerEvents: primaryBlocked ? 'none' : 'auto',
              cursor: primaryBlocked ? 'default' : 'pointer',
            }}
          >
            {primaryLoading ? 'Working…' : primaryLabel}
          </button>
        ) : null}
      </div>
    </footer>
  );
}
