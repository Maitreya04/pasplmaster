import { type ReactNode } from 'react';
import { CaretLeft } from '@phosphor-icons/react';

interface PageHeaderProps {
  title: string;
  onBack?: () => void;
  action?: ReactNode;
  /** Tailwind top offset when another sticky bar sits above (e.g. billing "on behalf of" banner). */
  stickyTopClassName?: string;
}

export function PageHeader({
  title,
  onBack,
  action,
  stickyTopClassName = 'top-0',
}: PageHeaderProps): React.JSX.Element | null {
  return (
    <header
      className={`
        sticky ${stickyTopClassName} z-40 h-11
        flex items-center justify-between px-4
        bg-[var(--bg-primary)] border-b border-[var(--border-subtle)]
      `}
    >
      <div className="w-12 flex items-center">
        {onBack && (
          <button
            onClick={onBack}
            className="
              -ml-2 min-h-12 min-w-12
              flex items-center justify-center
              rounded-lg text-[var(--content-secondary)]
              hover:bg-[var(--bg-tertiary)] transition-colors duration-150
            "
            aria-label="Go back"
          >
            <CaretLeft size={24} weight="bold" />
          </button>
        )}
      </div>

      <h1 className="text-lg font-semibold text-[var(--content-primary)] truncate text-center flex-1">
        {title}
      </h1>

      <div className="w-12 flex items-center justify-end">
        {action}
      </div>
    </header>
  );
}
