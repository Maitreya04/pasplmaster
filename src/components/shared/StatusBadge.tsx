type Status =
  | 'submitted'
  | 'approved'
  | 'picking'
  | 'completed'
  | 'dispatched'
  | 'flagged'
  | 'urgent';

interface StatusBadgeProps {
  status: Status;
  className?: string;
}

interface StatusStyle {
  label: string;
  dot: string;
  text: string;
  bg: string;
}

const statusConfig: Record<Status, StatusStyle> = {
  submitted: {
    label: 'Submitted',
    dot: 'bg-[var(--content-accent)]',
    text: 'text-[var(--content-accent)]',
    bg: 'bg-[var(--bg-accent-subtle)]',
  },
  approved: {
    label: 'Approved',
    dot: 'bg-[var(--content-positive)]',
    text: 'text-[var(--content-positive)]',
    bg: 'bg-[var(--bg-positive-subtle)]',
  },
  picking: {
    label: 'Picking',
    dot: 'bg-[var(--content-warning)]',
    text: 'text-[var(--content-warning)]',
    bg: 'bg-[var(--bg-warning-subtle)]',
  },
  completed: {
    label: 'Completed',
    dot: 'bg-[var(--content-positive)]',
    text: 'text-[var(--content-positive)]',
    bg: 'bg-[var(--bg-positive-subtle)]',
  },
  dispatched: {
    label: 'Dispatched',
    dot: 'bg-[var(--content-tertiary)]',
    text: 'text-[var(--content-tertiary)]',
    bg: 'bg-[var(--bg-tertiary)]',
  },
  flagged: {
    label: 'Flagged',
    dot: 'bg-[var(--content-negative)]',
    text: 'text-[var(--content-negative)]',
    bg: 'bg-[var(--bg-negative-subtle)]',
  },
  urgent: {
    label: 'Urgent',
    dot: 'bg-[var(--bg-negative)] animate-pulse',
    text: 'text-[var(--content-on-color)]',
    bg: 'bg-[var(--bg-negative)]',
  },
};

export function StatusBadge({ status, className = '' }: StatusBadgeProps) {
  const config = statusConfig[status];
  const isUrgent = status === 'urgent';

  return (
    <span
      className={`
        inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full
        text-xs font-semibold
        ${config.bg} ${config.text}
        ${isUrgent ? 'animate-pulse' : ''}
        ${className}
      `}
    >
      {!isUrgent && (
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${config.dot}`} />
      )}
      {config.label}
    </span>
  );
}
