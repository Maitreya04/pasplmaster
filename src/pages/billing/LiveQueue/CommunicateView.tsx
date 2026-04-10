import type { ReactElement } from 'react';
import { WhatsappLogo, CaretRight, Copy, Check } from '@phosphor-icons/react';
import type { OrderItem } from '../../../types';
import type { FlagIssue, ResolveDecision, ManualFlag } from '../../../hooks/useBillingFlowMachine';
import { useCopyToClipboard } from '../../../hooks/useCopyToClipboard';
import { buildSalesCommunicateDraft } from '../../../lib/buildSalesCommunicateDraft';

interface CommunicateViewProps {
  orderNumber: string;
  orderName: string;
  salesperson: string | null;
  items: OrderItem[];
  issues: FlagIssue[];
  decisions: Record<number, ResolveDecision>;
  manualFlags: Record<number, ManualFlag>;
  onSend: (draftText: string) => void;
  onSkip: () => void;
  isSubmitting: boolean;
}

export function CommunicateView({
  orderNumber,
  orderName,
  salesperson,
  items,
  issues,
  decisions,
  manualFlags,
  onSend,
  onSkip,
  isSubmitting
}: CommunicateViewProps): ReactElement {
  const { copy, copiedId } = useCopyToClipboard();

  const draftText = buildSalesCommunicateDraft({
    orderNumber,
    orderName,
    salesperson,
    items,
    issues,
    decisions,
    manualFlags,
  });

  return (
    <div className="density-compact flex flex-col items-center justify-center min-h-screen bg-[var(--bg-primary)] p-6 animate-slide-up">
      <div className="w-full max-w-xl">
        
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="w-12 h-12 bg-embed-whatsapp-tint rounded-full flex items-center justify-center">
            <WhatsappLogo size={24} weight="fill" className="text-embed-whatsapp" />
          </div>
          <h2 className="text-2xl font-bold text-[var(--content-primary)]">Notify {salesperson || 'Salesperson'}</h2>
        </div>

        <div className="bg-[var(--bg-secondary)] rounded-3xl p-6 lg:p-8 shadow-[var(--shadow-card-hover)] border border-[var(--border-subtle)] relative">
          <div className="absolute top-4 right-4">
             <button
               onClick={() => copy(draftText, 'draft')}
               className="p-2 rounded-lg bg-[var(--bg-tertiary)] hover:bg-[var(--bg-accent-subtle)] hover:text-[var(--content-accent)] transition-colors text-[var(--content-secondary)]"
               title="Copy to clipboard"
             >
               {copiedId === 'draft' ? <Check size={20} weight="bold" className="text-[var(--content-positive)]" /> : <Copy size={20} weight="fill" />}
             </button>
          </div>
          
          <div className="rounded-2xl p-6 font-sans border border-[var(--border-opaque)] relative overflow-hidden bg-[var(--embed-whatsapp-bg)]">
             <div className="absolute top-0 left-0 w-2 h-full bg-embed-whatsapp-solid" aria-hidden />
             <p className="font-ds-lead leading-relaxed whitespace-pre-wrap text-[var(--embed-whatsapp-fg)]">
               {draftText}
             </p>
          </div>
          
          <div className="mt-8 flex gap-4">
             <button
               onClick={onSkip}
               disabled={isSubmitting}
               className="flex-1 h-14 rounded-xl border border-[var(--border-opaque)] bg-transparent text-sm font-bold text-[var(--content-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--content-primary)] transition-colors disabled:opacity-50"
             >
               Skip notification
             </button>
             
             <button
               onClick={() => {
                 copy(draftText, 'draft');
                 onSend(draftText);
               }}
               disabled={isSubmitting}
               className="flex-[2] h-14 rounded-xl bg-[var(--bg-accent)] text-white text-base font-bold flex items-center justify-center gap-2 hover:opacity-90 active:scale-95 transition-all disabled:opacity-50 shadow-md"
             >
               {isSubmitting ? 'Approving order...' : 'Copy & Approve Order'}
               {!isSubmitting && <CaretRight size={18} weight="bold" />}
             </button>
          </div>
          <p className="text-center text-xs text-[var(--content-quaternary)] mt-4">
            Clicking "Copy & Approve" will transition the order to picking and put this message in your clipboard.
          </p>
        </div>
      </div>
    </div>
  );
}
