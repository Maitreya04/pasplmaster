import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, FileXls } from '@phosphor-icons/react';
import { BigButton } from '../../components/shared';

/**
 * Invoice PDF AI extraction was removed with Gemini.
 * Keep this route so old PO “invoice” links do not 404.
 */
export default function PurchaseInvoiceReviewPage(): React.JSX.Element {
  const { poId: poIdParam } = useParams<{ poId: string }>();
  const poId = Number(poIdParam);
  const navigate = useNavigate();
  const poPath = Number.isFinite(poId) && poId > 0 ? `/purchase/po/${poId}` : '/purchase';

  return (
    <div className="role-admin min-h-screen bg-[var(--bg-primary)] px-4 py-6 lg:px-6">
      <div className="mx-auto max-w-xl space-y-6">
        <button
          type="button"
          onClick={() => navigate(poPath)}
          className="inline-flex items-center gap-1 text-sm text-[var(--content-secondary)] hover:text-[var(--content-primary)]"
        >
          <ArrowLeft size={18} weight="bold" />
          Back
        </button>

        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-5">
          <h1 className="text-lg font-bold text-[var(--content-primary)]">Invoice PDF OCR removed</h1>
          <p className="mt-2 text-sm text-[var(--content-secondary)]">
            AI extraction of supplier invoice PDFs is no longer available. Use Excel to create or update POs, then start
            receiving from the purchase order.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            {Number.isFinite(poId) && poId > 0 ? (
              <BigButton type="button" variant="secondary" className="min-h-11" onClick={() => navigate(poPath)}>
                Open this PO
              </BigButton>
            ) : null}
            <BigButton
              type="button"
              variant="primary"
              className="min-h-11 bg-[var(--bg-accent)] text-[var(--content-on-color)]"
              onClick={() => navigate('/purchase/new')}
            >
              <FileXls size={20} weight="bold" className="mr-1 inline" />
              New from Excel
            </BigButton>
          </div>
        </div>
      </div>
    </div>
  );
}
