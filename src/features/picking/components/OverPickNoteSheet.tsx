import { CheckCircle } from '@phosphor-icons/react';
import { useEffect, useRef } from 'react';
import { BottomSheet } from '../../../components/shared';
import { appHaptics } from '../../../lib/haptics';
import {
  notePlaceholder,
  normalizeUom,
  OVER_PICK_QUICK_ACTIONS,
  uomLabel,
} from '../../../lib/picking/pickerMicrocopy';
import { NumpadConfirmButton } from './Numpad';

export interface OverPickNoteSheetProps {
  isOpen: boolean;
  extraQty: number;
  remainingQty: number;
  uom: string;
  note: string;
  onNoteChange: (text: string) => void;
  onClose: () => void;
  onSave: () => void;
}

export function OverPickNoteSheet({
  isOpen,
  extraQty,
  remainingQty,
  uom,
  note,
  onNoteChange,
  onClose,
  onSave,
}: OverPickNoteSheetProps): React.JSX.Element {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const uomNorm = normalizeUom(uom);
  const trimmed = note.trim();
  const hasNote = trimmed.length > 0;

  useEffect(() => {
    if (!isOpen) return;
    const timer = window.setTimeout(() => textareaRef.current?.focus(), 280);
    return () => window.clearTimeout(timer);
  }, [isOpen]);

  const handleQuickAction = (action: string): void => {
    appHaptics.selection();
    onNoteChange(action);
  };

  const handleSave = (): void => {
    if (!hasNote) return;
    appHaptics.success();
    onSave();
  };

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={onClose}
      title="Why pick extra?"
      keyboardBehavior="static"
      rootClassName="!z-[70]"
      sheetClassName="max-h-[min(72dvh,72vh)]"
      contentClassName="!px-4 !pb-2"
      footer={
        <NumpadConfirmButton
          confirmLabel={hasNote ? 'Save reason →' : 'Pick a reason →'}
          disabled={!hasNote}
          tone={hasNote ? 'success' : 'amber'}
          onConfirm={handleSave}
        />
      }
    >
      <div className="space-y-4">
        <p className="rounded-xl border border-[var(--border-negative)] bg-[var(--bg-negative-subtle)] px-3 py-2.5 font-ds-caption-size leading-snug text-[var(--content-negative)]">
          Picking{' '}
          <span className="font-bold">
            {extraQty} {uomLabel(uomNorm, extraQty)} extra
          </span>{' '}
          — only {remainingQty} {uomLabel(uomNorm, remainingQty)} left on this line. Billing will
          see your reason on the invoice.
        </p>

        <div>
          <p className="pick-identity-label text-[var(--content-tertiary)]">Quick reason</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {OVER_PICK_QUICK_ACTIONS.map((action) => {
              const selected = trimmed === action;
              return (
                <button
                  key={action}
                  type="button"
                  onClick={() => handleQuickAction(action)}
                  className={`min-h-12 rounded-xl border px-3 py-2.5 text-left font-ds-caption-size font-semibold leading-snug pick-pressable transition-colors ${
                    selected
                      ? 'border-[var(--border-selected)] bg-[var(--bg-inverse-primary)] text-white'
                      : 'border-[var(--border-subtle)] bg-[var(--bg-tertiary)] text-[var(--content-secondary)]'
                  }`}
                >
                  {action}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label
            htmlFor="over-pick-custom-note"
            className="pick-identity-label text-[var(--content-tertiary)]"
          >
            Or describe in your own words
          </label>
          <textarea
            id="over-pick-custom-note"
            ref={textareaRef}
            rows={3}
            value={note}
            onChange={(e) => onNoteChange(e.target.value)}
            placeholder={notePlaceholder(true)}
            className={`mt-2 min-h-[5rem] w-full resize-none rounded-xl border bg-[var(--bg-secondary)] px-3 py-2.5 font-ds-body-size text-[var(--content-primary)] outline-none transition-[border-color,box-shadow] focus:border-[var(--role-primary)] focus:shadow-[0_0_0_3px_var(--role-primary-subtle)] ${
              hasNote && !OVER_PICK_QUICK_ACTIONS.includes(trimmed as (typeof OVER_PICK_QUICK_ACTIONS)[number])
                ? 'border-[var(--border-positive)]'
                : 'border-[var(--border-opaque)]'
            }`}
          />
          {hasNote ? (
            <p className="animate-pick-celebrate mt-2 flex items-center gap-1 font-ds-micro font-semibold text-[var(--content-positive)]">
              <CheckCircle size={12} weight="fill" aria-hidden />
              Reason ready — save below
            </p>
          ) : null}
        </div>
      </div>
    </BottomSheet>
  );
}
