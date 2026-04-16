import { MagicWand } from '@phosphor-icons/react';
import type { LoadedOcrImage } from './types';

export function OcrLabScanningScreen({
  image,
}: {
  image: LoadedOcrImage | null;
}): React.JSX.Element {
  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-[var(--bg-primary)]">
      <div className="absolute inset-4 bottom-28 top-20 overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] shadow-xl">
        {image ? (
          <div className="flex h-full w-full items-center justify-center bg-[var(--bg-primary)] p-3">
            <img src={image.previewUrl} alt={image.name} className="max-h-full max-w-full object-contain opacity-85" />
          </div>
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-[var(--bg-tertiary)] text-[var(--content-quaternary)]" />
        )}
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(15,23,42,0.04),rgba(15,23,42,0.12),rgba(15,23,42,0.04))]" />
      </div>

      <div className="absolute left-0 right-0 top-[18%] z-20 h-1 animate-pulse bg-[var(--role-primary)] shadow-[0_0_18px_6px_rgba(15,23,42,0.18)]" />

      <div className="absolute bottom-12 left-0 right-0 z-30 flex flex-col items-center">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--role-primary)] shadow-lg shadow-black/10">
          <MagicWand size={22} className="text-[var(--content-on-color)]" />
        </div>
        <h2 className="text-lg font-medium text-[var(--content-primary)]">Analyzing handwriting…</h2>
        <p className="mt-1 text-sm text-[var(--content-tertiary)]">Extracting customer, parts, and quantities</p>
      </div>
    </div>
  );
}
