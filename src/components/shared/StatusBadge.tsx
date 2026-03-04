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
  border: string;
}

const statusConfig: Record<Status, StatusStyle> = {
  submitted: {
    label: 'Submitted',
    dot: 'bg-[var(--content-accent)]',
    text: 'text-[var(--content-accent)]',
    bg: 'bg-[var(--bg-accent-subtle)]',
    border: 'border-[var(--border-accent)]',
  },
  approved: {
    label: 'Approved',
    dot: 'bg-[var(--content-positive)]',
    text: 'text-[var(--content-positive)]',
    bg: 'bg-[var(--bg-positive-subtle)]',
    border: 'border-[var(--border-positive)]',
  },
  picking: {
    label: 'Picking',
    dot: 'bg-[var(--content-warning)]',
    text: 'text-[var(--content-warning)]',
    bg: 'bg-[var(--bg-warning-subtle)]',
    border: 'border-[var(--border-warning)]',
  },
  completed: {
    label: 'Completed',
    dot: 'bg-[var(--content-positive)]',
    text: 'text-[var(--content-positive)]',
    bg: 'bg-[var(--bg-positive-subtle)]',
    border: 'border-[var(--border-positive)]',
  },
  dispatched: {
    label: 'Dispatched',
    dot: 'bg-[var(--content-accent)]',
    text: 'text-[var(--content-accent)]',
    bg: 'bg-[var(--bg-accent-subtle)]',
    border: 'border-[var(--border-accent)]',
  },
  flagged: {
    label: 'Flagged',
    dot: 'bg-[var(--bg-negative)]',
    text: 'text-[var(--bg-negative)]',
    bg: 'bg-[var(--bg-negative-subtle)]',
    border: 'border-[var(--border-negative)]',
  },
  urgent: {
    label: 'Urgent',
    dot: '',
    text: 'text-[var(--content-on-color)]',
    bg: 'bg-[var(--bg-negative)]',
    border: 'border-transparent',
  },
};

export function StatusBadge({ status, className = '' }: StatusBadgeProps) {
  const config = statusConfig[status];
  const isUrgent = status === 'urgent';

  return (
    <span
      className={`
        inline-flex items-center h-6 rounded-full
        text-xs font-semibold leading-none
        border
        ${isUrgent ? 'gap-0 px-3' : 'gap-1.5 pl-2 pr-3'}
        ${config.bg} ${config.text} ${config.border}
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
