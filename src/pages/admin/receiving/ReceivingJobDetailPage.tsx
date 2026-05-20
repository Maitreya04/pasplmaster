import {
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from '@phosphor-icons/react';
import { BigButton } from '../../../components/shared';
import { ReceivingGatePanel } from '../../../components/receiving/ReceivingGatePanel';
import { ReceivingSortPanel } from '../../../components/receiving/ReceivingSortPanel';
import { ReceivingStepper } from '../../../components/receiving/ReceivingStepper';
import { useAuth } from '../../../context/AuthContext';
import { useToast } from '../../../context/ToastContext';
import { PACK_DEFINITIONS_QUERY_KEY, fetchItemPackDefinitions } from '../../../lib/packLpn';
import { computeLabelPlan } from '../../../lib/labelStudio/computeLabelPlan';
import { normalizeSellUnit } from '../../../lib/labelStudio/computeLabelCountsFromRatio';
import { resolveSupplier, shouldBlockJobOnUnmapped } from '../../../lib/labelStudio/resolveSupplier';
import {
  canAdvanceToStep,
  deriveReceiveModeFromCounts,
  isStepComplete,
  parseWorkflowStep,
  resolveWorkflowStep,
} from '../../../lib/receiving/receivingWorkflow';
import {
  confirmDockArrival,
  fetchBarcodesForBusyCode,
  fetchJobLines,
  fetchLicensePlatesForJob,
  fetchReceivingJob,
  insertReceivingJobLine,
  updateReceivingJobLineRatio,
} from '../../../lib/receiving/receivingApi';
import { PutawayScanWizard } from './PutawayScanWizard';
import { useItems } from '../../../hooks/useItems';
import type { ItemPackDefinition } from '../../../types';
import type { PoVerificationStatus, ReceivingJobLineRow, ReceivingWorkflowStep } from '../../../types/receiving';

const linesKey = (id: number) => ['receiving', 'job', id, 'lines'] as const;

function Section({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return (
    <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4">
      <h2 className="text-sm font-bold uppercase tracking-[0.1em] text-[var(--content-accent)]">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export default function ReceivingJobDetailPage(): ReactElement {
  const { jobId: jobIdParam } = useParams<{ jobId: string }>();
  const jobId = Number(jobIdParam);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const toast = useToast();
  const qc = useQueryClient();
  const { userId, userName } = useAuth();
  const { data: items = [] } = useItems();

  const [asnRef, setAsnRef] = useState('');
  const [dockNote, setDockNote] = useState('');
  const [skuQuery, setSkuQuery] = useState('');
  const [newLot, setNewLot] = useState('');
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
  const [addBulkOnly, setAddBulkOnly] = useState(false);
  const [addMaster, setAddMaster] = useState('0');
  const [addInner, setAddInner] = useState('');
  const [addPiece, setAddPiece] = useState('');
  const [addEaPerInner, setAddEaPerInner] = useState('');
  const [addInnersPerOuter, setAddInnersPerOuter] = useState('');

  const jobQuery = useQuery({
    queryKey: ['receiving', 'job', jobId],
    queryFn: () => fetchReceivingJob(jobId),
    enabled: Number.isFinite(jobId) && jobId > 0,
  });

  const linesQuery = useQuery({
    queryKey: linesKey(jobId),
    queryFn: () => fetchJobLines(jobId),
    enabled: Number.isFinite(jobId) && jobId > 0,
  });

  const platesQuery = useQuery({
    queryKey: ['receiving', 'plates', jobId],
    queryFn: () => fetchLicensePlatesForJob(jobId),
    enabled: Number.isFinite(jobId) && jobId > 0,
  });

  const packQuery = useQuery({
    queryKey: PACK_DEFINITIONS_QUERY_KEY,
    queryFn: fetchItemPackDefinitions,
  });

  const packByBusy = useMemo(() => {
    const m = new Map<number, ItemPackDefinition>();
    for (const p of packQuery.data ?? []) m.set(Number(p.busy_code), p);
    return m;
  }, [packQuery.data]);

  const platesByLineId = useMemo(() => {
    const raw = platesQuery.data ?? new Map();
    const m = new Map<
      number,
      { receiving_lp_state?: string | null; receiving_putaway_ea_remaining?: number | null }[]
    >();
    for (const [lid, rows] of raw.entries()) {
      m.set(
        lid,
        rows.map((r: Record<string, unknown>) => ({
          receiving_lp_state: r.receiving_lp_state as string | null | undefined,
          receiving_putaway_ea_remaining: r.receiving_putaway_ea_remaining as number | null | undefined,
        })),
      );
    }
    return m;
  }, [platesQuery.data]);

  const job = jobQuery.data;
  const lines = linesQuery.data ?? [];

  const currentStep = useMemo((): ReceivingWorkflowStep => {
    if (!job) return 'truck';
    const requested = parseWorkflowStep(searchParams.get('step'));
    return resolveWorkflowStep(requested, job, lines, platesByLineId);
  }, [job, lines, platesByLineId, searchParams]);

  useEffect(() => {
    if (job?.asn_ref) setAsnRef(job.asn_ref);
    if (job?.dock_note) setDockNote(job.dock_note);
  }, [job?.asn_ref, job?.dock_note]);

  const setStep = (step: ReceivingWorkflowStep) => {
    setSearchParams({ step }, { replace: true });
  };

  const invalidateAll = () => {
    void qc.invalidateQueries({ queryKey: linesKey(jobId) });
    void qc.invalidateQueries({ queryKey: ['receiving', 'plates', jobId] });
    void qc.invalidateQueries({ queryKey: ['receiving', 'job', jobId] });
  };

  const dockMut = useMutation({
    mutationFn: () =>
      confirmDockArrival({
        jobId,
        userId: userId ?? null,
        userName: userName ?? null,
        asnRef: asnRef.trim() || null,
        dockNote: dockNote.trim() || null,
      }),
    onSuccess: (r) => {
      if (!r.success) {
        toast.error(r.reason ?? 'Could not confirm dock');
        return;
      }
      toast.success('Truck at dock confirmed');
      void qc.invalidateQueries({ queryKey: ['receiving', 'job', jobId] });
      setStep('count');
    },
    onError: () => toast.error('Could not confirm dock'),
  });

  const filteredItems = useMemo(() => {
    const q = skuQuery.trim().toLowerCase();
    return items
      .filter((i) => i.busy_code != null && Number(i.busy_code) > 0)
      .filter((i) => {
        if (!q) return true;
        return (
          i.name.toLowerCase().includes(q) ||
          String(i.busy_code).includes(q) ||
          (i.alias1?.toLowerCase().includes(q) ?? false) ||
          (i.alias?.toLowerCase().includes(q) ?? false)
        );
      })
      .slice(0, 40);
  }, [items, skuQuery]);

  const selectedItem = useMemo(
    () =>
      selectedItemId != null
        ? items.find((i) => Number(i.id) === Number(selectedItemId)) ?? null
        : null,
    [items, selectedItemId],
  );

  useEffect(() => {
    if (!selectedItem?.busy_code) return;
    const def = packByBusy.get(Number(selectedItem.busy_code));
    if (def?.inner_pack_qty != null && def.inner_pack_qty >= 1) {
      setAddEaPerInner(String(def.inner_pack_qty));
    }
    if (
      def?.outer_pack_qty != null &&
      def.inner_pack_qty != null &&
      def.inner_pack_qty >= 1 &&
      def.outer_pack_qty >= 1
    ) {
      setAddInnersPerOuter(String(Math.max(1, Math.floor(def.outer_pack_qty / def.inner_pack_qty))));
    }
  }, [selectedItem, packByBusy]);

  const addLineMutation = useMutation({
    mutationFn: async () => {
      if (!selectedItem || selectedItem.busy_code == null) throw new Error('sku');
      const lot = newLot.trim();
      if (!lot) throw new Error('lot');
      const masterN = addBulkOnly ? 0 : Math.max(0, Math.floor(Number(addMaster) || 0));
      const mode = deriveReceiveModeFromCounts({ looseOnly: addBulkOnly, masterLabels: masterN });
      const existing = linesQuery.data ?? [];
      const lineNo = (existing[existing.length - 1]?.line_no ?? 0) + 1;
      const bc = Number(selectedItem.busy_code);
      const def = packByBusy.get(bc);
      const eaPer =
        addEaPerInner.trim() ? Math.max(1, Math.floor(Number(addEaPerInner))) : Math.max(1, def?.inner_pack_qty ?? 1);
      const ipmVal =
        addInnersPerOuter.trim() !== '' ? Math.max(0, Math.floor(Number(addInnersPerOuter))) : null;

      const plan = computeLabelPlan({
        receiveMode: mode,
        outerLabels: mode === 'structured' ? masterN : 0,
        innerLabels: addBulkOnly ? 0 : Number(addInner) || 0,
        pieceLabels: Number(addPiece) || 0,
        pcsPerInner: eaPer,
        looseTotalEa: addBulkOnly ? Number(addPiece) || Number(addInner) || 0 : 0,
      });

      if (!addBulkOnly && plan.masterLabelsCount + plan.innerLabelsCount + plan.eachLabelsCount <= 0) {
        throw new Error('labels');
      }
      if (plan.innerLabelsCount > 0 && eaPer <= 0) throw new Error('pcs');

      const jobHeader = await fetchReceivingJob(jobId);
      if (!jobHeader) throw new Error('job_missing');
      const barcodes = await fetchBarcodesForBusyCode(bc);
      const resolved = resolveSupplier({
        barcodeRows: barcodes,
        preferredSupplierType: def?.supplier_type ?? null,
        triggeredBy: jobHeader.triggered_by,
      });
      if (shouldBlockJobOnUnmapped(jobHeader.triggered_by, resolved.status)) {
        throw new Error('supplier_map');
      }

      return insertReceivingJobLine({
        receiving_job_id: jobId,
        line_no: lineNo,
        busy_code: bc,
        sku_description_snapshot: selectedItem.name,
        supplier_type_snapshot: def?.supplier_type ?? null,
        supplier_code_resolved: resolved.code,
        supplier_code_status: resolved.status,
        lot_no: lot,
        receive_mode: mode,
        master_carton_qty: plan.masterCartonQty,
        inner_per_master: ipmVal,
        inner_pack_count: plan.innerPackCount,
        ea_per_inner: plan.eaPerInner,
        total_ea: plan.totalEa,
        ratio_matches_master: null,
        nominal_outer_qty: def?.outer_pack_qty ?? null,
        nominal_inner_qty: def?.inner_pack_qty ?? null,
        master_labels_count: plan.masterLabelsCount,
        inner_labels_count: plan.innerLabelsCount,
        each_labels_count: plan.eachLabelsCount,
        mrp_per_ea: null,
        invoice_rate_per_ea: null,
        dock_damage_note: null,
        loose_target_bin_id: null,
        ratio_verified_at: null,
        ratio_verified_by_user_id: null,
        ratio_verified_by_name: null,
        labels_printed_at: null,
        sell_unit_snapshot: normalizeSellUnit(def?.sell_unit ?? undefined),
      });
    },
    onSuccess: () => {
      invalidateAll();
      toast.success('Line added');
      setNewLot('');
      setSelectedItemId(null);
      setSkuQuery('');
      setAddMaster('0');
      setAddInner('');
      setAddPiece('');
      setAddInnersPerOuter('');
      setAddEaPerInner('');
    },
    onError: (e: Error) =>
      toast.error(
        e.message === 'lot'
          ? 'Lot number required.'
          : e.message === 'labels'
            ? 'Enter at least one label count.'
            : e.message === 'pcs'
              ? 'Pieces per inner required.'
              : e.message === 'supplier_map'
                ? 'Map supplier barcode first (invoice job).'
                : 'Could not add line.',
      ),
  });

  if (!Number.isFinite(jobId) || jobId <= 0) {
    return (
      <div className="role-admin p-6">
        <p className="text-sm text-[var(--content-warning)]">Invalid job.</p>
      </div>
    );
  }

  if (jobQuery.isLoading || !job) {
    return (
      <div className="role-admin p-6">
        <p className="text-sm text-[var(--content-tertiary)]">Loading job…</p>
      </div>
    );
  }

  const countDone = isStepComplete('count', job, lines, platesByLineId);
  const mrpDone = isStepComplete('mrp', job, lines, platesByLineId);

  return (
    <div className="role-admin min-h-screen bg-[var(--bg-primary)] px-4 py-6 pb-24 lg:px-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <div>
          <button
            type="button"
            onClick={() => navigate('/admin/receiving')}
            className="mb-2 inline-flex items-center gap-1 text-sm text-[var(--content-secondary)]"
          >
            <ArrowLeft size={18} weight="bold" />
            Warehouse
          </button>
          <h1 className="font-mono text-xl font-bold text-[var(--content-primary)]">{job.job_public_id}</h1>
          <p className="mt-1 text-xs text-[var(--content-tertiary)]">
            {job.envelope_code} · {job.po_ref ?? job.source_ref}
          </p>
        </div>

        <ReceivingStepper
          currentStep={currentStep}
          job={job}
          lines={lines}
          platesByLineId={platesByLineId}
          onStepClick={(step) => {
            if (canAdvanceToStep(step, job, lines, platesByLineId) || step === currentStep) {
              setStep(step);
            }
          }}
        />

        {currentStep === 'truck' ? (
          <Section title="Truck at dock">
            <p className="text-sm text-[var(--content-secondary)]">
              Confirm the shipment is on the dock before counting and printing labels.
            </p>
            <p className="mt-2 font-mono text-sm">
              {lines.length} GRN line{lines.length === 1 ? '' : 's'} on this job
            </p>
            <label className="mt-4 block text-xs font-semibold uppercase text-[var(--content-tertiary)]">
              ASN / vehicle ref (optional)
              <input
                value={asnRef}
                onChange={(e) => setAsnRef(e.target.value)}
                className="mt-1 min-h-11 w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 font-mono text-sm"
              />
            </label>
            <label className="mt-3 block text-xs font-semibold uppercase text-[var(--content-tertiary)]">
              Dock note (optional)
              <textarea
                value={dockNote}
                onChange={(e) => setDockNote(e.target.value)}
                rows={2}
                className="mt-1 w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 text-sm"
              />
            </label>
            <BigButton
              type="button"
              variant="primary"
              className="mt-4 w-full min-h-12 bg-[var(--bg-accent)] text-[var(--content-on-color)]"
              disabled={dockMut.isPending}
              onClick={() => dockMut.mutate()}
            >
              {job.dock_arrived_at ? 'Update dock info & continue' : 'Confirm truck at dock'}
            </BigButton>
            {job.dock_arrived_at ? (
              <BigButton
                type="button"
                variant="secondary"
                className="mt-2 w-full min-h-11"
                onClick={() => setStep('count')}
              >
                Continue to count + labels
              </BigButton>
            ) : null}
          </Section>
        ) : null}

        {currentStep === 'count' ? (
          <>
            <Section title="Phase 1 · Gate — masters">
              <p className="text-sm text-[var(--content-secondary)]">
                Enter how many sealed outer boxes hit the dock per SKU. Pack sizes pre-fill from{' '}
                <strong>Book box</strong> catalog (MAST.BOX / INNER.BOX) when imported on Upload.
              </p>
              {packQuery.isLoading ? (
                <p className="mt-2 text-xs text-[var(--content-tertiary)]">Loading pack catalog…</p>
              ) : (packQuery.data?.length ?? 0) === 0 ? (
                <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                  Pack catalog empty — upload Book box.xlsx on Admin → Upload Data first.
                </p>
              ) : null}
              <div className="mt-4">
                <ReceivingGatePanel
                  job={job}
                  lines={lines}
                  items={items}
                  packByBusy={packByBusy}
                  userId={userId ?? null}
                  userName={userName ?? null}
                  onUpdated={invalidateAll}
                  onAllDone={() => {
                    const el = document.getElementById('receiving-sort-panel');
                    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                />
              </div>
            </Section>

            <Section title="Phase 2 · Sort — inner + piece breakup">
              <div id="receiving-sort-panel">
                <p className="text-sm text-[var(--content-secondary)]">
                  Floor: open outers, enter sticker counts, tap <strong>Save all breakup</strong>.
                  Desk: one operator taps <strong>Print all at desk</strong> for one combined print.
                </p>
                <div className="mt-4">
                  <ReceivingSortPanel
                    job={job}
                    jobId={jobId}
                    lines={lines}
                    items={items}
                    packByBusy={packByBusy}
                    userId={userId ?? null}
                    userName={userName ?? null}
                    onUpdated={invalidateAll}
                  />
                </div>
              </div>
            </Section>

            <Section title="Add GRN line">
              <p className="text-sm text-[var(--content-secondary)]">
                Only if this delivery has a SKU not already on the GRN.
              </p>
              <label className="mt-3 block text-xs font-semibold uppercase text-[var(--content-tertiary)]">
                Search SKU
              </label>
              <input
                value={skuQuery}
                onChange={(e) => setSkuQuery(e.target.value)}
                className="mt-1 min-h-11 w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 text-sm"
              />
              <div className="mt-2 max-h-40 overflow-y-auto rounded-xl border border-[var(--border-subtle)]">
                {filteredItems.map((it) => (
                  <label
                    key={it.id}
                    className="flex cursor-pointer items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-2 text-sm last:border-b-0"
                  >
                    <input
                      type="radio"
                      name="add-sku"
                      checked={selectedItemId === Number(it.id)}
                      onChange={() => setSelectedItemId(Number(it.id))}
                    />
                    <span className="font-mono font-semibold">{it.busy_code}</span> {it.name}
                  </label>
                ))}
              </div>
              <label className="mt-3 block text-xs font-semibold uppercase text-[var(--content-tertiary)]">
                Lot (required)
              </label>
              <input
                value={newLot}
                onChange={(e) => setNewLot(e.target.value)}
                className="mt-1 min-h-11 w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 font-mono text-sm"
              />
              <label className="mt-3 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={addBulkOnly}
                  onChange={(e) => setAddBulkOnly(e.target.checked)}
                />
                Bulk only (BIN, no labels)
              </label>
              {!addBulkOnly ? (
                <div className="mt-3 space-y-2">
                  <label className="block text-xs font-semibold">
                    Master cartons
                    <input
                      value={addMaster}
                      onChange={(e) => setAddMaster(e.target.value.replace(/[^\d]/g, ''))}
                      className="mt-1 min-h-11 w-24 rounded-lg border px-2 font-mono"
                      placeholder="0"
                    />
                  </label>
                  <label className="block text-xs font-semibold">
                    Inner labels
                    <input
                      value={addInner}
                      onChange={(e) => setAddInner(e.target.value.replace(/[^\d]/g, ''))}
                      className="mt-1 min-h-11 w-full rounded-lg border px-2 font-mono"
                    />
                  </label>
                  <label className="block text-xs font-semibold">
                    Piece labels
                    <input
                      value={addPiece}
                      onChange={(e) => setAddPiece(e.target.value.replace(/[^\d]/g, ''))}
                      className="mt-1 min-h-11 w-full rounded-lg border px-2 font-mono"
                    />
                  </label>
                  <label className="block text-xs font-semibold">
                    Pcs per inner
                    <input
                      value={addEaPerInner}
                      onChange={(e) => setAddEaPerInner(e.target.value.replace(/[^\d]/g, ''))}
                      className="mt-1 min-h-11 w-full rounded-lg border px-2 font-mono"
                    />
                  </label>
                  {Number(addMaster) > 0 ? (
                    <label className="block text-xs font-semibold">
                      Inners per outer
                      <input
                        value={addInnersPerOuter}
                        onChange={(e) => setAddInnersPerOuter(e.target.value.replace(/[^\d]/g, ''))}
                        className="mt-1 min-h-11 w-full rounded-lg border px-2 font-mono"
                      />
                    </label>
                  ) : null}
                </div>
              ) : (
                <label className="mt-2 block text-xs font-semibold">
                  Total pieces
                  <input
                    value={addPiece}
                    onChange={(e) => setAddPiece(e.target.value.replace(/[^\d]/g, ''))}
                    className="mt-1 min-h-11 w-full rounded-lg border px-2 font-mono"
                  />
                </label>
              )}
              <BigButton
                type="button"
                variant="primary"
                className="mt-4 w-full bg-[var(--bg-accent)] text-[var(--content-on-color)]"
                disabled={!selectedItem || addLineMutation.isPending}
                onClick={() => addLineMutation.mutate()}
              >
                Add line
              </BigButton>
            </Section>

            {countDone ? (
              <BigButton
                type="button"
                variant="primary"
                className="w-full min-h-11 bg-[var(--bg-accent)] text-[var(--content-on-color)]"
                onClick={() => setStep('mrp')}
              >
                Continue to MRP check
              </BigButton>
            ) : (
              <p className="text-center text-xs text-[var(--content-tertiary)]">
                Save &amp; print labels on every GRN line to continue.
              </p>
            )}
          </>
        ) : null}

        {currentStep === 'mrp' ? (
          <>
            <Section title="GRN — MRP check">
              <p className="text-sm text-[var(--content-secondary)]">
                Enter MRP per SKU before putaway. Required for bin layers.
              </p>
              <div className="mt-3 overflow-hidden rounded-xl border border-[var(--border-subtle)]">
                <div className="hidden grid-cols-[2rem_1fr_5rem_6rem] gap-2 border-b bg-[var(--bg-secondary)] px-3 py-2 text-[10px] font-bold uppercase text-[var(--content-tertiary)] sm:grid">
                  <span>Ln</span>
                  <span>SKU</span>
                  <span>Lot</span>
                  <span>MRP/ea</span>
                </div>
                {lines.map((l) => (
                  <MrpGrnRow key={l.id} line={l} onSaved={invalidateAll} />
                ))}
              </div>
              <PoVerificationBlock
                lines={lines}
                userId={userId ?? null}
                userName={userName ?? null}
                onSaved={invalidateAll}
              />
            </Section>
            {mrpDone ? (
              <BigButton
                type="button"
                variant="primary"
                className="w-full min-h-11 bg-[var(--bg-accent)] text-[var(--content-on-color)]"
                onClick={() => setStep('putaway')}
              >
                Continue to putaway
              </BigButton>
            ) : (
              <p className="text-center text-xs text-[var(--content-tertiary)]">Set MRP on every line to continue.</p>
            )}
          </>
        ) : null}

        {currentStep === 'putaway' ? (
          <Section title="Putaway">
            <p className="text-sm text-[var(--content-secondary)]">
              Scan inner carton, then confirm BIN. MRP batches apply to picker shelf.
            </p>
            {lines.map((line) =>
              line.receive_mode === 'loose' ? (
                <div
                  key={line.id}
                  className="mt-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-3 text-sm"
                >
                  <p className="font-mono font-bold">
                    {line.busy_code} · loose
                  </p>
                  <p className="mt-1 text-[var(--content-tertiary)]">
                    {line.total_ea} pcs → BIN {line.loose_target_bin_id ?? '—'}
                  </p>
                </div>
              ) : (
                <PutawayScanWizard
                  key={line.id}
                  line={line}
                  jobId={jobId}
                  items={items}
                  packDef={packByBusy.get(Number(line.busy_code))}
                  userId={userId ?? null}
                  userName={userName ?? null}
                  onChange={invalidateAll}
                />
              ),
            )}
          </Section>
        ) : null}
      </div>
    </div>
  );
}

function MrpGrnRow({ line, onSaved }: { line: ReceivingJobLineRow; onSaved: () => void }): ReactElement {
  const toast = useToast();
  const save = useMutation({
    mutationFn: async (mrp: number | null) => {
      await updateReceivingJobLineRatio(line.id, { mrp_per_ea: mrp });
    },
    onSuccess: () => {
      toast.success('MRP saved');
      onSaved();
    },
  });

  return (
    <div className="grid grid-cols-1 gap-2 border-b border-[var(--border-subtle)] px-3 py-3 last:border-b-0 sm:grid-cols-[2rem_1fr_5rem_6rem] sm:items-center">
      <span className="font-mono text-xs font-bold">{line.line_no}</span>
      <span className="min-w-0">
        <span className="font-mono text-sm font-bold">{line.busy_code}</span>
        <span className="block truncate text-xs">{line.sku_description_snapshot}</span>
      </span>
      <span className="font-mono text-xs text-[var(--content-tertiary)]">{line.lot_no}</span>
      <label className="text-xs font-semibold">
        ₹/ea
        <input
          type="number"
          step="0.01"
          defaultValue={line.mrp_per_ea ?? ''}
          className="mt-1 min-h-10 w-full rounded-lg border border-[var(--border-subtle)] px-2 font-mono"
          onBlur={(e) => {
            const v = e.target.value === '' ? null : Number(e.target.value);
            if (v !== line.mrp_per_ea) save.mutate(v);
          }}
        />
      </label>
    </div>
  );
}

function PoVerificationBlock({
  lines,
  userId,
  userName,
  onSaved,
}: {
  lines: ReceivingJobLineRow[];
  userId: number | null;
  userName: string | null;
  onSaved: () => void;
}): ReactElement {
  const toast = useToast();
  const save = useMutation({
    mutationFn: async (payload: { id: number; status: PoVerificationStatus; note: string | null }) => {
      await updateReceivingJobLineRatio(payload.id, {
        po_verification_status: payload.status,
        po_verification_note: payload.note,
        po_verified_at: new Date().toISOString(),
        po_verified_by_user_id: userId,
        po_verified_by_name: userName,
      });
    },
    onSuccess: () => {
      toast.success('PO check saved');
      onSaved();
    },
  });

  if (lines.length === 0) return <></>;

  return (
    <details className="mt-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-3">
      <summary className="cursor-pointer text-xs font-bold uppercase text-[var(--content-tertiary)]">
        PO / challan check (optional)
      </summary>
      <div className="mt-3 space-y-2">
        {lines.map((l) => (
          <div key={l.id} className="flex flex-wrap gap-2 text-xs">
            <span className="font-mono">{l.busy_code}</span>
            <select
              defaultValue={l.po_verification_status}
              className="min-h-9 rounded border px-2"
              onChange={(e) =>
                save.mutate({
                  id: l.id,
                  status: e.target.value as PoVerificationStatus,
                  note: l.po_verification_note,
                })
              }
            >
              <option value="UNVERIFIED">Unverified</option>
              <option value="VERIFIED">Verified</option>
              <option value="DISCREPANCY">Discrepancy</option>
            </select>
          </div>
        ))}
      </div>
    </details>
  );
}
