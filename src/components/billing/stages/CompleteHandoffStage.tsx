import { useEffect, useMemo } from 'react';
import { ArrowRight, Check, Copy, WhatsappLogo } from '@phosphor-icons/react';
import { useCopyToClipboard } from '../../../hooks/useCopyToClipboard';
import { buildBillingHandoffReportText } from '../../../lib/billing/billingHandoffMessage';
import type { FulfillmentPath, OrderItem } from '../../../types';
import type { ItemFlag } from '../../../hooks/useBillingFlow';
import type { BillSheetEdits } from '../../../hooks/useBillSheetEdits';
import { BillingActionBar } from '../chrome/BillingActionBar';

interface CompleteHandoffStageProps {
  variant: 'report' | 'bill_save';
  orderNumber: string;
  orderName: string;
  salesperson: string | null;
  items?: OrderItem[];
  flags?: Record<number, ItemFlag>;
  resolvedFulfillmentPath?: FulfillmentPath;
  effectivePickLineCount?: number;
  totalWaiting?: number;
  onNext?: () => void;
  billSheet?: BillSheetEdits;
  readOnly?: boolean;
}

export function CompleteHandoffStage({
  variant,
  orderNumber,
  orderName,
  salesperson,
  items = [],
  flags = {},
  resolvedFulfillmentPath = 'warehouse_pick',
  effectivePickLineCount = 0,
  totalWaiting = 0,
  onNext,
  billSheet,
  readOnly = false,
}: CompleteHandoffStageProps): React.JSX.Element {
  const { copy, copiedId } = useCopyToClipboard();
  const hasFlags = Object.keys(flags).length > 0;

  const message = useMemo(
    () =>
      buildBillingHandoffReportText({
        orderNumber,
        orderName,
        salesperson,
        items,
        flags,
        resolvedFulfillmentPath,
        effectivePickLineCount,
      }),
    [
      orderNumber,
      orderName,
      salesperson,
      items,
      flags,
      resolvedFulfillmentPath,
      effectivePickLineCount,
    ],
  );

  useEffect(() => {
    if (variant !== 'report' || !hasFlags) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        copy(message, 'handoff');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [variant, hasFlags, copy, message]);

  if (variant === 'bill_save' && billSheet) {
    const {
      step,
      saveMutation,
      notifyMutation,
      notifyPickerAllowed,
      saveBlocked,
      unresolvedFlagged,
    } = billSheet;

    return (
      <div className="flex flex-col gap-3 p-3">
        {readOnly ? (
          <div className="rounded-lg border border-[var(--border-positive)] bg-[var(--bg-positive-subtle)] px-4 py-3">
            <p className="inline-flex items-center gap-2 font-ds-caption-size font-semibold text-[var(--content-positive)]">
              <Check size={18} weight="bold" />
              Bill complete — view in History for archive
            </p>
          </div>
        ) : (
          <>
            <BillingActionBar
              primaryLabel={
                step !== 'idle'
                  ? 'Bill saved'
                  : saveBlocked
                    ? `Resolve ${unresolvedFlagged.length} flagged line(s) first`
                    : 'Save & Bill'
              }
              primaryDisabled={step !== 'idle' || saveBlocked || saveMutation.isPending}
              primaryLoading={saveMutation.isPending}
              onPrimary={() => saveMutation.mutate()}
            />
            {notifyPickerAllowed ? (
              <BillingActionBar
                primaryLabel={step === 'notified' ? 'Picker notified' : 'Notify picker'}
                primaryDisabled={
                  step === 'idle' || step === 'notified' || notifyMutation.isPending
                }
                primaryLoading={notifyMutation.isPending}
                onPrimary={() => notifyMutation.mutate()}
              />
            ) : null}
          </>
        )}
      </div>
    );
  }

  if (!hasFlags) {
    return <div className="p-4" />;
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="rounded-xl border border-[var(--border-positive)] bg-[var(--bg-positive-subtle)] px-4 py-3">
        <p className="inline-flex items-center gap-2 font-ds-prose font-semibold text-[var(--content-positive)]">
          <Check size={20} weight="bold" />
          {orderName} — billed
        </p>
        <p className="mt-1 font-ds-caption-size text-[var(--content-secondary)]">
          Copy the update below for {salesperson ?? 'sales'} if needed.
        </p>
      </div>

      <textarea
        readOnly
        value={message}
        className="w-full min-h-[100px] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3 font-ds-caption-size text-[var(--content-primary)] resize-none"
      />

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => copy(message, 'handoff')}
          className="inline-flex items-center gap-2 h-9 px-3 rounded-lg font-ds-caption-size font-medium border border-[var(--border-subtle)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)]"
        >
          <Copy size={16} />
          {copiedId === 'handoff' ? 'Copied' : 'Copy message'}
        </button>
        <a
          href={`https://wa.me/?text=${encodeURIComponent(message)}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 h-9 px-3 rounded-lg font-ds-caption-size font-medium bg-[var(--embed-whatsapp)] text-white hover:opacity-95"
        >
          <WhatsappLogo size={16} weight="fill" />
          WhatsApp
        </a>
      </div>

      {onNext ? (
        <BillingActionBar
          primaryLabel={
            totalWaiting > 0 ? `Next order (${totalWaiting} remaining)` : 'Next order'
          }
          onPrimary={onNext}
          left={
            <span className="inline-flex items-center gap-1 font-ds-micro text-[var(--content-quaternary)]">
              <ArrowRight size={14} />
              Return to queue · C to copy
            </span>
          }
        />
      ) : null}
    </div>
  );
}
