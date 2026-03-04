import { useCallback } from 'react';
import { Minus, Plus } from '@phosphor-icons/react';
import { InlineQtyEditor } from './InlineQtyEditor';

interface NumberStepperProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  presets?: number[];
  variant?: 'default' | 'compact';
}

export function NumberStepper({
  value,
  onChange,
  min = 1,
  max,
  presets = [1, 2, 5, 10, 25, 50],
  variant = 'default',
}: NumberStepperProps) {
  const clamp = useCallback(
    (v: number) => {
      let clamped = Math.max(min, v);
      if (max !== undefined) clamped = Math.min(max, clamped);
      return clamped;
    },
    [min, max],
  );

  const decrement = () => onChange(clamp(value - 1));
  const increment = () => onChange(clamp(value + 1));

  if (variant === 'compact') {
    return (
      <div className="inline-flex items-center gap-1.5">
        <button
          onClick={decrement}
          disabled={value <= min}
          className="w-10 h-10 flex items-center justify-center rounded-lg bg-[var(--bg-tertiary)] text-[var(--content-primary)] hover:opacity-90 active:opacity-80 transition-opacity duration-150 disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="Decrease quantity"
        >
          <Minus size={16} weight="regular" />
        </button>

        <InlineQtyEditor
          value={value}
          onConfirm={(qty) => onChange(clamp(qty))}
          onCancel={() => {}}
          min={min}
          max={max}
          className="min-w-[48px] h-10 text-sm"
        />

        <button
          onClick={increment}
          disabled={max !== undefined && value >= max}
          className="w-10 h-10 flex items-center justify-center rounded-lg bg-[var(--bg-tertiary)] text-[var(--content-primary)] hover:opacity-90 active:opacity-80 transition-opacity duration-150 disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="Increase quantity"
        >
          <Plus size={16} weight="regular" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex items-center gap-3">
        <button
          onClick={decrement}
          disabled={value <= min}
          className="
            w-12 h-12 flex items-center justify-center
            rounded-lg bg-[var(--bg-tertiary)] text-[var(--content-primary)]
            hover:opacity-90 active:opacity-80
            transition-opacity duration-150
            disabled:opacity-30 disabled:cursor-not-allowed
          "
          aria-label="Decrease quantity"
        >
          <Minus size={20} weight="regular" />
        </button>

        <InlineQtyEditor
          value={value}
          onConfirm={(qty) => onChange(clamp(qty))}
          onCancel={() => {}}
          min={min}
          max={max}
          className="min-w-[64px] h-12"
        />

        <button
          onClick={increment}
          disabled={max !== undefined && value >= max}
          className="
            w-12 h-12 flex items-center justify-center
            rounded-lg bg-[var(--bg-tertiary)] text-[var(--content-primary)]
            hover:opacity-90 active:opacity-80
            transition-opacity duration-150
            disabled:opacity-30 disabled:cursor-not-allowed
          "
          aria-label="Increase quantity"
        >
          <Plus size={20} weight="regular" />
        </button>
      </div>

      <div className="flex flex-wrap gap-2 justify-center">
        {presets.map((preset) => (
          <button
            key={preset}
            onClick={() => onChange(clamp(preset))}
            data-inverse-primary={value === preset ? '' : undefined}
            className={`
              px-3 py-1.5 rounded-lg text-sm font-medium font-mono
              transition-colors duration-150
              ${
                value === preset
                  ? 'bg-[var(--bg-inverse-primary)] text-[var(--content-inverse-primary)]'
                  : 'bg-[var(--bg-tertiary)] text-[var(--content-secondary)] hover:text-[var(--content-primary)]'
              }
            `}
          >
            {preset}
          </button>
        ))}
      </div>
    </div>
  );
}
