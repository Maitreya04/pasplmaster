import { Check, Copy } from '@phosphor-icons/react';

interface CopyAllItemsButtonProps {
  disabled?: boolean;
  onClick: () => void;
  /** Flash green confirmation while clipboard write succeeded. */
  justCopied?: boolean;
  /** After first successful copy, invite a re-copy. */
  copyAgain?: boolean;
  /** Match primary dock CTA height and padding. */
  size?: 'default' | 'cta';
  /** Idle label before first copy (default: Copy all items). */
  label?: string;
}

export function CopyAllItemsButton({
  disabled = false,
  onClick,
  justCopied = false,
  copyAgain = false,
  size = 'default',
  label: idleLabel = 'Copy all items',
}: CopyAllItemsButtonProps): React.JSX.Element {
  const isCta = size === 'cta';

  const label = justCopied ? 'Copied!' : copyAgain ? 'Copy again' : idleLabel;
  const Icon = justCopied ? Check : Copy;

  if (isCta) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-live="polite"
        className={`billing-busy-dock__secondary inline-flex items-center justify-center gap-1.5${
          justCopied ? ' billing-busy-dock__secondary--copied' : ''
        }`}
      >
        <Icon size={16} weight={justCopied ? 'bold' : 'regular'} />
        {label}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-live="polite"
      className="inline-flex items-center gap-1.5 rounded-md border border-[var(--content-primary)] bg-[var(--content-primary)] font-semibold text-[var(--bg-primary)] transition-colors hover:opacity-90 disabled:opacity-40 h-8 px-3 font-ds-caption-size"
      style={{ borderWidth: '0.5px' }}
    >
      <Icon size={14} weight={justCopied ? 'bold' : 'regular'} />
      {label}
    </button>
  );
}
