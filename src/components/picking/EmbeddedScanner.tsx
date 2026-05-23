import { useEffect, useRef, useState } from 'react';
import type { OrderItem } from '../../types';
import { LiveQrScanner, type LiveQrScannerResolved } from '../shared/LiveQrScanner';
import { deriveBusyCodeCandidates } from '../../lib/scanner/deriveBusyCodeCandidates';

interface EmbeddedScannerProps {
  active: boolean;
  orderItem: OrderItem;
  scannerMode: 'rack' | 'item';
  pickedSoFar: number;
  targetQty: number;
  onResolved: (result: LiveQrScannerResolved) => void;
  onManualVerify?: () => void;
}

export function EmbeddedScanner({
  active,
  orderItem,
  scannerMode,
  pickedSoFar,
  targetQty,
  onResolved,
  onManualVerify,
}: EmbeddedScannerProps): React.JSX.Element | null {
  const containerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        setVisible(entry?.isIntersecting ?? false);
      },
      { threshold: 0.35 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const cameraActive = active && visible;
  const busyCodes = deriveBusyCodeCandidates(orderItem);

  return (
    <div ref={containerRef} className="h-full min-h-[160px] p-2">
      {cameraActive ? (
        <LiveQrScanner
          embedded
          continuous
          paused={!cameraActive}
          title={scannerMode === 'rack' ? `Rack ${orderItem.rack_no ?? ''}` : orderItem.item_name}
          idleStatus="Point QR in frame — scans continuously"
          pickItem={{
            itemId: orderItem.item_id,
            name: orderItem.item_name,
            alias1: orderItem.catalog_alias1 ?? null,
            alias: orderItem.catalog_alias ?? orderItem.item_alias,
            itemCode: orderItem.item_alias,
            busyCode: busyCodes[0] ?? null,
            mainGroup: null,
            parentGroup: null,
          }}
          pickedSoFar={pickedSoFar}
          targetQty={targetQty}
          onClose={() => {}}
          onResolved={onResolved}
          onScanAccepted={onResolved}
          onManualVerify={onManualVerify}
          onError={() => {}}
        />
      ) : (
        <div className="flex h-full min-h-[160px] items-center justify-center rounded-2xl bg-slate-900/80 text-xs text-slate-400">
          {active ? 'Starting camera…' : 'Swipe here to scan'}
        </div>
      )}
    </div>
  );
}
