import { useState, useEffect, useRef, useCallback } from 'react';
import { MagnifyingGlass, X, SpinnerGap } from '@phosphor-icons/react';

interface SearchInputProps {
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  loading?: boolean;
  autoFocus?: boolean;
  debounceMs?: number;
}

export function SearchInput({
  placeholder = 'Search...',
  value,
  onChange,
  loading = false,
  autoFocus = true,
  debounceMs = 150,
}: SearchInputProps) {
  const [localValue, setLocalValue] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
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

  const handleClear = () => {
    setLocalValue('');
    onChange('');
    inputRef.current?.focus();
  };

  return (
    <div className="relative w-full">
      <MagnifyingGlass
        size={20}
        weight="regular"
        className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--content-tertiary)] pointer-events-none"
      />

      <input
        ref={inputRef}
        type="text"
        value={localValue}
        onChange={handleChange}
        placeholder={placeholder}
        className="
          w-full h-14 pl-12 pr-12 text-base
          bg-[var(--bg-tertiary)] text-[var(--content-primary)]
          placeholder:text-[var(--content-tertiary)]
          rounded-xl border-none outline-none
          focus:ring-1 focus:ring-[var(--border-subtle)]
        "
      />

      <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center">
        {loading && (
          <SpinnerGap size={20} weight="regular" className="text-[var(--content-tertiary)] animate-spin" />
        )}
        {!loading && localValue && (
          <button
            onClick={handleClear}
            className="p-1 rounded-full hover:bg-[var(--bg-elevated)]"
            aria-label="Clear search"
          >
            <X size={16} weight="regular" className="text-[var(--content-tertiary)]" />
          </button>
        )}
      </div>
    </div>
  );
}
