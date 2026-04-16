import { ArrowLeft, Camera, ImageSquare, MagicWand } from '@phosphor-icons/react';
import type { LoadedOcrImage } from './types';

export function OcrLabUploadScreen({
  image,
  customerId,
  catalogReady,
  onBack,
  onCustomerIdChange,
  onFileChange,
  onScan,
}: {
  image: LoadedOcrImage | null;
  customerId: string;
  catalogReady: boolean;
  onBack: () => void;
  onCustomerIdChange: (value: string) => void;
  onFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onScan: () => void;
}): React.JSX.Element {
  return (
    <div className="flex h-full flex-col bg-[var(--bg-primary)]">
      <div className="flex items-center border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-4">
        <button onClick={onBack} className="-ml-2 rounded-full p-2 text-[var(--content-secondary)] hover:bg-[var(--bg-tertiary)]">
          <ArrowLeft size={20} />
        </button>
        <h1 className="ml-2 text-base font-semibold text-[var(--content-primary)]">New Order Scan</h1>
      </div>

      <div className="flex flex-1 flex-col p-5">
        <p className="mb-4 text-sm text-[var(--content-secondary)]">
          Upload a handwritten order photo from WhatsApp to stage extraction, matching, and review.
        </p>

        <div className="flex-1 rounded-2xl border-2 border-dashed border-[var(--border-opaque)] bg-[var(--bg-tertiary)] p-4">
          <div className="flex h-full flex-col items-center justify-center rounded-xl bg-[var(--bg-secondary)] p-6 text-center shadow-sm">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--role-primary-subtle)] text-[var(--role-content)]">
              <ImageSquare size={28} />
            </div>
            <p className="mt-4 text-sm font-semibold text-[var(--content-primary)]">
              {image ? image.name : 'Choose a WhatsApp order image'}
            </p>
            <p className="mt-1 text-xs text-[var(--content-tertiary)]">
              {image ? `${image.mimeType} • ${image.width}×${image.height}` : 'JPG, PNG, or pasted screenshot'}
            </p>
            <input
              type="file"
              accept="image/*"
              onChange={onFileChange}
              className="mt-4 block w-full text-sm text-[var(--content-tertiary)]"
            />
            {image ? (
              <div className="mt-4 flex h-40 w-full items-center justify-center overflow-auto rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-2">
                <img
                  src={image.previewUrl}
                  alt={image.name}
                  className="max-h-full w-full rounded-xl object-contain"
                />
              </div>
            ) : (
              <div className="mt-4 flex h-36 w-full items-center justify-center rounded-2xl bg-[var(--bg-tertiary)] text-[var(--content-quaternary)]">
                <Camera size={28} />
              </div>
            )}
          </div>
        </div>

        <label className="mt-4 block text-sm text-[var(--content-secondary)]">
          Optional customer ID
          <input
            value={customerId}
            onChange={(event) => onCustomerIdChange(event.target.value)}
            placeholder="Use known customer for stronger ranking"
            className="mt-2 h-11 w-full rounded-xl border border-[var(--border-opaque)] bg-[var(--bg-secondary)] px-4 text-[var(--content-primary)] outline-none ring-[var(--role-primary)] focus:ring-2"
          />
        </label>

        <div className="mt-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4">
          <p className="text-sm font-semibold text-[var(--content-primary)]">How this behaves in PASPL</p>
          <p className="mt-1 text-xs leading-5 text-[var(--content-tertiary)]">
            This stage is designed like a pre-order checkpoint: upload the bill, review numbered matches, adjust product or quantity, then move the confirmed draft into sales later.
          </p>
        </div>

        <div className="mt-6 space-y-3 pb-2">
          <button
            onClick={onScan}
            disabled={!image || !catalogReady}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--role-primary)] py-4 font-medium text-[var(--content-on-color)] shadow-sm transition-transform hover:opacity-95 disabled:cursor-not-allowed disabled:bg-[var(--bg-tertiary)] disabled:text-[var(--content-quaternary)]"
          >
            <MagicWand size={18} />
            <span>{catalogReady ? 'Scan with AI (Gemini)' : 'Loading catalog…'}</span>
          </button>
          <button
            type="button"
            className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] py-4 font-medium text-[var(--content-secondary)]"
          >
            Choose Different Photo
          </button>
        </div>
      </div>
    </div>
  );
}
