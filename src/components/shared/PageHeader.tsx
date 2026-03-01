import { type ReactNode } from 'react';
import { CaretLeft } from '@phosphor-icons/react';

interface PageHeaderProps {
  title: string;
  onBack?: () => void;
  action?: ReactNode;
}

export function PageHeader({ title, onBack, action }: PageHeaderProps) {
  return (
    <header
      className="
        sticky top-0 z-40 h-14
        flex items-center justify-between px-4
        bg-[var(--bg-primary)]/80 backdrop-blur-md
      "
    >
      <div className="w-12 flex items-center">
        {onBack && (
          <button
            onClick={onBack}
            className="
              -ml-2 min-h-[48px] min-w-[48px]
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
