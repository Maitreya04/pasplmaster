import { Warning } from '@phosphor-icons/react';
import { overTargetBannerText } from '../../lib/picking/pickerMicrocopy';

export interface OverTargetBannerProps {
  n: number;
  target: number;
  uom: string;
}

export function OverTargetBanner({ n, target, uom }: OverTargetBannerProps): React.JSX.Element {
  return (
    <div className="mx-3 mt-2 flex gap-2 rounded-lg border border-[var(--border-negative)] bg-[var(--bg-negative-subtle)] px-3 py-2 sm:mx-4">
      <Warning
        size={14}
        weight="fill"
        className="mt-0.5 shrink-0 text-[var(--content-negative)]"
        aria-hidden
      />
      <p className="text-xs leading-snug text-[var(--content-negative)]">
        {overTargetBannerText(n, target, uom)}
      </p>
    </div>
  );
}
