import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CaretLeft, Flask, Package } from '@phosphor-icons/react';
import { PickFlowPanel } from '../picking/PickFlowPanel';

export default function PickerUxLabPage(): React.JSX.Element {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const orderIdParam = searchParams.get('orderId');
  const orderId = orderIdParam ? Number(orderIdParam) : null;
  const hasValidOrder = orderId != null && Number.isFinite(orderId);

  const [orderInput, setOrderInput] = useState(orderIdParam ?? '');

  const loadOrder = (): void => {
    const trimmed = orderInput.trim();
    if (!trimmed) return;
    setSearchParams({ orderId: trimmed });
  };

  if (!hasValidOrder) {
    return (
      <div className="role-picking min-h-screen bg-[var(--bg-primary)]">
        <LabHeader onBack={() => navigate('/admin')} subtitle="Load an order to mirror production picking" />
        <div className="mx-auto max-w-lg space-y-4 p-4">
          <ModeCard
            icon={<Package size={20} className="text-[var(--content-positive)]" />}
            title="Live order sandbox"
            description="Full production pick flow — swipe deck, scanner, MRP split, queue sheet, and finish sheet. Changes stay in the lab only."
            actionLabel="Load"
            onAction={loadOrder}
            showInput
            inputValue={orderInput}
            onInputChange={setOrderInput}
          />
          <p className="px-1 text-center text-xs text-[var(--content-tertiary)]">
            Tip: use an order in picking or approved state with pickable lines.
          </p>
        </div>
      </div>
    );
  }

  return (
    <PickFlowPanel
      orderId={orderId}
      mode="lab"
      onBack={() => {
        setSearchParams({});
        navigate('/admin/picker-ux-lab');
      }}
    />
  );
}

function LabHeader({
  onBack,
  subtitle,
}: {
  onBack: () => void;
  subtitle: string;
}): React.JSX.Element {
  return (
    <div className="sticky top-0 z-20 border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
      <div className="mx-auto flex max-w-lg items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          className="flex min-h-11 min-w-11 items-center justify-center rounded-xl pick-pressable"
          aria-label="Back"
        >
          <CaretLeft size={22} />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold">Picker UX Lab (v10)</p>
          <p className="truncate text-xs text-[var(--content-tertiary)]">{subtitle}</p>
        </div>
        <Flask size={20} className="shrink-0 text-[var(--content-accent)]" weight="fill" />
      </div>
    </div>
  );
}

function ModeCard({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  showInput,
  inputValue,
  onInputChange,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
  showInput?: boolean;
  inputValue?: string;
  onInputChange?: (v: string) => void;
}): React.JSX.Element {
  return (
    <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4">
      <div className="mb-3 flex items-center gap-2">
        {icon}
        <p className="font-semibold">{title}</p>
      </div>
      <p className="mb-4 text-sm text-[var(--content-tertiary)]">{description}</p>
      {showInput ? (
        <div className="flex gap-2">
          <input
            type="text"
            inputMode="numeric"
            value={inputValue}
            onChange={(e) => onInputChange?.(e.target.value)}
            placeholder="Order ID"
            className="min-h-11 flex-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 font-mono text-sm"
          />
          <button
            type="button"
            onClick={onAction}
            className="rounded-xl bg-[var(--bg-inverse-primary)] px-4 text-sm font-bold text-white pick-pressable"
          >
            {actionLabel}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onAction}
          className="w-full rounded-xl bg-[var(--bg-inverse-primary)] py-3.5 text-sm font-bold text-white pick-pressable"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
