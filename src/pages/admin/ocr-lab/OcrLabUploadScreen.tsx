import { ArrowLeft, NotePencil } from '@phosphor-icons/react';

export function OcrLabUploadScreen({
  orderText,
  customerId,
  catalogReady,
  onBack,
  onCustomerIdChange,
  onOrderTextChange,
  onScan,
}: {
  orderText: string;
  customerId: string;
  catalogReady: boolean;
  onBack: () => void;
  onCustomerIdChange: (value: string) => void;
  onOrderTextChange: (value: string) => void;
  onScan: () => void;
}): React.JSX.Element {
  const hasLines = orderText.trim().length > 0;

  return (
    <div className="flex h-full flex-col bg-[var(--bg-primary)]">
      <div className="flex items-center border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-4">
        <button onClick={onBack} className="-ml-2 rounded-full p-2 text-[var(--content-secondary)] hover:bg-[var(--bg-tertiary)]">
          <ArrowLeft size={20} />
        </button>
        <h1 className="ml-2 text-base font-semibold text-[var(--content-primary)]">Match order lines</h1>
      </div>

      <div className="flex flex-1 flex-col p-5">
        <p className="mb-4 text-sm text-[var(--content-secondary)]">
          Paste typed order lines to stage catalog matching and review. Photo AI extraction is no longer available.
        </p>

        <label className="block text-sm text-[var(--content-secondary)]">
          Order lines
          <textarea
            value={orderText}
            onChange={(event) => onOrderTextChange(event.target.value)}
            rows={10}
            placeholder={'1896A03601 — 02\nCA275 STD — 01\nClutch Assly HH — 10'}
            className="mt-2 w-full rounded-xl border border-[var(--border-opaque)] bg-[var(--bg-secondary)] px-4 py-3 font-mono text-sm text-[var(--content-primary)] outline-none ring-[var(--role-primary)] focus:ring-2"
          />
        </label>
        <p className="mt-2 text-xs text-[var(--content-tertiary)]">
          One line per item. Optional format: <span className="font-mono">part or description — qty</span>
        </p>

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
            This stage is a pre-order checkpoint: paste lines, review numbered matches, adjust product or quantity, then
            move the confirmed draft into sales later.
          </p>
        </div>

        <div className="mt-6 space-y-3 pb-2">
          <button
            onClick={onScan}
            disabled={!hasLines || !catalogReady}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--role-primary)] py-4 font-medium text-[var(--content-on-color)] shadow-sm transition-transform hover:opacity-95 disabled:cursor-not-allowed disabled:bg-[var(--bg-tertiary)] disabled:text-[var(--content-quaternary)]"
          >
            <NotePencil size={18} />
            <span>{catalogReady ? 'Match lines to catalog' : 'Loading catalog…'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
