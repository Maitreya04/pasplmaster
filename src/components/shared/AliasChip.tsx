import type { ReactElement } from 'react';

/** Scan / pick code chip — Alias 1 (primary) or generic alias label. */
export function AliasChip({
  label,
  value,
  tone = 'primary',
}: {
  label: string;
  value: string;
  tone?: 'primary' | 'neutral';
}): ReactElement {
  const toneClass =
    tone === 'primary'
      ? {
          shell: 'border-[var(--bg-accent)] bg-[var(--bg-accent-subtle)]',
          label:
            'border-[color-mix(in_srgb,var(--bg-accent)_35%,transparent)] text-[var(--content-accent)]',
          value: 'text-[var(--content-primary)]',
        }
      : {
          shell: 'border-[var(--border-subtle)] bg-[var(--bg-primary)]',
          label: 'border-[var(--border-subtle)] text-[var(--content-tertiary)]',
          value: 'text-[var(--content-secondary)]',
        };

  return (
    <span
      className={`inline-flex min-w-0 max-w-full items-stretch overflow-hidden rounded-lg border text-[11px] leading-none ${toneClass.shell}`}
      title={`${label}: ${value}`}
    >
      <span
        className={`shrink-0 border-r px-1.5 py-1 font-sans font-bold uppercase tracking-[0.08em] ${toneClass.label}`}
      >
        {label}
      </span>
      <span className={`min-w-0 truncate px-2 py-1 font-mono font-semibold ${toneClass.value}`}>
        {value}
      </span>
    </span>
  );
}
