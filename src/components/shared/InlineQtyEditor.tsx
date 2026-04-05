import { useState, useCallback, useRef, useEffect, type ReactNode } from 'react';
import { Check, X } from '@phosphor-icons/react';
import { appHaptics } from '../../lib/haptics';

export interface InlineQtyEditorProps {
  value: number;
  onConfirm: (qty: number) => void;
  onCancel: () => void;
  min?: number;
  max?: number;
  /** Allow 0 to mean "remove" (calls onConfirm(0)); otherwise values < min are clamped to min */
  allowZero?: boolean;
  /** When provided, edit mode is controlled by parent (e.g. to close when another row opens) */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  secondaryAction?: {
    icon: ReactNode;
    ariaLabel: string;
    onAction: (qty: number) => void;
    className?: string;
  };
}

export function InlineQtyEditor({
  value,
  onConfirm,
  onCancel,
  min = 1,
  max,
  allowZero = false,
  open: controlledOpen,
  onOpenChange,
  className = '',
  secondaryAction,
}: InlineQtyEditorProps): React.JSX.Element | null {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const isEditing = isControlled ? controlledOpen : internalOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      if (!isControlled) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange],
  );
  const [inputValue, setInputValue] = useState(String(value));
  const inputRef = useRef<HTMLInputElement>(null);
  const committedByButtonRef = useRef(false);

  const clamp = useCallback(
    (v: number): number => {
      if (allowZero && v <= 0) return 0;
      let clamped = Math.max(min, v);
      if (max !== undefined) clamped = Math.min(max, clamped);
      return clamped;
    },
    [min, max, allowZero],
  );

  const startEditing = useCallback(() => {
    committedByButtonRef.current = false;
    setInputValue(String(value));
    appHaptics.selection();
    setOpen(true);
    if (!isControlled) setInternalOpen(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [value, setOpen, isControlled]);

  const cancel = useCallback(() => {
    committedByButtonRef.current = true;
    setInputValue(String(value));
    setOpen(false);
    if (!isControlled) setInternalOpen(false);
    onCancel();
  }, [value, onCancel, setOpen, isControlled]);

  const commitValue = useCallback((onValid: (qty: number) => void) => {
    committedByButtonRef.current = true;
    const trimmed = inputValue.trim();
    if (trimmed === '') {
      cancel();
      return;
    }
    const parsed = parseInt(trimmed, 10);
    if (!Number.isInteger(parsed) || (parsed < 0 && !allowZero)) {
      cancel();
      return;
    }
    const clamped = clamp(parsed);
    setOpen(false);
    if (!isControlled) setInternalOpen(false);
    onValid(clamped);
  }, [inputValue, allowZero, clamp, cancel, setOpen, isControlled]);

  const confirm = useCallback(() => {
    appHaptics.success();
    commitValue(onConfirm);
  }, [commitValue, onConfirm]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        confirm();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      }
    },
    [confirm, cancel],
  );

  const handleBlur = useCallback(() => {
    requestAnimationFrame(() => {
      if (committedByButtonRef.current) return;
      cancel();
    });
  }, [cancel]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!isEditing) setInputValue(String(value));
  }, [value, isEditing]);

  useEffect(() => {
    if (!isEditing) return;
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [isEditing]);

  // When controlled and parent sets open to false, revert and notify cancel
  const prevControlledOpen = useRef(controlledOpen);
  useEffect(() => {
    if (isControlled && prevControlledOpen.current === true && controlledOpen === false) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setInputValue(String(value));
      onCancel();
    }
    prevControlledOpen.current = controlledOpen;
  }, [isControlled, controlledOpen, value, onCancel]);

  if (!isEditing) {
    return (
      <button
        type="button"
        onClick={startEditing}
        className={`
          min-w-11 min-h-11 h-11 px-2 flex items-center justify-center
          font-mono font-semibold text-[var(--content-primary)] text-sm
          rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors duration-150
          ${className}
        `}
        aria-label="Edit quantity"
      >
        {value}
      </button>
    );
  }

  return (
    <div className={`flex items-center gap-1 shrink-0 ${className}`}>
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        aria-label="Quantity"
        className="
          w-14 min-h-11 h-11 text-center font-mono text-base font-semibold
          bg-[var(--bg-tertiary)] border border-[var(--border-subtle)]
          text-[var(--content-primary)] rounded-lg
          focus:outline-none focus:ring-1 focus:ring-[var(--border-subtle)]
        "
      />
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          cancel();
        }}
        className="
          min-w-11 min-h-11 flex items-center justify-center
          rounded-lg bg-[var(--bg-tertiary)] text-[var(--content-secondary)]
          hover:opacity-90 active:scale-95 transition-all
        "
        aria-label="Cancel"
      >
        <X size={18} weight="bold" />
      </button>
      {secondaryAction && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            appHaptics.impactLight();
            commitValue(secondaryAction.onAction);
          }}
          className={`
            min-w-11 min-h-11 flex items-center justify-center
            rounded-lg bg-[var(--bg-tertiary)] text-[var(--content-accent)]
            hover:opacity-90 active:scale-95 transition-all
            ${secondaryAction.className ?? ''}
          `}
          aria-label={secondaryAction.ariaLabel}
        >
          {secondaryAction.icon}
        </button>
      )}
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          confirm();
        }}
        className="
          min-w-11 min-h-11 flex items-center justify-center
          rounded-lg bg-[var(--bg-accent)] text-[var(--content-on-color)]
          hover:opacity-90 active:scale-95 transition-all
        "
        aria-label="Confirm quantity"
      >
        <Check size={18} weight="bold" />
      </button>
    </div>
  );
}
