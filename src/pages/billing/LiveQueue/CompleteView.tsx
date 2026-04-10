import { useEffect, type ReactElement } from 'react';
import { CheckCircle } from '@phosphor-icons/react';

interface CompleteViewProps {
  orderName: string;
  totalWaiting: number;
  onAutoAdvance: () => void;
}

export function CompleteView({ orderName, totalWaiting, onAutoAdvance }: CompleteViewProps): ReactElement {
  useEffect(() => {
    // Norman: closure signal provides feedback proportional to significance.
    // 1.5s gives enough time to read and feel completion before resetting.
    const t = setTimeout(() => {
      onAutoAdvance();
    }, 1500);
    return () => clearTimeout(t);
  }, [onAutoAdvance]);

  return (
    <div className="density-compact min-h-screen bg-[var(--bg-positive)] flex flex-col items-center justify-center p-6 animate-slide-up">
      <div className="w-24 h-24 bg-white/20 rounded-full flex items-center justify-center mb-8 shadow-inner relative">
        <CheckCircle size={56} weight="bold" className="text-white relative z-10" />
      </div>
      
      <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4 text-center">
        {orderName} sent to picking
      </h2>
      
      <p className="text-lg text-white/80 font-medium">
        {totalWaiting} order{totalWaiting !== 1 ? 's' : ''} remaining
      </p>
    </div>
  );
}
