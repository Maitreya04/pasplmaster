import { useNavigate } from 'react-router-dom';
import { CheckCircle, Warning, Package, Flag } from '@phosphor-icons/react';
import { BigButton } from '../../components/shared';

interface PickCompleteScreenProps {
  orderNumber: string;
  customerName: string;
  pickedCount: number;
  flaggedCount: number;
  totalCount: number;
}

export function PickCompleteScreen({
  orderNumber,
  customerName,
  pickedCount,
  flaggedCount,
  totalCount,
}: PickCompleteScreenProps) {
  const navigate = useNavigate();
  const hasFlagged = flaggedCount > 0;

  return (
    <div
      className={`
        min-h-screen flex flex-col items-center justify-center px-6 text-center
        ${hasFlagged ? 'bg-[var(--bg-warning)]' : 'bg-[var(--bg-positive)]'}
      `}
    >
      {/* Icon */}
      <div className="mb-6">
        {hasFlagged ? (
          <Warning size={80} weight="fill" className="text-white/90" />
        ) : (
          <CheckCircle size={80} weight="fill" className="text-white/90" />
        )}
      </div>

      {/* Title */}
      <h1 className="text-2xl font-bold text-white mb-1">
        {hasFlagged ? 'Completed with Issues' : 'Pick Complete!'}
      </h1>
      <p className="text-white/75 text-base mb-8">
        {orderNumber} — sent to billing for review
      </p>

      {/* Summary card */}
      <div className="w-full max-w-xs bg-white/20 backdrop-blur-sm rounded-2xl p-5 mb-8 space-y-3">
        <p className="text-sm font-medium text-white/80 truncate">
          {customerName}
        </p>
        <div className="flex items-center justify-center gap-6">
          <div className="flex items-center gap-2 text-white">
            <Package size={18} weight="bold" />
            <span className="text-lg font-bold tabular-nums">{totalCount}</span>
            <span className="text-sm text-white/70">items</span>
          </div>
        </div>
        <div className="flex items-center justify-center gap-4 text-sm">
          <span className="flex items-center gap-1.5 text-white/90">
            <CheckCircle size={16} weight="fill" />
            {pickedCount} picked
          </span>
          {flaggedCount > 0 && (
            <span className="flex items-center gap-1.5 text-white/90">
              <Flag size={16} weight="fill" />
              {flaggedCount} flagged
            </span>
          )}
        </div>
      </div>

      {/* Done button */}
      <div className="w-full max-w-xs">
        <BigButton
          variant="secondary"
          onClick={() => navigate('/picking')}
          className="bg-white text-[var(--content-primary)] font-semibold"
        >
          Done
        </BigButton>
      </div>
    </div>
  );
}
