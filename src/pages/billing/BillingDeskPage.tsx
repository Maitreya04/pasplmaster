import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useBillingDeskOrders, orderNeedsDeskFlagAction } from '../../hooks/useBillingDeskOrders';
import { LiveQueueWorkspace } from './LiveQueue/LiveQueueWorkspace';
import { DeskMobileFallback } from './BillingDesk/DeskMobileFallback';
import { DeskOrderOverlay } from './BillingDesk/DeskOrderOverlay';
import { DeskOrdersPanel } from './BillingDesk/DeskOrdersPanel';
import { DeskSplitPane } from './BillingDesk/DeskSplitPane';
import type { DeskOrderRow } from '../../hooks/useBillingDeskOrders';

export default function BillingDeskPage(): React.JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();
  const { flaggedOrders, listOrders, staleCount, completedCount, isLoading, all } =
    useBillingDeskOrders();

  const [manualOverlay, setManualOverlay] = useState<{
    order: DeskOrderRow;
    flaggedMode: boolean;
  } | null>(null);
  const [dismissedUrlOpen, setDismissedUrlOpen] = useState(false);
  const clearedUrlRef = useRef(false);

  const preselectedId = searchParams.get('orderId')
    ? Number(searchParams.get('orderId'))
    : null;

  const urlOverlay = useMemo(() => {
    if (dismissedUrlOpen || !preselectedId || all.length === 0) return null;
    const found = all.find((o) => o.id === preselectedId);
    if (!found) return null;
    return {
      order: found,
      flaggedMode: orderNeedsDeskFlagAction(found),
    };
  }, [all, dismissedUrlOpen, preselectedId]);

  useEffect(() => {
    if (!urlOverlay || clearedUrlRef.current) return;
    clearedUrlRef.current = true;
    setSearchParams({}, { replace: true });
  }, [urlOverlay, setSearchParams]);

  const overlay = manualOverlay ?? urlOverlay;

  const handleSelectOrder = useCallback((order: DeskOrderRow, flaggedMode: boolean) => {
    setManualOverlay({ order, flaggedMode });
  }, []);

  const handleCloseOverlay = useCallback(() => {
    setManualOverlay(null);
    setDismissedUrlOpen(true);
  }, []);

  return (
    <>
      <DeskMobileFallback />

      <div className="hidden lg:flex flex-col h-[calc(100vh-0px)] min-h-[660px] p-4 lg:p-6 density-compact">
        <div className="relative flex-1 min-h-0 rounded-xl border border-[var(--border-subtle)] overflow-hidden bg-[var(--bg-primary)]">
          <DeskSplitPane
            left={<LiveQueueWorkspace embedded />}
            right={
              <DeskOrdersPanel
                allOrders={all}
                listOrders={listOrders}
                flaggedOrders={flaggedOrders}
                staleCount={staleCount}
                completedCount={completedCount}
                isLoading={isLoading}
                onSelectOrder={handleSelectOrder}
              />
            }
          />

          {overlay && (
            <DeskOrderOverlay
              order={overlay.order}
              flaggedMode={overlay.flaggedMode}
              onClose={handleCloseOverlay}
            />
          )}
        </div>
      </div>
    </>
  );
}
