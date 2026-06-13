import { Clock, Play } from '@phosphor-icons/react';
import { captureCurrentPosition } from '../../lib/geo/geolocation';
import { useWorkday } from '../../hooks/useWorkday';

export function WorkdayBanner(): React.JSX.Element | null {
  const { workday, startWorkday, endWorkday, isStarting, isEnding } = useWorkday();

  if (workday.active) {
    return (
      <div className="mx-4 mb-3 flex items-center justify-between gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--content-tertiary)]">
            Workday active
          </p>
          <p className="text-sm text-[var(--content-primary)]">
            {workday.visits_count ?? 0} visits today
          </p>
        </div>
        <button
          type="button"
          disabled={isEnding}
          onClick={() => void endWorkday()}
          className="shrink-0 rounded-lg border border-[var(--border-subtle)] px-3 py-2 text-xs font-semibold text-[var(--content-secondary)]"
        >
          End day
        </button>
      </div>
    );
  }

  return (
    <div className="mx-4 mb-3 flex items-center justify-between gap-3 rounded-xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2.5">
      <div className="flex items-center gap-2 min-w-0">
        <Clock size={18} className="text-[var(--content-tertiary)] shrink-0" />
        <p className="text-sm text-[var(--content-secondary)]">Workday not started</p>
      </div>
      <button
        type="button"
        disabled={isStarting}
        onClick={async () => {
          try {
            const pos = await captureCurrentPosition();
            await startWorkday({ lat: pos.latitude, lng: pos.longitude });
          } catch {
            await startWorkday(undefined);
          }
        }}
        className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-[var(--role-primary)] px-3 py-2 text-xs font-semibold text-white"
      >
        <Play size={14} weight="fill" />
        Start
      </button>
    </div>
  );
}
