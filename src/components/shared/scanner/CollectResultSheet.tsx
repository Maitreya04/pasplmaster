import { CheckCircle, Package, X } from '@phosphor-icons/react';
import type { LiveQrScannerResolved } from '../../../lib/scanner/liveQrScannerTypes';

export interface CollectResultSheetProps {
  visible: boolean;
  open: boolean;
  lastScan: LiveQrScannerResolved;
  scanCount: number;
  onDismiss: () => void;
}

export function CollectResultSheet({
  visible,
  open,
  lastScan,
  scanCount,
  onDismiss,
}: CollectResultSheetProps): React.JSX.Element | null {
  if (!visible) return null;

  const isMatched = Boolean(lastScan.matchedItem);

  return (
    <>
      <div
        className="absolute inset-0 bg-slate-950/50"
        style={{
          opacity: open ? 1 : 0,
          transition: 'opacity 280ms cubic-bezier(0.32, 0.72, 0, 1)',
        }}
        onClick={onDismiss}
      />

      <div
        className="absolute inset-x-0 bottom-0"
        style={{
          transform: open ? 'translateY(0)' : 'translateY(100%)',
          transition: 'transform 340ms cubic-bezier(0.32, 0.72, 0, 1)',
        }}
      >
        <div className="rounded-t-[28px] border-t border-x border-white/10 bg-slate-900 px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3">
          <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/20" />

          <div
            key={scanCount}
            className="mb-4 h-0.5 w-full overflow-hidden rounded-full bg-white/10"
          >
            <div
              className="h-full rounded-full"
              style={{
                background: isMatched ? 'rgb(52,211,153)' : 'rgb(251,191,36)',
                transformOrigin: 'left center',
                animation: 'scannerShrinkX 3000ms linear forwards',
              }}
            />
          </div>

          <div className="flex items-center gap-2 mb-3">
            <div
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                isMatched ? 'bg-emerald-500/20' : 'bg-amber-400/20'
              }`}
            >
              {isMatched ? (
                <CheckCircle size={16} weight="fill" className="text-emerald-400" />
              ) : (
                <Package size={16} weight="fill" className="text-amber-400" />
              )}
            </div>
            <p
              className={`text-[10px] font-bold uppercase tracking-[0.18em] ${
                isMatched ? 'text-emerald-400' : 'text-amber-400'
              }`}
            >
              {isMatched ? 'Product recognized' : 'Not in catalog'}
            </p>
            <button
              type="button"
              onClick={onDismiss}
              className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/8 text-slate-400"
              style={{ transition: 'transform 120ms ease-out' }}
            >
              <X size={13} weight="bold" />
            </button>
          </div>

          {isMatched && lastScan.matchedItem ? (
            <div>
              <p className="text-xl font-bold leading-tight text-white">{lastScan.matchedItem.name}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {lastScan.matchedItem.busy_code != null && (
                  <span className="rounded-full border border-white/15 bg-white/8 px-2.5 py-0.5 font-mono text-xs text-slate-300">
                    Busy {lastScan.matchedItem.busy_code}
                  </span>
                )}
                {lastScan.matchedBy && (
                  <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-300">
                    via {lastScan.matchedBy}
                  </span>
                )}
                {lastScan.codeType !== 'unknown' && (
                  <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-xs text-slate-400 uppercase tracking-wide">
                    {lastScan.codeType}
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div>
              <p className="text-xl font-bold text-amber-200">Unknown barcode</p>
              <p className="mt-1 text-sm text-slate-400">
                No product matched in the scan catalog.
              </p>
            </div>
          )}

          <div className="mt-4 rounded-xl border border-white/8 bg-white/5 px-3 py-2">
            <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              Raw scan
            </p>
            <p className="break-all font-mono text-xs text-slate-300">
              {lastScan.rawValue.length > 80 ? `${lastScan.rawValue.slice(0, 80)}…` : lastScan.rawValue}
            </p>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes scannerShrinkX {
          from { transform: scaleX(1); }
          to   { transform: scaleX(0); }
        }
      `}</style>
    </>
  );
}
