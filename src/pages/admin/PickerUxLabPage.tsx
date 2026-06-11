import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CaretLeft, Flask, Package, TestTube } from '@phosphor-icons/react';
import { PickFlowPanel } from '../picking/PickFlowPanel';
import { PickerV10Flow } from '../../components/picker-v10/PickerV10Flow';
import {
  DEMO_CUSTOMER_LABEL,
  DEMO_ORDER_LABEL,
  DEMO_SCENARIO_HINTS,
  DEMO_SCENARIO_LINES,
  DEMO_SCENARIO_PLAYBOOKS,
} from '../../components/picker-v10/demoItems';
import type { PickerV10DemoScenario } from '../../components/picker-v10/types';
import { getQtyState } from '../../lib/picking/qtyEntryState';
import { useToast } from '../../context/ToastContext';

type LabMode = 'codex_demo' | 'live_order';

const SCENARIOS: { id: PickerV10DemoScenario; label: string; group: 'tour' | 'qty' | 'mrp' | 'verify' }[] = [
  { id: 'edge_case_tour', label: 'Full tour ★', group: 'tour' },
  { id: 'default', label: 'Rack smoke', group: 'tour' },
  { id: 'single_pcs', label: 'PCS exact', group: 'qty' },
  { id: 'pair_over', label: 'PAIR over', group: 'qty' },
  { id: 'set_partial', label: 'SET gap', group: 'qty' },
  { id: 'extreme_over', label: 'Extreme over', group: 'qty' },
  { id: 'multi_mrp', label: 'Multi-MRP', group: 'mrp' },
  { id: 'multi_batch_split', label: '2-batch split', group: 'mrp' },
  { id: 'no_mrp', label: 'No MRP data', group: 'mrp' },
  { id: 'scan_verify', label: 'Scan verify', group: 'verify' },
];

export default function PickerUxLabPage(): React.JSX.Element {
  const navigate = useNavigate();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const orderIdParam = searchParams.get('orderId');
  const orderId = orderIdParam ? Number(orderIdParam) : null;
  const hasValidOrder = orderId != null && Number.isFinite(orderId);

  const [labMode, setLabMode] = useState<LabMode>(hasValidOrder ? 'live_order' : 'codex_demo');
  const [scenario, setScenario] = useState<PickerV10DemoScenario>('edge_case_tour');
  const [showPlaybook, setShowPlaybook] = useState(true);
  const [orderInput, setOrderInput] = useState(orderIdParam ?? '');
  const [debugQty, setDebugQty] = useState({ n: 0, target: 10 });

  const demoLines = useMemo(() => DEMO_SCENARIO_LINES[scenario], [scenario]);
  const playbook = DEMO_SCENARIO_PLAYBOOKS[scenario];
  const debugState = getQtyState(debugQty.n, debugQty.target);

  const loadOrder = (): void => {
    const trimmed = orderInput.trim();
    if (!trimmed) return;
    setLabMode('live_order');
    setSearchParams({ orderId: trimmed });
  };

  const startCodexDemo = (): void => {
    setLabMode('codex_demo');
    setSearchParams({});
  };

  if (labMode === 'live_order' && hasValidOrder) {
    return (
      <PickFlowPanel
        orderId={orderId}
        mode="lab"
        onBack={() => {
          setLabMode('codex_demo');
          setSearchParams({});
          navigate('/admin/picker-ux-lab');
        }}
      />
    );
  }

  return (
    <div className="role-picking min-h-screen bg-[var(--bg-primary)]">
      <LabHeader onBack={() => navigate('/admin')} subtitle="Codex-aligned picker flow (admin lab only)" />

      <div className="mx-auto max-w-lg space-y-4 p-4">
        <ModeCard
          icon={<TestTube size={20} className="text-[var(--content-accent)]" weight="fill" />}
          title="Codex demo flow"
          description="Phase-based V10 picker — rack list → identify → MRP → qty → gap → complete. No production writes."
          actionLabel="Running"
          onAction={startCodexDemo}
          active
        />

        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
            Demo scenario
          </p>
          <div className="flex flex-wrap gap-2">
            {SCENARIOS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setScenario(s.id)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold pick-pressable ${
                  scenario === s.id
                    ? 'border-[var(--role-primary)] bg-[var(--bg-accent-subtle)] text-[var(--content-primary)]'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-primary)] text-[var(--content-secondary)]'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-[var(--content-tertiary)]">{DEMO_SCENARIO_HINTS[scenario]}</p>

          <button
            type="button"
            onClick={() => setShowPlaybook((v) => !v)}
            className="mt-3 text-xs font-semibold text-[var(--content-accent)] pick-pressable"
          >
            {showPlaybook ? 'Hide playbook' : 'Show playbook'}
          </button>

          {showPlaybook ? (
            <div className="mt-3 space-y-3 rounded-xl border border-[var(--border-faint)] bg-[var(--bg-primary)] p-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
                  Edge cases
                </p>
                <ul className="mt-1.5 flex flex-wrap gap-1">
                  {playbook.edgeCases.map((c) => (
                    <li
                      key={c}
                      className="rounded-full bg-[var(--bg-tertiary)] px-2 py-0.5 text-[10px] text-[var(--content-secondary)]"
                    >
                      {c}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
                  Steps
                </p>
                <ol className="mt-1.5 list-decimal space-y-1 pl-4 text-xs leading-snug text-[var(--content-secondary)]">
                  {playbook.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </div>
            </div>
          ) : null}
        </div>

        <div className="overflow-hidden rounded-2xl border border-[var(--border-subtle)]">
          <PickerV10Flow
            key={scenario}
            lines={demoLines}
            orderLabel={DEMO_ORDER_LABEL}
            customerLabel={DEMO_CUSTOMER_LABEL}
            onHandoff={({ boxCount, entries }) => {
              toast.success(`Hand off · ${entries.length} lines · ${boxCount} boxes`);
            }}
          />
        </div>

        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
            State machine debug
          </p>
          <div className="flex items-center gap-3">
            <label className="flex flex-1 flex-col gap-1 text-xs text-[var(--content-tertiary)]">
              n (batch)
              <input
                type="number"
                min={0}
                value={debugQty.n}
                onChange={(e) => setDebugQty((d) => ({ ...d, n: Number(e.target.value) }))}
                className="min-h-10 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2 font-mono"
              />
            </label>
            <label className="flex flex-1 flex-col gap-1 text-xs text-[var(--content-tertiary)]">
              target
              <input
                type="number"
                min={1}
                value={debugQty.target}
                onChange={(e) => setDebugQty((d) => ({ ...d, target: Number(e.target.value) }))}
                className="min-h-10 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2 font-mono"
              />
            </label>
          </div>
          <p className="mt-2 font-mono text-sm text-[var(--content-primary)]">
            getQtyState → <span className="font-bold text-[var(--content-accent)]">{debugState}</span>
          </p>
        </div>

        <ModeCard
          icon={<Package size={20} className="text-[var(--content-positive)]" />}
          title="Live order sandbox"
          description="Production PickFlowPanel in lab mode — separate from Codex demo above."
          actionLabel="Load"
          onAction={loadOrder}
          showInput
          inputValue={orderInput}
          onInputChange={setOrderInput}
        />
      </div>
    </div>
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
  active = false,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
  showInput?: boolean;
  inputValue?: string;
  onInputChange?: (v: string) => void;
  active?: boolean;
}): React.JSX.Element {
  return (
    <div
      className={`rounded-2xl border p-4 ${
        active ? 'border-[var(--border-accent)] bg-[var(--bg-accent-subtle)]' : 'border-[var(--border-subtle)] bg-[var(--bg-secondary)]'
      }`}
    >
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
          disabled={active}
          className="w-full rounded-xl bg-[var(--bg-inverse-primary)] py-3.5 text-sm font-bold text-white pick-pressable disabled:opacity-60"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
