import { ArrowLeft, CheckCircle } from '@phosphor-icons/react';
import { itemStatusComplete } from './helpers';
import type { OcrStageRun } from './types';

export function OcrLabSummaryScreen({
  run,
  onBack,
  onFinish,
}: {
  run: OcrStageRun;
  onBack: () => void;
  onFinish: () => void;
}): React.JSX.Element {
  const confirmedItems = run.items.filter((item) => itemStatusComplete(item.status) && item.matchedProduct);
  const totalAmount = confirmedItems.reduce((sum, item) => sum + (item.matchedProduct?.price ?? 0) * item.quantity, 0);

  return (
    <div className="flex h-full flex-col bg-[var(--bg-primary)]">
      <div className="flex items-center border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-4 shadow-sm">
        <button onClick={onBack} className="-ml-2 rounded-full p-2 text-[var(--content-secondary)] hover:bg-[var(--bg-tertiary)]">
          <ArrowLeft size={20} />
        </button>
        <h1 className="ml-2 text-base font-semibold text-[var(--content-primary)]">Final Sales Order</h1>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] shadow-sm">
          <div className="flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--role-primary-subtle)] px-4 py-3">
            <span className="text-sm font-semibold text-[var(--role-content)]">
              Customer: {run.customerContext.resolved_customer_name ?? run.customerName ?? 'Unknown customer'}
            </span>
          </div>

          <div className="divide-y divide-[var(--border-subtle)]">
            {confirmedItems.map((item, index) => (
              <div key={item.id} className="flex items-start justify-between p-4">
                <div className="flex gap-3">
                  <div className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-[var(--bg-tertiary)] text-xs font-medium text-[var(--content-tertiary)]">
                    {index + 1}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-[var(--content-primary)]">{item.matchedProduct?.name}</p>
                    <p className="mt-0.5 text-xs text-[var(--content-tertiary)]">
                      SKU: {item.matchedProduct?.sku} • ₹{item.matchedProduct?.price}/pc
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-[var(--content-primary)]">₹{(item.matchedProduct?.price ?? 0) * item.quantity}</p>
                  <p className="mt-0.5 text-xs text-[var(--content-tertiary)]">Qty: {item.quantity}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between border-t border-[var(--border-subtle)] bg-[var(--bg-tertiary)] p-4">
            <span className="font-medium text-[var(--content-secondary)]">Total Amount</span>
            <span className="text-xl font-bold text-[var(--content-primary)]">₹{totalAmount.toLocaleString('en-IN')}</span>
          </div>
        </div>
      </div>

      <div className="border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4 shadow-[0_-4px_10px_rgba(0,0,0,0.04)]">
        <button
          onClick={onFinish}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--bg-positive)] py-3.5 font-semibold text-white"
        >
          <CheckCircle size={20} />
          <span>Finish Staging Flow</span>
        </button>
      </div>
    </div>
  );
}
