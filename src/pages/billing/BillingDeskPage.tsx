import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useBillingDeskOrders, orderHasDeskPickerFlags } from '../../hooks/useBillingDeskOrders';
import { LiveQueueWorkspace } from './LiveQueue/LiveQueueWorkspace';
import { DeskMobileFallback } from './BillingDesk/DeskMobileFallback';
import { DeskBillWorkspace } from './BillingDesk/DeskBillWorkspace';
import { DeskOrdersPanel } from './BillingDesk/DeskOrdersPanel';
import { DeskSplitPane } from './BillingDesk/DeskSplitPane';
import type { DeskOrderRow } from '../../hooks/useBillingDeskOrders';

export default function BillingDeskPage(): React.JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();
  const { listOrders, resolveCount, assignCount, pickingCount, completedCount, isLoading, all } =
    useBillingDeskOrders();

  const [selectedDesk, setSelectedDesk] = useState<{
    order: DeskOrderRow;
    flaggedMode: boolean;
  } | null>(null);
  const [dismissedUrlOpen, setDismissedUrlOpen] = useState(false);
  const clearedUrlRef = useRef(false);

  const preselectedId = searchParams.get('orderId')
    ? Number(searchParams.get('orderId'))
    : null;

  const urlSelection = useMemo(() => {
    if (dismissedUrlOpen || !preselectedId || all.length === 0) return null;
    const found = all.find((o) => o.id === preselectedId);
    if (!found) return null;
    return {
      order: found,
      flaggedMode: orderHasDeskPickerFlags(found),
    };
  }, [all, dismissedUrlOpen, preselectedId]);

  useEffect(() => {
    if (!urlSelection || clearedUrlRef.current) return;
    clearedUrlRef.current = true;
    setSearchParams({}, { replace: true });
  }, [urlSelection, setSearchParams]);

  const selection = useMemo(() => {
    const base = selectedDesk ?? urlSelection;
    if (!base) return null;
    const fresh = all.find((o) => o.id === base.order.id);
    return {
      order: fresh ?? base.order,
      flaggedMode: base.flaggedMode,
    };
  }, [all, selectedDesk, urlSelection]);

  const handleSelectOrder = useCallback((order: DeskOrderRow, flaggedMode: boolean) => {
    setSelectedDesk({ order, flaggedMode });
  }, []);

  const handleClearSelection = useCallback(() => {
    setSelectedDesk(null);
    setDismissedUrlOpen(true);
  }, []);

  const selectedOrderId = selection?.order.id ?? null;

  const leftPane = selection ? (
    <DeskBillWorkspace
      key={selection.order.id}
      order={selection.order}
      flaggedMode={selection.flaggedMode}
      onClearSelection={handleClearSelection}
    />
  ) : (
    <LiveQueueWorkspace embedded />
  );

  return (
    <>
      <DeskMobileFallback />

      <div className="hidden lg:flex flex-col flex-1 min-h-0 overflow-hidden p-4 lg:p-6">
        <div className="desk-panel flex flex-col flex-1 min-h-0 rounded-xl border border-[var(--border-subtle)] overflow-hidden bg-[var(--bg-primary)]">
          <DeskSplitPane
            left={leftPane}
            right={
              <DeskOrdersPanel
                allOrders={all}
                listOrders={listOrders}
                resolveCount={resolveCount}
                assignCount={assignCount}
                pickingCount={pickingCount}
                completedCount={completedCount}
                isLoading={isLoading}
                selectedOrderId={selectedOrderId}
                onSelectOrder={handleSelectOrder}
              />
            }
          />
        </div>
      </div>
    </>
  );
}
