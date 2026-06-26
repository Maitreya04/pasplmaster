import { useCallback, useEffect, useRef, useState } from 'react';
import { Backspace } from '@phosphor-icons/react';

interface PinPadProps {
  minLength?: number;
  maxLength?: number;
  onSubmit: (pin: string) => Promise<boolean>;
  disabled?: boolean;
  errorText?: string | null;
  autoSubmitDelayMs?: number;
}

export function PinPad({
  minLength = 4,
  maxLength = 6,
  onSubmit,
  disabled = false,
  errorText = null,
  autoSubmitDelayMs = 350,
}: PinPadProps): React.JSX.Element {
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const [checking, setChecking] = useState(false);
  const errorTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const submitTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (errorTimeout.current) clearTimeout(errorTimeout.current);
      if (submitTimeout.current) clearTimeout(submitTimeout.current);
    };
  }, []);

  const trySubmit = useCallback(
    async (candidate: string) => {
      if (checking || disabled || candidate.length < minLength) return;

      setChecking(true);
      const success = await onSubmit(candidate);
      if (success) return;

      setError(true);
      errorTimeout.current = setTimeout(() => {
        setError(false);
        setPin('');
        setChecking(false);
      }, 1000);
    },
    [checking, disabled, minLength, onSubmit],
  );

  const scheduleSubmit = useCallback(
    (candidate: string) => {
      if (submitTimeout.current) clearTimeout(submitTimeout.current);
      if (candidate.length < minLength) return;

      if (candidate.length >= maxLength) {
        void trySubmit(candidate);
        return;
      }

      submitTimeout.current = setTimeout(() => {
        void trySubmit(candidate);
      }, autoSubmitDelayMs);
    },
    [autoSubmitDelayMs, maxLength, minLength, trySubmit],
  );

  const handleDigit = useCallback(
    (digit: string) => {
      if (checking || error || disabled) return;

      const next = pin + digit;
      if (next.length > maxLength) return;
      setPin(next);
      scheduleSubmit(next);
    },
    [checking, disabled, error, maxLength, pin, scheduleSubmit],
  );

  const handleBackspace = useCallback(() => {
    if (checking || error || disabled) return;
    if (submitTimeout.current) clearTimeout(submitTimeout.current);
    setPin((prev) => prev.slice(0, -1));
  }, [checking, disabled, error]);

  const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

  return (
    <div className="w-full max-w-xs">
      <div className="flex flex-col items-center gap-6 mb-8">
        <div className={`flex gap-3 ${error ? 'animate-shake' : ''}`}>
          {Array.from({ length: maxLength }, (_, i) => (
            <div
              key={i}
              className={`w-3.5 h-3.5 rounded-full transition-all duration-150 ${
                i < pin.length
                  ? error
                    ? 'bg-[var(--content-negative)] scale-110'
                    : 'bg-[var(--content-primary)] scale-110'
                  : 'border-2 border-[var(--border-opaque)]'
              }`}
            />
          ))}
        </div>
        <div className="h-5 text-center">
          {(error || errorText) && (
            <p className="text-sm text-[var(--content-negative)]">
              {errorText ?? 'Incorrect PIN'}
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {digits.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => handleDigit(d)}
            disabled={disabled || checking}
            className="w-16 h-16 mx-auto rounded-full flex items-center justify-center font-mono text-xl text-[var(--content-primary)] bg-[var(--bg-secondary)] border border-[var(--border-opaque)] shadow-[var(--shadow-card)] active:bg-[var(--bg-tertiary)] disabled:opacity-50"
          >
            {d}
          </button>
        ))}
        <div />
        <button
          type="button"
          onClick={() => handleDigit('0')}
          disabled={disabled || checking}
          className="w-16 h-16 mx-auto rounded-full flex items-center justify-center font-mono text-xl text-[var(--content-primary)] bg-[var(--bg-secondary)] border border-[var(--border-opaque)] shadow-[var(--shadow-card)] active:bg-[var(--bg-tertiary)] disabled:opacity-50"
        >
          0
        </button>
        <button
          type="button"
          onClick={handleBackspace}
          disabled={disabled || checking}
          className="w-16 h-16 mx-auto rounded-full flex items-center justify-center text-[var(--content-secondary)] bg-[var(--bg-secondary)] border border-[var(--border-opaque)] shadow-[var(--shadow-card)] active:bg-[var(--bg-tertiary)] disabled:opacity-50"
          aria-label="Backspace"
        >
          <Backspace size={24} weight="regular" />
        </button>
      </div>
    </div>
  );
}
