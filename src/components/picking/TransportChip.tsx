import { Truck } from '@phosphor-icons/react';

export function TransportChip({
  name,
  size = 'sm',
  className = '',
}: {
  name: string;
  size?: 'sm' | 'md';
  className?: string;
}): React.JSX.Element {
  const isMd = size === 'md';

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-lg border border-[var(--border-accent)] bg-[var(--bg-accent-subtle)] text-[var(--content-accent)] font-semibold max-w-full ${
        isMd ? 'px-2.5 py-1 text-xs' : 'px-2 py-0.5 text-[10px]'
      } ${className}`}
      title={`Dispatch via ${name}`}
    >
      <Truck size={isMd ? 14 : 12} weight="fill" className="shrink-0" />
      <span className="truncate">{name}</span>
    </span>
  );
}
