import { ArrowLeft, CheckCircle, WarningCircle } from '@phosphor-icons/react';
import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useItems } from '../../hooks/useItems';
import { useToast } from '../../context/ToastContext';
import { processOrderText } from '../../lib/ocr/pipeline';
import { supabase } from '../../lib/supabase/client';
import type { OcrStageItem, OcrStageRun, OcrRunSummary, OcrStageScreen } from './ocr-lab/types';
import { itemStatusComplete, recentRunFromStage, toStageProduct, toStageRun } from './ocr-lab/helpers';
import { OcrLabEditDrawer } from './ocr-lab/OcrLabEditDrawer';
import { OcrLabHomeScreen } from './ocr-lab/OcrLabHomeScreen';
import { OcrLabReviewScreen } from './ocr-lab/OcrLabReviewScreen';
import { OcrLabScanningScreen } from './ocr-lab/OcrLabScanningScreen';
import { OcrLabSummaryScreen } from './ocr-lab/OcrLabSummaryScreen';
import { OcrLabUploadScreen } from './ocr-lab/OcrLabUploadScreen';

const INITIAL_RUNS: OcrRunSummary[] = [
  { id: 'demo-1', customer: 'Sharma Auto Parts', itemCount: 4, status: 'Strong match', timeLabel: '2h ago' },
  { id: 'demo-2', customer: 'Indore Diesel House', itemCount: 6, status: 'Needs review', timeLabel: 'Yesterday' },
  { id: 'demo-3', customer: 'Bolero Spares Centre', itemCount: 3, status: 'Strong match', timeLabel: '2 days ago' },
];

function StageShell({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="relative flex h-full min-h-[780px] w-full max-w-[420px] flex-col overflow-hidden rounded-[2rem] border border-[var(--border-subtle)] bg-[var(--bg-secondary)] shadow-sm">
      <div className="border-b border-[var(--border-subtle)] bg-[var(--bg-tertiary)] px-5 py-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-ds-micro text-[var(--content-tertiary)]">Staged Sales Order</p>
            <p className="text-sm font-semibold text-[var(--content-primary)]">Internal preview flow</p>
          </div>
          <span className="rounded-full bg-[var(--bg-secondary)] px-3 py-1 text-xs font-medium text-[var(--content-secondary)]">
            Admin
          </span>
        </div>
      </div>
      <div className="relative flex-1 overflow-hidden">{children}</div>
    </div>
  );
}

function StageInspector({
  run,
  selectedItem,
}: {
  run: OcrStageRun | null;
  selectedItem: OcrStageItem | null;
}): React.JSX.Element {
  const exact = run?.items.filter((item) => item.source.match_strategy === 'exact_code').length ?? 0;
  const prefix = run?.items.filter((item) => item.source.match_strategy === 'prefix_code').length ?? 0;
  const search = run?.items.filter((item) => item.source.match_strategy === 'description_search').length ?? 0;

  return (
    <div className="flex w-full max-w-md flex-col gap-4">
      <div className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-5">
        <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--content-tertiary)]">Admin Insight</h2>
        {run ? (
          <div className="mt-4 space-y-3 text-sm text-[var(--content-secondary)]">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-[var(--bg-primary)] p-4"><p className="text-xs text-[var(--content-tertiary)]">Customer</p><p className="mt-1 font-semibold text-[var(--content-primary)]">{run.customerContext.resolved_customer_name ?? run.customerName ?? 'Unknown'}</p></div>
              <div className="rounded-2xl bg-[var(--bg-primary)] p-4"><p className="text-xs text-[var(--content-tertiary)]">Resolution</p><p className="mt-1 font-semibold text-[var(--content-primary)]">{run.customerContext.resolution_source}</p></div>
              <div className="rounded-2xl bg-[var(--bg-primary)] p-4"><p className="text-xs text-[var(--content-tertiary)]">Exact code</p><p className="mt-1 font-semibold text-[var(--content-primary)]">{exact}</p></div>
              <div className="rounded-2xl bg-[var(--bg-primary)] p-4"><p className="text-xs text-[var(--content-tertiary)]">Prefix/search</p><p className="mt-1 font-semibold text-[var(--content-primary)]">{prefix + search}</p></div>
            </div>
            <div className="rounded-2xl bg-[var(--bg-primary)] p-4">
              <div className="flex items-center gap-2 text-emerald-600"><CheckCircle size={16} /><span className="font-medium">Strong match = high or medium via exact/prefix</span></div>
              <div className="mt-2 flex items-center gap-2 text-amber-600"><WarningCircle size={16} /><span className="font-medium">Review match = low confidence description search</span></div>
            </div>
          </div>
        ) : (
          <p className="mt-4 text-sm text-[var(--content-tertiary)]">Paste order lines to inspect strategies, customer resolution, and candidate quality before wiring this into sales.</p>
        )}
      </div>

      <div className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-5">
        <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--content-tertiary)]">Selected Item</h2>
        {selectedItem ? (
          <div className="mt-4 space-y-3 text-sm text-[var(--content-secondary)]">
            <p className="font-semibold text-[var(--content-primary)]">{selectedItem.rawText}</p>
            <div className="rounded-2xl bg-[var(--bg-primary)] p-4">
              <p><span className="text-[var(--content-tertiary)]">Strategy:</span> {selectedItem.source.match_strategy}</p>
              <p className="mt-1"><span className="text-[var(--content-tertiary)]">Confidence:</span> {selectedItem.source.confidence}</p>
              <p className="mt-1"><span className="text-[var(--content-tertiary)]">History boost:</span> {selectedItem.source.history_boosted ? 'yes' : 'no'}</p>
            </div>
            <p className="rounded-2xl bg-[var(--bg-primary)] p-4 text-xs leading-6 text-[var(--content-secondary)]">{selectedItem.source.match_explanation}</p>
          </div>
        ) : (
          <p className="mt-4 text-sm text-[var(--content-tertiary)]">Select a matched line in review to inspect why it matched the way it did.</p>
        )}
      </div>
    </div>
  );
}

export default function OcrOrderLabPage(): React.JSX.Element {
  const navigate = useNavigate();
  const toast = useToast();
  const { data: items = [], isLoading: catalogLoading } = useItems();
  const catalog = useMemo(() => items.map(toStageProduct), [items]);

  const [screen, setScreen] = useState<OcrStageScreen>('home');
  const [orderText, setOrderText] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [run, setRun] = useState<OcrStageRun | null>(null);
  const [recentRuns, setRecentRuns] = useState<OcrRunSummary[]>(INITIAL_RUNS);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  const selectedItem = useMemo(
    () => run?.items.find((item) => item.id === selectedItemId) ?? null,
    [run, selectedItemId],
  );
  const allConfirmed = useMemo(
    () => (run ? run.items.every((item) => itemStatusComplete(item.status)) : false),
    [run],
  );

  const handleStartScan = useCallback(async () => {
    if (!orderText.trim()) {
      toast.warning('Paste at least one order line first');
      return;
    }
    setScreen('scanning');
    const startedAt = Date.now();
    try {
      const result = await processOrderText(orderText, supabase, customerId.trim() || undefined);
      const nextRun = toStageRun(result, catalog);
      const elapsed = Date.now() - startedAt;
      if (elapsed < 600) {
        await new Promise((resolve) => window.setTimeout(resolve, 600 - elapsed));
      }
      setRun(nextRun);
      setSelectedItemId(nextRun.items[0]?.id ?? null);
      setRecentRuns((prev) => [recentRunFromStage(nextRun), ...prev].slice(0, 4));
      setScreen('review');
      toast.success('Catalog matching ready for review');
    } catch (error) {
      setScreen('upload');
      toast.error(error instanceof Error ? error.message : 'Matching failed');
    }
  }, [catalog, customerId, orderText, toast]);

  const handleUpdateItem = useCallback((product: OcrStageItem['matchedProduct'], quantity: number) => {
    if (!run || !selectedItemId) return;
    setRun({
      ...run,
      items: run.items.map((item) => (
        item.id === selectedItemId
          ? { ...item, matchedProduct: product, quantity, status: item.matchedProduct?.id === product?.id && item.quantity === quantity ? 'confirmed' : 'edited' }
          : item
      )),
    });
  }, [run, selectedItemId]);

  const handleNavigateItem = useCallback((direction: 'prev' | 'next') => {
    if (!run || !selectedItemId) return;
    const index = run.items.findIndex((item) => item.id === selectedItemId);
    if (index < 0) return;
    const nextIndex = direction === 'next'
      ? (index + 1) % run.items.length
      : (index - 1 + run.items.length) % run.items.length;
    setSelectedItemId(run.items[nextIndex]?.id ?? null);
  }, [run, selectedItemId]);

  const resetFlow = useCallback(() => {
    setRun(null);
    setSelectedItemId(null);
    setCustomerId('');
    setOrderText('');
    setScreen('home');
  }, []);

  return (
    <div className="role-admin min-h-screen bg-[var(--bg-primary)]">
      <div className="mx-auto max-w-7xl p-4 lg:px-6">
        <div className="mb-6 flex items-center gap-3">
          <button onClick={() => navigate('/admin')} className="min-h-11 min-w-11 rounded-xl text-[var(--content-secondary)]">
            <ArrowLeft size={24} weight="bold" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-[var(--content-primary)]">Order Match Lab</h1>
            <p className="text-sm text-[var(--content-tertiary)]">
              Admin-only prototype for typed order lines against the live catalog matcher (no photo AI).
            </p>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[420px_1fr] lg:items-start">
          <StageShell>
            {screen === 'home' ? <OcrLabHomeScreen recentRuns={recentRuns} onNavigate={() => setScreen('upload')} /> : null}
            {screen === 'upload' ? (
              <OcrLabUploadScreen
                orderText={orderText}
                customerId={customerId}
                catalogReady={!catalogLoading}
                onBack={() => setScreen('home')}
                onCustomerIdChange={setCustomerId}
                onOrderTextChange={setOrderText}
                onScan={() => void handleStartScan()}
              />
            ) : null}
            {screen === 'scanning' ? <OcrLabScanningScreen /> : null}
            {screen === 'review' && run ? (
              <OcrLabReviewScreen
                run={run}
                selectedItemId={selectedItemId}
                allConfirmed={allConfirmed}
                onBack={() => setScreen('home')}
                onItemClick={setSelectedItemId}
                onProceed={() => setScreen('summary')}
              />
            ) : null}
            {screen === 'summary' && run ? <OcrLabSummaryScreen run={run} onBack={() => setScreen('review')} onFinish={resetFlow} /> : null}
            {screen === 'review' && run && selectedItem ? (
              <OcrLabEditDrawer
                item={selectedItem}
                itemIndex={run.items.findIndex((item) => item.id === selectedItem.id)}
                totalItems={run.items.length}
                catalog={catalog}
                onClose={() => setSelectedItemId(null)}
                onConfirm={handleUpdateItem}
                onNavigate={handleNavigateItem}
              />
            ) : null}
          </StageShell>

          <StageInspector run={run} selectedItem={selectedItem} />
        </div>
      </div>
    </div>
  );
}
