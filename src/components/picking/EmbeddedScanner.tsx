import { useEffect, useRef, useState } from 'react';
import { Camera } from '@phosphor-icons/react';
import type { OrderItem } from '../../types';
import { LiveQrScanner, type LiveQrScannerResolved } from '../shared/LiveQrScanner';
import { deriveBusyCodeCandidates } from '../../lib/scanner/deriveBusyCodeCandidates';

interface EmbeddedScannerProps {
  /** Card is the active swipe target */
  active: boolean;
  /** User tapped Scan — camera may run */
  cameraEngaged: boolean;
  orderItem: OrderItem;
  scannerMode: 'rack' | 'item';
  pickedSoFar: number;
  targetQty: number;
  onResolved: (result: LiveQrScannerResolved) => void;
}

export function EmbeddedScanner({
  active,
  cameraEngaged,
  orderItem,
  scannerMode,
  pickedSoFar,
  targetQty,
  onResolved,
}: EmbeddedScannerProps): React.JSX.Element {
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

  const cameraActive = active && cameraEngaged && visible;
  const busyCodes = deriveBusyCodeCandidates(orderItem);

  return (
    <div ref={containerRef} className="h-full min-h-[140px] p-2">
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
          onError={() => {}}
        />
      ) : (
        <div className="flex h-full min-h-[140px] flex-col items-center justify-center rounded-2xl bg-slate-950 px-4 text-center">
          <Camera
            size={28}
            weight="duotone"
            className="mb-2 text-slate-500"
            aria-hidden
          />
          <p className="text-sm font-medium text-slate-200">
            {cameraEngaged ? 'Starting camera…' : 'Camera off'}
          </p>
          <p className="mt-1 max-w-[220px] text-xs text-slate-500">
            {cameraEngaged
              ? 'Allow camera access if prompted'
              : scannerMode === 'rack'
                ? 'Tap Scan bin below when you reach the shelf'
                : 'Tap Scan item below to verify labels'}
          </p>
        </div>
      )}
    </div>
  );
}
