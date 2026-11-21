import { MagnifyingGlass } from '@phosphor-icons/react';

export function OcrLabScanningScreen(): React.JSX.Element {
  return (
    <div className="relative flex h-full flex-col items-center justify-center overflow-hidden bg-[var(--bg-primary)] px-6 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--role-primary)] shadow-lg shadow-black/10">
        <MagnifyingGlass size={22} className="text-[var(--content-on-color)]" />
      </div>
      <h2 className="text-lg font-medium text-[var(--content-primary)]">Matching lines…</h2>
      <p className="mt-1 text-sm text-[var(--content-tertiary)]">Normalizing codes and ranking catalog candidates</p>
    </div>
  );
}
