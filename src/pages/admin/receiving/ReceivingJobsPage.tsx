import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, Truck } from '@phosphor-icons/react';
import { BigButton } from '../../../components/shared';
import { useAuth } from '../../../context/AuthContext';
import { useToast } from '../../../context/ToastContext';
import {
  createReceivingJobFromPurchaseOrder,
  fetchSentPurchaseOrdersForReceivingHub,
  RECEIVING_HUB_POS_QUERY_KEY,
} from '../../../lib/purchase/purchaseApi';
import {
  createManualArrivalJob,
  fetchJobLinesForJobIds,
  fetchReceivingJobs,
  RECEIVING_JOBS_QUERY_KEY,
} from '../../../lib/receiving/receivingApi';
import { deriveActiveStep, jobIsFullyComplete } from '../../../lib/receiving/receivingWorkflow';
import type { ReceivingJobLineRow, ReceivingJobRow } from '../../../types/receiving';

function formatInr(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n);
}

function todayLabel(): string {
  return new Date().toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

export default function ReceivingJobsPage(): React.JSX.Element {
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const { userId, userName } = useAuth();

  const posQuery = useQuery({
    queryKey: RECEIVING_HUB_POS_QUERY_KEY,
    queryFn: fetchSentPurchaseOrdersForReceivingHub,
  });

  const jobsQuery = useQuery({
    queryKey: RECEIVING_JOBS_QUERY_KEY,
    queryFn: () => fetchReceivingJobs(40),
  });

  const jobIds = useMemo(() => (jobsQuery.data ?? []).map((j) => j.id), [jobsQuery.data]);

  const jobLinesQuery = useQuery({
    queryKey: ['receiving', 'hub-lines', jobIds.join(',')],
    queryFn: () => fetchJobLinesForJobIds(jobIds),
    enabled: jobIds.length > 0,
  });

  const openJobs = useMemo(() => {
    const jobs = jobsQuery.data ?? [];
    const lines = jobLinesQuery.data ?? [];
    const linesByJob = new Map<number, typeof lines>();
    for (const l of lines) {
      const jid = l.receiving_job_id;
      if (!linesByJob.has(jid)) linesByJob.set(jid, []);
      linesByJob.get(jid)!.push(l);
    }
    const emptyPlates = new Map<number, []>();
    return jobs.filter((j) => {
      const jl = linesByJob.get(j.id) ?? [];
      if (jl.length === 0) return true;
      return !jobIsFullyComplete(j, jl, emptyPlates);
    });
  }, [jobsQuery.data, jobLinesQuery.data]);

  const createWalkInMut = useMutation({
    mutationFn: () => createManualArrivalJob(undefined, userId ?? null, userName ?? null),
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: RECEIVING_JOBS_QUERY_KEY });
      toast.success(`Job ${r.job_public_id}`);
      navigate(`/admin/receiving/${r.receiving_job_id}?step=truck`);
    },
    onError: () => toast.error('Could not create job.'),
  });

  const startFromPoMut = useMutation({
    mutationFn: (poId: number) => createReceivingJobFromPurchaseOrder(poId, userId ?? null, userName ?? null),
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: RECEIVING_JOBS_QUERY_KEY });
      await qc.invalidateQueries({ queryKey: RECEIVING_HUB_POS_QUERY_KEY });
      toast.success(`Receiving ${r.job_public_id}`);
      navigate(`/admin/receiving/${r.receiving_job_id}?step=truck`);
    },
    onError: (e: Error) => toast.error(e.message || 'Could not start receiving'),
  });

  const pendingPos = posQuery.data ?? [];
  const showBanner = pendingPos.length > 0 || openJobs.length > 0;

  return (
    <div className="role-admin min-h-screen bg-[var(--bg-primary)] px-4 py-6 lg:px-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-5">
        <div>
          <button
            type="button"
            onClick={() => navigate('/admin')}
            className="mb-2 inline-flex items-center gap-1 text-sm text-[var(--content-secondary)] hover:text-[var(--content-primary)]"
          >
            <ArrowLeft size={18} weight="bold" />
            Admin
          </button>
          <h1 className="text-2xl font-bold text-[var(--content-primary)]">Warehouse</h1>
          <p className="mt-1 text-sm text-[var(--content-tertiary)]">Today · {todayLabel()}</p>
        </div>

        {showBanner ? (
          <div className="rounded-2xl border border-sky-200/60 bg-sky-50 px-4 py-3 dark:border-sky-900/50 dark:bg-sky-950/40">
            <p className="text-sm font-semibold text-sky-900 dark:text-sky-100">Shipment expected today</p>
            <p className="mt-0.5 text-xs text-sky-800/80 dark:text-sky-200/80">
              {pendingPos.length > 0
                ? `${pendingPos.length} PO${pendingPos.length === 1 ? '' : 's'} awaiting dock`
                : null}
              {pendingPos.length > 0 && openJobs.length > 0 ? ' · ' : null}
              {openJobs.length > 0
                ? `${openJobs.length} job${openJobs.length === 1 ? '' : 's'} in progress`
                : null}
            </p>
          </div>
        ) : null}

        <p className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--content-tertiary)]">
          Tap when truck is at dock
        </p>

        {posQuery.isLoading || jobsQuery.isLoading ? (
          <p className="text-sm text-[var(--content-tertiary)]">Loading shipments…</p>
        ) : null}

        {pendingPos.map((card) => (
          <ShipmentCard
            key={`po-${card.po.id}`}
            title={card.po.supplier_name?.trim() || 'Supplier'}
            subtitle={`${card.po.po_number} · ${card.skuCount} SKU${card.skuCount === 1 ? '' : 's'}`}
            badge="Expected"
            valueLabel={formatInr(card.estimatedValue)}
            chips={card.lines.map((l) => `${l.description_snapshot} · ${l.qty_ordered} pcs`)}
            loading={startFromPoMut.isPending}
            onTruck={() => startFromPoMut.mutate(card.po.id)}
          />
        ))}

        {openJobs.map((job) => (
          <OpenJobCard
            key={job.id}
            job={job}
            lines={jobLinesQuery.data?.filter((l) => l.receiving_job_id === job.id) ?? []}
            onOpen={() => {
              const lines = jobLinesQuery.data?.filter((l) => l.receiving_job_id === job.id) ?? [];
              const emptyPlates = new Map<number, []>();
              const step = job.dock_arrived_at
                ? deriveActiveStep(job, lines, emptyPlates)
                : 'truck';
              navigate(`/admin/receiving/${job.id}?step=${step}`);
            }}
          />
        ))}

        {!posQuery.isLoading && !jobsQuery.isLoading && pendingPos.length === 0 && openJobs.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--border-subtle)] p-8 text-center text-sm text-[var(--content-tertiary)]">
            <p>No expected shipments.</p>
            <p className="mt-2">
              Mark a PO <strong className="text-[var(--content-secondary)]">sent</strong> in Purchase, or start a
              walk-in job.
            </p>
          </div>
        ) : null}

        <BigButton
          type="button"
          variant="secondary"
          className="w-full min-h-11"
          disabled={createWalkInMut.isPending}
          onClick={() => createWalkInMut.mutate()}
        >
          <Plus size={18} weight="bold" className="mr-1 inline" />
          New walk-in job
        </BigButton>
      </div>
    </div>
  );
}

function ShipmentCard({
  title,
  subtitle,
  badge,
  valueLabel,
  chips,
  loading,
  onTruck,
}: {
  title: string;
  subtitle: string;
  badge: string;
  valueLabel: string;
  chips: string[];
  loading: boolean;
  onTruck: () => void;
}): React.JSX.Element {
  return (
    <div className="rounded-2xl border-2 border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-lg font-bold text-[var(--content-primary)]">{title}</p>
          <p className="mt-0.5 text-sm text-[var(--content-tertiary)]">{subtitle}</p>
          {valueLabel ? (
            <p className="mt-1 font-mono text-sm font-semibold text-[var(--content-secondary)]">{valueLabel}</p>
          ) : null}
        </div>
        <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-bold uppercase text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {badge}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {chips.map((c) => (
          <span
            key={c}
            className="rounded-full bg-sky-100 px-2.5 py-1 text-xs font-medium text-sky-900 dark:bg-sky-950 dark:text-sky-100"
          >
            {c}
          </span>
        ))}
      </div>
      <BigButton
        type="button"
        variant="primary"
        className="mt-4 w-full min-h-12 bg-[var(--bg-accent)] text-[var(--content-on-color)]"
        disabled={loading}
        onClick={onTruck}
      >
        <Truck size={20} weight="bold" className="mr-2 inline" />
        Truck at dock — start receiving
      </BigButton>
    </div>
  );
}

function OpenJobCard({
  job,
  lines,
  onOpen,
}: {
  job: ReceivingJobRow;
  lines: ReceivingJobLineRow[];
  onOpen: () => void;
}): React.JSX.Element {
  const emptyPlates = new Map<number, []>();
  const step = job.dock_arrived_at ? deriveActiveStep(job, lines, emptyPlates) : 'truck';
  const stepLabel =
    step === 'truck' ? 'Confirm dock' : step === 'count' ? 'Count + labels' : step === 'mrp' ? 'MRP' : 'Putaway';

  return (
    <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-mono text-sm font-bold text-[var(--content-primary)]">{job.job_public_id}</p>
          <p className="mt-0.5 text-sm text-[var(--content-tertiary)]">
            {job.po_ref ?? job.source_ref} · {lines.length} line{lines.length === 1 ? '' : 's'}
          </p>
        </div>
        <span className="rounded-full bg-[var(--bg-accent-subtle)] px-2 py-1 text-[10px] font-bold uppercase text-[var(--content-accent)]">
          In progress
        </span>
      </div>
      <p className="mt-2 text-xs text-[var(--content-tertiary)]">Next: {stepLabel}</p>
      <BigButton type="button" variant="secondary" className="mt-3 w-full min-h-11" onClick={onOpen}>
        Continue receiving
      </BigButton>
    </div>
  );
}
