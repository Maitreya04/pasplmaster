import { useNavigate } from 'react-router-dom';
import { CheckCircle, Warning, Flag, ArrowRight } from '@phosphor-icons/react';
import { BigButton } from '../../components/shared';
import { formatLineCountLabel } from '../../lib/picking/pickQueueDisplay';

interface PickCompleteScreenProps {
  orderNumber: string;
  customerName: string;
  customerCity?: string | null;
  transportName?: string | null;
  pickedLineCount: number;
  flaggedLineCount: number;
  totalLineCount: number;
  pickedPieceCount: number;
  totalPieceCount: number;
  boxCount?: number | null;
  billingNotified?: boolean;
}

export function PickCompleteScreen({
  orderNumber,
  customerName,
  customerCity,
  transportName,
  pickedLineCount,
  flaggedLineCount,
  pickedPieceCount,
  totalPieceCount,
  boxCount,
  billingNotified = false,
}: PickCompleteScreenProps): React.JSX.Element | null {
  const navigate = useNavigate();
  const hasFlagged = flaggedLineCount > 0;

  return (
    <div
      className={`
        min-h-screen flex flex-col items-center justify-center px-6 text-center
        ${hasFlagged ? 'bg-[var(--bg-warning)]' : 'bg-[var(--bg-positive)]'}
      `}
    >
      <div className="mb-6">
        {hasFlagged ? (
          <Warning size={80} weight="fill" className="text-white/90" />
        ) : (
          <CheckCircle size={80} weight="fill" className="text-white/90" />
        )}
      </div>

      <h1 className="text-2xl font-bold text-white mb-1 leading-tight max-w-sm">
        {customerName}
      </h1>
      {customerCity && (
        <p className="text-white/80 text-base mb-2">{customerCity}</p>
      )}
      {transportName && (
        <p className="text-white/85 text-sm font-semibold mb-4">{transportName}</p>
      )}

      <p className="text-white/75 text-sm mb-8">
        {hasFlagged ? 'Sent to billing with flags' : 'Pick complete'}
        {' · '}
        <span className="font-mono">{orderNumber}</span>
        {billingNotified && (
          <>
            {' · '}
            Billing notified
          </>
        )}
      </p>

      <div className="w-full max-w-xs bg-white/20 backdrop-blur-sm rounded-2xl p-5 mb-8 space-y-2 text-white/90 text-sm">
        {boxCount != null && boxCount >= 1 && (
          <p className="tabular-nums font-semibold">
            {boxCount} box{boxCount === 1 ? '' : 'es'} packed
          </p>
        )}
        <p className="tabular-nums">
          {formatLineCountLabel(pickedLineCount, { short: true })} picked
        </p>
        <p className="tabular-nums text-white/75">
          {pickedPieceCount}/{totalPieceCount} pcs
        </p>
        {flaggedLineCount > 0 && (
          <p className="flex items-center justify-center gap-1.5">
            <Flag size={16} weight="fill" />
            {flaggedLineCount} flagged for billing
          </p>
        )}
      </div>

      <div className="w-full max-w-xs space-y-3">
        <BigButton
          variant="secondary"
          onClick={() => navigate('/picking', { replace: true })}
          className="bg-[var(--bg-primary)] text-[var(--content-primary)] font-semibold"
        >
          <ArrowRight size={20} weight="bold" />
          Next order
        </BigButton>
        <button
          type="button"
          onClick={() => navigate('/picking?view=done&day=today', { replace: true })}
          className="w-full text-sm font-semibold text-white/90 underline-offset-2 hover:underline"
        >
          View in completed
        </button>
      </div>
    </div>
  );
}
