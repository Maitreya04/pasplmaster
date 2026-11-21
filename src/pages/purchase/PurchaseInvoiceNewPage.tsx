import { useNavigate } from 'react-router-dom';
import { ArrowLeft, FileXls } from '@phosphor-icons/react';
import { BigButton } from '../../components/shared';

/**
 * Invoice PDF AI extraction was removed with Gemini.
 * Keep this route so old bookmarks do not 404; guide users to Excel PO.
 */
export default function PurchaseInvoiceNewPage(): React.JSX.Element {
  const navigate = useNavigate();

  return (
    <div className="role-admin min-h-screen bg-[var(--bg-primary)] px-4 py-6 lg:px-6">
      <div className="mx-auto max-w-xl space-y-6">
        <button
          type="button"
          onClick={() => navigate('/purchase')}
          className="inline-flex items-center gap-1 text-sm text-[var(--content-secondary)] hover:text-[var(--content-primary)]"
        >
          <ArrowLeft size={18} weight="bold" />
          Purchase orders
        </button>

        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-5">
          <h1 className="text-lg font-bold text-[var(--content-primary)]">Invoice PDF extraction removed</h1>
          <p className="mt-2 text-sm text-[var(--content-secondary)]">
            AI invoice PDF OCR is no longer available. Create purchase orders from Excel, then start a receiving job from
            the PO.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <BigButton
              type="button"
              variant="primary"
              className="min-h-11 bg-[var(--bg-accent)] text-[var(--content-on-color)]"
              onClick={() => navigate('/purchase/new')}
            >
              <FileXls size={20} weight="bold" className="mr-1 inline" />
              New from Excel
            </BigButton>
            <BigButton type="button" variant="secondary" className="min-h-11" onClick={() => navigate('/purchase')}>
              Back to purchase orders
            </BigButton>
          </div>
        </div>
      </div>
    </div>
  );
}
