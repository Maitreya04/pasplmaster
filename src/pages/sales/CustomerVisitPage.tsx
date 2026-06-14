import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  MapPin,
  ShoppingCart,
  CurrencyInr,
  ShareNetwork,
  Play,
} from '@phosphor-icons/react';
import { PageHeader, Card, BigButton, Skeleton } from '../../components/shared';
import { VisitBar } from '../../components/sales/VisitBar';
import { EndVisitSheet } from '../../components/sales/EndVisitSheet';
import { GeofenceWarningSheet } from '../../components/sales/GeofenceWarningSheet';
import { GeofenceOverrideSheet } from '../../components/sales/GeofenceOverrideSheet';
import { WorkdayBanner } from '../../components/sales/WorkdayBanner';
import { useCustomers } from '../../hooks/useCustomers';
import { getCustomerCity } from '../../lib/customerDisplay';
import { useVisitTracking } from '../../hooks/useVisitTracking';
import { fetchCustomerLastVisit } from '../../lib/visit/visitService';
import { formatTimeAgo } from '../../utils/formatters';
import { useToast } from '../../context/ToastContext';
import { useCart } from '../../context/CartContext';
import type { Customer } from '../../types';
import type { VisitOutcome } from '../../types/visit';

export default function CustomerVisitPage(): React.JSX.Element {
  const { customerId } = useParams<{ customerId: string }>();
  const id = Number(customerId);
  const navigate = useNavigate();
  const toast = useToast();
  const { setSelectedCustomer } = useCart();
  const { data: customers = [], isLoading } = useCustomers();
  const customer = useMemo(() => customers.find((c: Customer) => c.id === id), [customers, id]);

  const {
    activeVisit,
    pendingEvaluation,
    requestStartVisit,
    confirmWarnStart,
    confirmOverrideStart,
    cancelPendingStart,
    endVisit,
    isStarting,
    isEnding,
  } = useVisitTracking();

  const [endSheetOpen, setEndSheetOpen] = useState(false);
  const [warnOpen, setWarnOpen] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);

  const { data: lastVisit } = useQuery({
    queryKey: ['sales', 'customerLastVisit', id],
    queryFn: () => fetchCustomerLastVisit(id),
    enabled: Number.isFinite(id),
  });

  const visitForCustomer =
    activeVisit && activeVisit.customer_id === id ? activeVisit : null;

  const handleStartVisit = async () => {
    const result = await requestStartVisit(id, 'field');
    if (result.status === 'started') {
      toast.success('Visit started');
      return;
    }
    if (result.status === 'warn') {
      setWarnOpen(true);
      return;
    }
    if (result.status === 'override') {
      setOverrideOpen(true);
      return;
    }
    if (result.status === 'already_active') {
      toast.info('You already have a visit in progress');
      return;
    }
    toast.error('Could not start visit');
  };

  const handleEndVisit = async (payload: { outcome: VisitOutcome; notes: string }) => {
    if (!visitForCustomer) return;
    await endVisit({
      visitId: visitForCustomer.id,
      outcome: payload.outcome,
      notes: payload.notes,
    });
    setEndSheetOpen(false);
    toast.success('Visit completed');
  };

  if (isLoading) {
    return (
      <div className="p-4">
        <Skeleton variant="text" lines={8} />
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="p-4">
        <Card>
          <p className="text-sm text-[var(--content-secondary)]">Customer not found.</p>
          <Link to="/sales/beat" className="mt-3 inline-block text-sm font-semibold text-[var(--role-primary)]">
            Back to My beat
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] pb-8">
      <PageHeader title={customer.name} onBack={() => navigate('/sales/beat')} />
      <WorkdayBanner />

      <div className="px-4 space-y-4">
        <Card>
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-wide text-[var(--content-tertiary)]">Customer</p>
            <p className="text-lg font-semibold text-[var(--content-primary)]">{customer.name}</p>
            <p className="text-sm text-[var(--content-secondary)]">
              {getCustomerCity(customer) ?? '—'} · {customer.salesman ?? 'Unassigned'}
            </p>
            {lastVisit?.last_visit_at && (
              <p className="text-xs text-[var(--content-tertiary)]">
                Last visited {formatTimeAgo(lastVisit.last_visit_at)}
              </p>
            )}
          </div>
        </Card>

        {visitForCustomer && (
          <VisitBar visit={visitForCustomer} onEndVisit={() => setEndSheetOpen(true)} />
        )}

        <div className="grid grid-cols-2 gap-3">
          {!visitForCustomer ? (
            <button
              type="button"
              disabled={isStarting}
              onClick={() => void handleStartVisit()}
              className="col-span-2 flex items-center justify-center gap-2 rounded-xl bg-[var(--role-primary)] px-4 py-4 text-sm font-semibold text-white disabled:opacity-50"
            >
              <Play size={18} weight="fill" />
              Start visit
            </button>
          ) : null}

          <button
            type="button"
            onClick={() => {
              setSelectedCustomer(customer);
              navigate('/sales/new');
            }}
            className="flex flex-col items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-4"
          >
            <ShoppingCart size={22} className="text-[var(--role-primary)]" />
            <span className="text-sm font-semibold text-[var(--content-primary)]">New order</span>
          </button>

          <button
            type="button"
            onClick={() => toast.info('Payment recording coming soon')}
            className="flex flex-col items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-4"
          >
            <CurrencyInr size={22} className="text-[var(--role-primary)]" />
            <span className="text-sm font-semibold text-[var(--content-primary)]">Record payment</span>
          </button>

          <button
            type="button"
            onClick={() => {
              const text = `Outstanding statement for ${customer.name}`;
              const url = `https://wa.me/${customer.mobile?.replace(/\D/g, '') ?? ''}?text=${encodeURIComponent(text)}`;
              window.open(url, '_blank', 'noopener,noreferrer');
            }}
            className="col-span-2 flex items-center justify-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-3 text-sm font-semibold text-[var(--content-primary)]"
          >
            <ShareNetwork size={18} />
            Share ledger on WhatsApp
          </button>
        </div>

        <Card className="flex items-start gap-3">
          <MapPin size={20} className="mt-0.5 text-[var(--content-tertiary)]" />
          <p className="text-sm text-[var(--content-secondary)]">
            GPS is captured when you start a visit. After enough visits, the app learns this customer&apos;s
            location and helps verify future visits.
          </p>
        </Card>

        <BigButton variant="secondary" onClick={() => navigate('/sales/beat')}>
          Back to My beat
        </BigButton>
      </div>

      {visitForCustomer && (
        <EndVisitSheet
          isOpen={endSheetOpen}
          onClose={() => setEndSheetOpen(false)}
          startedAt={visitForCustomer.started_at}
          onComplete={handleEndVisit}
          isSubmitting={isEnding}
        />
      )}

      <GeofenceWarningSheet
        isOpen={warnOpen}
        customerName={customer.name}
        evaluation={pendingEvaluation}
        isSubmitting={isStarting}
        onCancel={() => {
          setWarnOpen(false);
          cancelPendingStart();
        }}
        onProceed={async () => {
          await confirmWarnStart();
          setWarnOpen(false);
          toast.success('Visit started');
        }}
      />

      <GeofenceOverrideSheet
        isOpen={overrideOpen}
        customerName={customer.name}
        evaluation={pendingEvaluation}
        isSubmitting={isStarting}
        onCancel={() => {
          setOverrideOpen(false);
          cancelPendingStart();
        }}
        onContinue={async (reason) => {
          await confirmOverrideStart(reason);
          setOverrideOpen(false);
          toast.success('Visit started');
        }}
      />
    </div>
  );
}
