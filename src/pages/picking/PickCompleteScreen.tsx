import { useNavigate } from 'react-router-dom';
import { CheckCircle, Warning, Flag, ArrowRight } from '@phosphor-icons/react';
import { BigButton } from '../../components/shared';

interface PickCompleteScreenProps {
  orderNumber: string;
  customerName: string;
  pickedLineCount: number;
  flaggedLineCount: number;
  totalLineCount: number;
  pickedPieceCount: number;
  totalPieceCount: number;
}

export function PickCompleteScreen({
  orderNumber,
  customerName,
  pickedLineCount,
  flaggedLineCount,
  totalLineCount,
  pickedPieceCount,
  totalPieceCount,
}: PickCompleteScreenProps): React.JSX.Element | null {
  const navigate = useNavigate();
  const hasFlagged = flaggedLineCount > 0;
  const itemLabel = totalLineCount === 1 ? 'item' : 'items';

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

      <h1 className="text-2xl font-bold text-white mb-1">
        {hasFlagged ? 'Completed with Issues' : 'Pick Complete!'}
      </h1>
      <p className="text-white/75 text-base mb-8">
        {orderNumber} — sent to billing for review
      </p>

      <div className="w-full max-w-xs bg-white/20 backdrop-blur-sm rounded-2xl p-5 mb-8 space-y-3">
        <p className="text-sm font-medium text-white/80 truncate">
          {customerName}
        </p>
        <div className="space-y-1 text-white tabular-nums">
          <p className="text-lg font-bold">
            {pickedLineCount}/{totalLineCount} {itemLabel} on bill picked
          </p>
          <p className="text-lg font-bold">
            {pickedPieceCount}/{totalPieceCount} pcs picked
          </p>
        </div>
        {flaggedLineCount > 0 && (
          <p className="flex items-center justify-center gap-1.5 text-sm text-white/90">
            <Flag size={16} weight="fill" />
            {flaggedLineCount} flagged for billing
          </p>
        )}
      </div>

      <div className="w-full max-w-xs">
        <BigButton
          variant="secondary"
          onClick={() => navigate('/picking', { replace: true })}
          className="bg-[var(--bg-primary)] text-[var(--content-primary)] font-semibold"
        >
          <ArrowRight size={20} weight="bold" />
          Next order
        </BigButton>
      </div>
    </div>
  );
}
