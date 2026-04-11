import { useState, useEffect, useLayoutEffect, useRef, useCallback, type ReactNode, type RefObject } from 'react';
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
  const [isFocused, setIsFocused] = useState(false);
  const internalInputRef = useRef<HTMLInputElement>(null);
  const inputRef = externalInputRef ?? internalInputRef;
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const scrollInputToEnd = useCallback(() => {
    requestAnimationFrame(() => {
      if (!inputRef.current) return;
      inputRef.current.scrollLeft = inputRef.current.scrollWidth;
    });
  }, [inputRef]);

  const scrollInputToStart = useCallback(() => {
    requestAnimationFrame(() => {
      if (!inputRef.current) return;
      inputRef.current.scrollLeft = 0;
    });
  }, [inputRef]);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    if (isFocused) {
      scrollInputToEnd();
      return;
    }
    scrollInputToStart();
  }, [inputRef, isFocused, localValue, scrollInputToEnd, scrollInputToStart]);

  useLayoutEffect(() => {
    if (autoFocus) {
      inputRef.current?.focus({ preventScroll: true });
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
    scrollInputToEnd();
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
        className={`absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none transition-colors duration-150 ${
          isFocused ? 'text-[var(--content-primary)]' : 'text-[var(--content-tertiary)]'
        }`}
      />
      <input
        ref={inputRef}
        type="text"
        autoFocus={autoFocus}
        value={localValue}
        onChange={handleChange}
        onClick={handleSelectAll}
        onDoubleClick={e => e.currentTarget.select()}
        onFocus={() => {
          setIsFocused(true);
          onFocus?.();
          scrollInputToEnd();
        }}
        onBlur={() => {
          setIsFocused(false);
          onBlur?.();
          scrollInputToStart();
        }}
        placeholder={placeholder}
        style={{ textOverflow: 'clip' }}
        className={
          leftContent
            ? 'w-full min-w-0 h-12 pl-12 pr-[39px] text-sm bg-transparent text-[var(--content-primary)] placeholder:text-[var(--content-quaternary)] rounded-r-xl rounded-l-none border-none outline-none focus:ring-1 focus:ring-[var(--border-opaque)]'
            : 'w-full min-w-0 h-12 pl-12 pr-[39px] text-sm bg-transparent text-[var(--content-primary)] placeholder:text-[var(--content-quaternary)] rounded-xl border-none outline-none focus:ring-1 focus:ring-[var(--border-opaque)]'
        }
      />
      <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center">
        {loading && (
          <SpinnerGap size={20} weight="regular" className="text-[var(--content-tertiary)] animate-spin" />
        )}
        {!loading && localValue && (
          <button
            type="button"
            onMouseDown={e => e.preventDefault()}
            onTouchStart={e => e.preventDefault()}
            onClick={handleClear}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--border-opaque)_72%,white)] text-[var(--content-secondary)] opacity-100 scale-100 transition-all duration-150 hover:bg-[color-mix(in_srgb,var(--border-opaque)_88%,white)] active:scale-95"
            aria-label="Clear search"
          >
            <X size={14} weight="regular" />
          </button>
        )}
      </div>
    </>
  );

  if (leftContent) {
    return (
      <div
        className={`flex w-full rounded-xl overflow-hidden h-12 border bg-[var(--bg-secondary)] transition-[border-color,box-shadow,background-color] duration-150 ${
          isFocused
            ? 'border-[var(--role-primary)] shadow-[0_0_0_3px_var(--role-primary-subtle)]'
            : 'border-[var(--border-opaque)]'
        }`}
      >
        <div className="flex items-center shrink-0 border-r border-[var(--border-subtle)]">
          {leftContent}
        </div>
        <div className="relative flex-1 min-w-0">{inputEl}</div>
      </div>
    );
  }

  return (
    <div
      className={`relative w-full rounded-xl border bg-[var(--bg-secondary)] transition-[border-color,box-shadow,background-color] duration-150 ${
        isFocused
          ? 'border-[var(--role-primary)] shadow-[0_0_0_3px_var(--role-primary-subtle)]'
          : 'border-[var(--border-opaque)]'
      }`}
    >
      {inputEl}
    </div>
  );
}
