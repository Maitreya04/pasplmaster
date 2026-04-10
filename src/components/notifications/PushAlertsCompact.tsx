import { useEffect, useRef, useState } from 'react';
import { Bell, GearSix } from '@phosphor-icons/react';
import type { PushCapabilityState } from '../../types';

interface PushAlertsCompactProps {
  label: string;
  push: Pick<
    PushCapabilityState,
    'supported' | 'standalone' | 'permission' | 'enabled' | 'loading' | 'error'
  > & {
    enable: () => Promise<{ ok: boolean; error: string | null }>;
    disable: () => Promise<{ ok: boolean; error: string | null }>;
  };
}

export function PushAlertsCompact({ label, push }: PushAlertsCompactProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="min-h-10 min-w-10 flex items-center justify-center rounded-full text-[var(--content-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
        aria-label={`${label} push settings`}
        aria-expanded={open}
      >
        <GearSix size={20} weight="bold" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-56 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] shadow-lg p-3 z-50">
          <p className="text-xs font-semibold text-[var(--content-primary)] mb-2 flex items-center gap-2">
            <Bell size={14} weight="fill" />
            {label}
          </p>
          {push.enabled ? (
            <button
              type="button"
              onClick={() => void push.disable()}
              disabled={push.loading}
              className="w-full min-h-10 rounded-xl text-sm font-medium bg-[var(--bg-tertiary)] text-[var(--content-primary)] hover:opacity-90 disabled:opacity-50"
            >
              {push.loading ? 'Updating…' : 'Disable push'}
            </button>
          ) : (
            <>
              <p className="font-ds-label-size text-[var(--content-tertiary)] mb-2 leading-snug">
                {!push.supported
                  ? 'This browser does not support push.'
                  : !push.standalone
                    ? 'On iPhone/iPad, use the Home Screen app.'
                    : push.permission === 'denied'
                      ? 'Notifications are blocked in browser settings.'
                      : 'Get alerts when this device is in the background.'}
              </p>
              {push.error && (
                <p className="font-ds-micro text-[var(--content-negative)] mb-2">{push.error}</p>
              )}
              {push.supported && push.standalone && (
                <button
                  type="button"
                  onClick={() => void push.enable()}
                  disabled={push.loading}
                  className="w-full min-h-10 rounded-xl text-sm font-semibold bg-[var(--bg-accent)] text-white disabled:opacity-50"
                >
                  {push.loading ? 'Enabling…' : 'Enable push'}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
