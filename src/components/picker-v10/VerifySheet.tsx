import { BottomSheet } from '../shared';
import type { PickerV10Line } from './types';

export interface VerifySheetProps {
  isOpen: boolean;
  item: PickerV10Line;
  mode: 'verify' | 'verify-type';
  typeBuf: string;
  typeErr: boolean;
  onTypeBufChange: (v: string) => void;
  onTypeVerify: () => void;
  onVerified: () => void;
  onOpenTypeMode: () => void;
  onClose: () => void;
}

function locationLabel(item: PickerV10Line): string {
  const parts = [
    item.rack ? `Rack ${item.rack}` : null,
    item.shelf ?? null,
    item.bin ? `Bin ${item.bin}` : null,
  ].filter(Boolean);
  return parts.join(' · ') || '—';
}

export function VerifySheet({
  isOpen,
  item,
  mode,
  typeBuf,
  typeErr,
  onTypeBufChange,
  onTypeVerify,
  onVerified,
  onOpenTypeMode,
  onClose,
}: VerifySheetProps): React.JSX.Element | null {
  const showType = mode === 'verify-type' || item.verifyMode === 'type';
  const showScan = item.verifyMode === 'scan' && mode === 'verify';
  const showConfirm = item.verifyMode === 'confirm';

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title="Verify item" closeOnly>
      {showScan && (
        <div className="space-y-4">
          <div>
            <p className="text-base font-extrabold text-[var(--content-primary)]">Scan to verify</p>
            <p className="mt-1 text-xs text-[var(--content-tertiary)]">
              {item.bin ? `Bin ${item.bin} has a QR sticker` : 'Scan bin QR at this rack'}
            </p>
          </div>
          <div className="relative flex h-36 flex-col items-center justify-center overflow-hidden rounded-2xl bg-[var(--bg-inverse-primary)]">
            <span className="text-3xl">📷</span>
            <p className="mt-2 text-xs text-[var(--content-tertiary)]">Tap to activate camera</p>
          </div>
          <button
            type="button"
            onClick={onVerified}
            className="w-full rounded-xl bg-[var(--bg-inverse-primary)] py-4 text-base font-extrabold text-white pick-pressable"
          >
            Scan {item.bin ? `bin ${item.bin}` : 'rack'}
          </button>
          <button
            type="button"
            onClick={onOpenTypeMode}
            className="w-full py-2 text-sm font-semibold text-[var(--content-tertiary)] pick-pressable"
          >
            No QR? Type code instead →
          </button>
        </div>
      )}

      {showType && !showConfirm && (
        <div className="space-y-3">
          <div>
            <p className="text-base font-extrabold text-[var(--content-primary)]">Type last 4 chars</p>
            <p className="mt-1 text-xs text-[var(--content-tertiary)]">
              Read last 4 characters from the item label
            </p>
            <p className="mt-2 font-mono text-sm font-bold text-[var(--content-accent)]">
              ··· {item.code.slice(-4)}
            </p>
          </div>
          <input
            type="text"
            maxLength={4}
            value={typeBuf}
            onChange={(e) => onTypeBufChange(e.target.value.toUpperCase())}
            placeholder="_ _ _ _"
            autoFocus
            className={`w-full rounded-xl border-2 py-4 text-center font-mono text-3xl font-extrabold tracking-[0.35em] outline-none ${
              typeErr
                ? 'border-[var(--border-negative)] bg-[var(--bg-negative-subtle)]'
                : 'border-[var(--border-subtle)] bg-[var(--bg-secondary)]'
            }`}
          />
          {typeErr && (
            <p className="text-center text-xs font-semibold text-[var(--content-negative)]">Doesn&apos;t match</p>
          )}
          <button
            type="button"
            onClick={onTypeVerify}
            className="w-full rounded-xl bg-[var(--bg-accent)] py-4 text-base font-extrabold text-white pick-pressable"
          >
            Confirm
          </button>
          <button
            type="button"
            onClick={onVerified}
            className="w-full py-2 text-xs font-semibold text-[var(--content-tertiary)] pick-pressable"
          >
            Skip — can&apos;t find label
          </button>
        </div>
      )}

      {showConfirm && (
        <div className="space-y-4">
          <div>
            <p className="text-base font-extrabold text-[var(--content-primary)]">Confirm before picking</p>
            <p className="mt-1 text-xs text-[var(--content-tertiary)]">No scannable code — verify visually</p>
          </div>
          <div className="overflow-hidden rounded-xl border border-[var(--border-subtle)]">
            {[
              ['Location', locationLabel(item), false],
              ['Item code', item.code, true],
              ['Item name', item.name, false],
            ].map(([label, value, mono], i, arr) => (
              <div
                key={String(label)}
                className={`px-4 py-3 ${i < arr.length - 1 ? 'border-b border-[var(--border-faint)]' : ''}`}
              >
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
                  {label}
                </p>
                <p
                  className={`mt-1 text-sm font-bold text-[var(--content-primary)] ${mono ? 'font-mono' : ''}`}
                >
                  {value}
                </p>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={onVerified}
            className="w-full rounded-xl bg-[var(--bg-inverse-primary)] py-4 text-base font-extrabold text-white pick-pressable"
          >
            ✓ Confirmed — right item
          </button>
        </div>
      )}
    </BottomSheet>
  );
}
