import type { Icon } from '@phosphor-icons/react';
import { BigButton } from './BigButton.tsx';

interface EmptyStateAction {
  label: string;
  onClick: () => void;
}

interface EmptyStateProps {
  icon: Icon;
  title: string;
  description?: string;
  action?: EmptyStateAction;
}

export function EmptyState({ icon: IconCmp, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <IconCmp size={48} weight="regular" className="text-[var(--content-disabled)] mb-4" />

      <h3 className="text-xl font-semibold text-[var(--content-primary)]">
        {title}
      </h3>

      {description && (
        <p className="mt-2 text-sm text-[var(--content-tertiary)] max-w-xs">
          {description}
        </p>
      )}

      {action && (
        <div className="mt-6 w-48">
          <BigButton variant="secondary" onClick={action.onClick}>
            {action.label}
          </BigButton>
        </div>
      )}
    </div>
  );
}
