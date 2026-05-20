import { CheckCircle, Warning, X } from '@phosphor-icons/react';
import type { PickScanQuantityResult } from '../../../lib/scanner/pickScanQuantity';

export interface PickScanLabResultSheetProps {
  visible: boolean;
  open: boolean;
  partNo: string;
  itemName: string;
  quantity: PickScanQuantityResult;
  scanCount: number;
  outerCatalogQty: number | null;
  innerCatalogQty: number | null;
  onDismiss: () => void;
}

export function PickScanLabResultSheet({
  visible,
  open,
  partNo,
  itemName,
  quantity,
  scanCount,
  outerCatalogQty,
  innerCatalogQty,
  onDismiss,
}: PickScanLabResultSheetProps): React.JSX.Element | null {
  if (!visible) return null;

  const matched = quantity.qtyAdded > 0 || quantity.scanKind !== 'unknown';
  const added = quantity.qtyAdded;

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
                background: matched ? 'rgb(52,211,153)' : 'rgb(251,191,36)',
                transformOrigin: 'left center',
                animation: 'scannerShrinkX 3000ms linear forwards',
              }}
            />
          </div>

          <div className="mb-3 flex items-center gap-2">
            <div
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                matched ? 'bg-emerald-500/20' : 'bg-amber-400/20'
              }`}
            >
              {matched ? (
                <CheckCircle size={16} weight="fill" className="text-emerald-400" />
              ) : (
                <Warning size={16} weight="fill" className="text-amber-400" />
              )}
            </div>
            <p
              className={`text-[10px] font-bold uppercase tracking-[0.18em] ${
                matched ? 'text-emerald-400' : 'text-amber-400'
              }`}
            >
              {matched ? 'Pick scan' : 'No qty added'}
            </p>
            <button
              type="button"
              onClick={onDismiss}
              className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/8 text-slate-400"
            >
              <X size={13} weight="bold" />
            </button>
          </div>

          <p className="font-mono text-2xl font-black leading-none tracking-tight text-white">
            {partNo}
          </p>
          <p className="mt-1 line-clamp-2 text-sm text-slate-400">{itemName}</p>

          {(outerCatalogQty != null || innerCatalogQty != null) && (
            <p className="mt-2 text-xs text-slate-500">
              Catalog:{' '}
              {outerCatalogQty != null ? `outer ${outerCatalogQty} pcs` : ''}
              {outerCatalogQty != null && innerCatalogQty != null ? ' · ' : ''}
              {innerCatalogQty != null ? `inner ${innerCatalogQty} pcs` : ''}
            </p>
          )}

          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                This scan
              </p>
              <p className="mt-1 text-sm font-semibold text-white">
                {quantity.tierLabel ?? quantity.scanKind}
              </p>
              <p className="mt-0.5 font-mono text-lg font-bold text-emerald-300">+{added} pcs</p>
              {quantity.packQty != null && quantity.scanKind === 'pack' && (
                <p className="text-xs text-slate-400">Pack size {quantity.packQty} pcs</p>
              )}
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                Picked total
              </p>
              <p className="mt-1 font-mono text-2xl font-bold text-white">
                {quantity.totalAfter}
                <span className="text-base font-semibold text-slate-400">
                  {' '}
                  / {quantity.targetQty}
                </span>
              </p>
              <p className="mt-0.5 text-xs text-slate-400">
                {quantity.remainingAfter} left on this line
              </p>
            </div>
          </div>

          {quantity.requiresBreakConfirmation && (
            <p className="mt-3 rounded-xl bg-amber-500/15 px-3 py-2 text-sm font-semibold text-amber-200">
              Pack is larger than remaining qty — pick flow would ask to confirm break-pack.
            </p>
          )}
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
