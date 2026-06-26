import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CaretLeft, CaretRight, Flask, Package } from '@phosphor-icons/react';
import { PickFlowExperience } from '../../features/picking/PickFlowExperience';
import {
  DEFAULT_LAB_DEMO_ID,
  getLabDemoScenario,
  LAB_DEMO_SCENARIOS,
  type LabDemoScenarioId,
} from '../../features/picking/lab/demoOrders';

export default function PickerUxLabPage(): React.JSX.Element {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const demoParam = searchParams.get('demo');
  const orderIdParam = searchParams.get('orderId');
  const orderId = orderIdParam ? Number(orderIdParam) : null;
  const hasValidOrder = orderId != null && Number.isFinite(orderId) && orderId > 0;
  const demoScenario = getLabDemoScenario(demoParam);
  const [orderInput, setOrderInput] = useState(orderIdParam ?? '');
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    if (demoParam || orderIdParam) return;
    setSearchParams({ demo: DEFAULT_LAB_DEMO_ID }, { replace: true });
  }, [demoParam, orderIdParam, setSearchParams]);

  const startDemo = (id: LabDemoScenarioId): void => {
    setSearchParams({ demo: id });
  };

  const loadOrder = (): void => {
    const trimmed = orderInput.trim();
    if (!trimmed) return;
    setSearchParams({ orderId: trimmed });
  };

  if (demoScenario) {
    return (
      <PickFlowExperience
        demoOrder={demoScenario.order}
        mode="lab"
        onBack={() => {
          setSearchParams({});
          navigate('/admin/picker-ux-lab', { replace: true });
        }}
      />
    );
  }

  if (hasValidOrder) {
    return (
      <PickFlowExperience
        orderId={orderId}
        mode="lab"
        onBack={() => {
          setSearchParams({});
          navigate('/admin/picker-ux-lab', { replace: true });
        }}
      />
    );
  }

  return (
    <div className="role-picking min-h-screen bg-[var(--bg-primary)]">
      <LabHeader onBack={() => navigate('/admin')} />

      <main className="mx-auto flex max-w-lg flex-col gap-4 p-4">
        <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4">
          <div className="mb-4 flex items-start gap-3">
            <div className="flex min-h-10 min-w-10 items-center justify-center rounded-xl bg-[var(--bg-accent-subtle)]">
              <Package size={20} weight="fill" className="text-[var(--content-accent)]" />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-base font-bold text-[var(--content-primary)]">Picker UX Lab</h1>
              <p className="mt-1 text-sm leading-snug text-[var(--content-secondary)]">
                Tap a scenario below — preloaded demo orders, no order ID needed. Nothing is written to the database in lab mode.
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4">
          <p className="font-ds-label-size font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
            Demo scenarios
          </p>
          <div className="mt-3 divide-y divide-[var(--border-faint)]">
            {LAB_DEMO_SCENARIOS.map((scenario) => (
              <button
                key={scenario.id}
                type="button"
                onClick={() => startDemo(scenario.id)}
                className="flex w-full items-start gap-3 py-3 text-left first:pt-0 last:pb-0 pick-pressable"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-mono font-ds-micro font-bold text-[var(--content-accent)]">
                      {scenario.id}
                    </p>
                    <p className="font-ds-body-size font-semibold text-[var(--content-primary)]">
                      {scenario.title}
                    </p>
                  </div>
                  <p className="mt-1 font-ds-caption-size leading-snug text-[var(--content-secondary)]">
                    {scenario.expected}
                  </p>
                  <p className="mt-1 font-ds-micro text-[var(--content-tertiary)]">
                    {scenario.order.items.length} lines · {scenario.order.order_number}
                  </p>
                </div>
                <CaretRight size={18} className="mt-1 shrink-0 text-[var(--content-tertiary)]" />
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-[var(--border-dashed,var(--border-subtle))] bg-[var(--bg-secondary)] p-4">
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="font-ds-caption-size font-semibold text-[var(--content-accent)] pick-pressable"
          >
            {showAdvanced ? 'Hide' : 'Advanced: load real order ID'}
          </button>
          {showAdvanced ? (
            <div className="mt-3 flex gap-2">
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={orderInput}
                onChange={(e) => setOrderInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') loadOrder();
                }}
                placeholder="Order ID"
                aria-label="Order ID"
                className="min-h-12 flex-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 font-mono text-base text-[var(--content-primary)]"
              />
              <button
                type="button"
                onClick={loadOrder}
                className="rounded-xl bg-[var(--bg-inverse-primary)] px-5 text-sm font-bold text-white pick-pressable"
              >
                Load
              </button>
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}

function LabHeader({ onBack }: { onBack: () => void }): React.JSX.Element {
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
          <p className="truncate text-sm font-bold">Picker UX Lab</p>
          <p className="truncate text-xs text-[var(--content-tertiary)]">Admin-only safe picker testing</p>
        </div>
        <Flask size={20} className="shrink-0 text-[var(--content-accent)]" weight="fill" />
      </div>
    </div>
  );
}
