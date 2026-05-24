import { initialsFromName } from '../../lib/picking/pickQueueDisplay';

interface InitialsAvatarProps {
  name: string | null | undefined;
  size?: 'sm' | 'md';
  className?: string;
}

const SIZE_CLASSES = {
  sm: 'h-7 w-7 text-[10px]',
  md: 'h-9 w-9 text-xs',
} as const;

export function InitialsAvatar({
  name,
  size = 'md',
  className = '',
}: InitialsAvatarProps): React.JSX.Element {
  const initials = initialsFromName(name);

  return (
    <span
      className={`
        inline-flex shrink-0 items-center justify-center rounded-full
        bg-[var(--bg-accent-subtle)] text-[var(--content-accent)]
        font-semibold uppercase
        ${SIZE_CLASSES[size]}
        ${className}
      `}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}
