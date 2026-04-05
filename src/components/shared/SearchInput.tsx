import { useState, useEffect, useRef, useCallback, type ReactNode, type RefObject } from 'react';
import { MagnifyingGlass, X, SpinnerGap } from '@phosphor-icons/react';

interface SearchInputProps {
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  loading?: boolean;
  autoFocus?: boolean;
  debounceMs?: number;
  /** Renders inside the bar on the left (e.g. scope pill "All brands ▾"). Bar becomes flex; input gets rounded-r only. */
  leftContent?: ReactNode;
  inputRef?: RefObject<HTMLInputElement | null>;
}

export function SearchInput({
  placeholder = 'Search...',
  value,
  onChange,
  onFocus,
  onBlur,
  loading = false,
  autoFocus = true,
  debounceMs = 150,
  leftContent,
  inputRef: externalInputRef,
}: SearchInputProps): React.JSX.Element | null {
  const [localValue, setLocalValue] = useState(value);
  const internalInputRef = useRef<HTMLInputElement>(null);
  const inputRef = externalInputRef ?? internalInputRef;
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  useEffect(() => {
    if (autoFocus) {
      inputRef.current?.focus();
    }
  }, [autoFocus]);

  const debouncedOnChange = useCallback(
    (v: string) => {
      clearTimeout(timerRef.current);
      if (debounceMs <= 0) {
        onChange(v);
        return;
      }
      timerRef.current = setTimeout(() => onChange(v), debounceMs);
    },
    [onChange, debounceMs],
  );

  useEffect(() => {
    return () => clearTimeout(timerRef.current);
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setLocalValue(v);
    debouncedOnChange(v);
  };

  const handleSelectAll = (e: React.MouseEvent<HTMLInputElement>) => {
    if (e.detail >= 2) {
      e.currentTarget.select();
    }
  };

  const handleClear = () => {
    setLocalValue('');
    onChange('');
    inputRef.current?.focus();
  };

  const inputEl = (
    <>
      <MagnifyingGlass
        size={18}
        weight="regular"
        className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--content-tertiary)] pointer-events-none"
      />
      <input
        ref={inputRef}
        type="text"
        value={localValue}
        onChange={handleChange}
        onClick={handleSelectAll}
        onDoubleClick={e => e.currentTarget.select()}
        onFocus={onFocus}
        onBlur={onBlur}
        placeholder={placeholder}
        className={
          leftContent
            ? 'w-full h-12 pl-12 pr-12 text-sm bg-transparent text-[var(--content-primary)] placeholder:text-[var(--content-quaternary)] rounded-r-xl rounded-l-none border-none outline-none focus:ring-1 focus:ring-[var(--border-opaque)]'
            : 'w-full h-12 pl-12 pr-12 text-sm bg-transparent text-[var(--content-primary)] placeholder:text-[var(--content-quaternary)] rounded-xl border-none outline-none focus:ring-1 focus:ring-[var(--border-opaque)]'
        }
      />
      <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center">
        {loading && (
          <SpinnerGap size={20} weight="regular" className="text-[var(--content-tertiary)] animate-spin" />
        )}
        {!loading && localValue && (
          <button
            type="button"
            onClick={handleClear}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--content-secondary)_62%,white)] text-[var(--content-on-color)] shadow-sm transition-colors hover:bg-[color-mix(in_srgb,var(--content-secondary)_74%,white)] active:scale-95"
            aria-label="Clear search"
          >
            <X size={16} weight="bold" />
          </button>
        )}
      </div>
    </>
  );

  if (leftContent) {
    return (
      <div className="flex w-full rounded-xl overflow-hidden h-12 bg-[var(--bg-secondary)] border border-[var(--border-opaque)]">
        <div className="flex items-center shrink-0 border-r border-[var(--border-subtle)]">
          {leftContent}
        </div>
        <div className="relative flex-1 min-w-0">{inputEl}</div>
      </div>
    );
  }

  return (
    <div className="relative w-full rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-opaque)]">
      {inputEl}
    </div>
  );
}
