import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Package,
  ArrowRight,
  SpinnerGap,
  Bell,
  GearSix,
  Barcode,
  ArrowsClockwise,
} from '@phosphor-icons/react';
import { usePickerPushNotifications } from '../../hooks/usePickerPushNotifications';
import { useAutoPickAssignment } from '../../hooks/useAutoPickAssignment';
import { NotificationBell } from '../../components/notifications/NotificationBell';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import {
  PageHeader,
  Card,
  BigButton,
  EmptyState,
} from '../../components/shared';

export default function QueuePage(): React.JSX.Element | null {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const toast = useToast();
  const { role, userId, userName } = useAuth();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const claimOrderIdParam = searchParams.get('claimOrderId');
  const dispatchAttemptedRef = useRef(false);
  const { status, errorMessage, assignNext, reset } = useAutoPickAssignment();
  const pushAlerts = usePickerPushNotifications({ role, userId, userName });

  const clearNotificationIntent = useCallback(() => {
    navigate('/picking', { replace: true });
  }, [navigate]);

  // On mount (and after push deep-link), auto-assign — never cherry-pick a specific order.
  useEffect(() => {
    if (!userId) return;
    if (dispatchAttemptedRef.current) return;
    dispatchAttemptedRef.current = true;

    if (claimOrderIdParam) {
      clearNotificationIntent();
    }

    void assignNext();
  }, [assignNext, claimOrderIdParam, clearNotificationIntent, userId]);

  const handleEnableAlerts = async () => {
    const result = await pushAlerts.enable();
    if (result.ok) {
      toast.success('Picker alerts enabled on this device');
    } else {
      toast.error(result.error || 'Failed to enable picker alerts.');
    }
  };

  const handleDisableAlerts = async () => {
    const result = await pushAlerts.disable();
    if (result.ok) {
      setSettingsOpen(false);
      toast.info('Picker alerts turned off on this device');
    } else {
      toast.error(result.error || 'Failed to disable picker alerts.');
    }
  };

  const isAssigning = status === 'assigning' || status === 'idle';
  const isWaiting = status === 'waiting';
  const isError = status === 'error';

  return (
    <div className="min-h-screen">
      <PageHeader
        title="Pick Queue"
        action={
          <div className="flex items-center gap-1">
            <NotificationBell userId={userId} role={role} />
            <div className="relative">
              <button
                type="button"
                onClick={() => setSettingsOpen((open) => !open)}
                className="min-h-10 min-w-10 flex items-center justify-center rounded-full text-[var(--content-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors duration-150"
                aria-label="Open queue settings"
                aria-expanded={settingsOpen}
              >
                <GearSix size={20} weight="bold" />
              </button>
              {settingsOpen && (
                <div className="absolute right-0 top-full mt-2 w-44 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] shadow-lg p-2">
                  {pushAlerts.enabled ? (
                    <button
                      type="button"
                      onClick={handleDisableAlerts}
                      disabled={pushAlerts.loading}
                      className="w-full min-h-11 px-3 rounded-xl text-left text-sm font-medium text-[var(--content-primary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-50"
                    >
                      {pushAlerts.loading ? 'Updating…' : 'Disable alerts'}
                    </button>
                  ) : (
                    <p className="px-3 py-2 text-xs text-[var(--content-tertiary)]">
                      No queue settings yet
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        }
      />

      <div className="p-4 space-y-6">
        {isAssigning && (
          <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 text-center px-4">
            <SpinnerGap
              size={40}
              weight="bold"
              className="animate-spin text-[var(--role-primary)]"
            />
            <div>
              <p className="text-lg font-semibold text-[var(--content-primary)]">
                Assigning your next order…
              </p>
              <p className="mt-1 text-sm text-[var(--content-tertiary)]">
                The system picks the next order for you — no choosing from a list.
              </p>
            </div>
          </div>
        )}

        {isWaiting && (
          <div className="space-y-6">
            <header className="space-y-1">
              <h2 className="text-2xl font-bold text-[var(--content-primary)]">
                Hey, {userName ?? 'there'}
              </h2>
              <p className="text-sm text-[var(--content-tertiary)]">
                Waiting for billing to approve the next order.
              </p>
            </header>

            <EmptyState
              icon={Package}
              title="No orders right now"
              description="When billing approves an order, it will appear on your screen automatically."
            />

            <BigButton
              variant="secondary"
              onClick={() => {
                reset();
                dispatchAttemptedRef.current = false;
                void assignNext();
              }}
              className="w-full"
            >
              <ArrowsClockwise size={20} weight="bold" />
              Check again
            </BigButton>
          </div>
        )}

        {isError && (
          <div className="space-y-4">
            <Card className="border-[var(--border-negative)] bg-[var(--bg-negative-subtle)]">
              <p className="font-semibold text-[var(--content-negative)]">
                Could not assign an order
              </p>
              <p className="mt-1 text-sm text-[var(--content-secondary)]">
                {errorMessage ?? 'Something went wrong. Try again.'}
              </p>
            </Card>
            <BigButton
              variant="primary"
              onClick={() => {
                reset();
                dispatchAttemptedRef.current = false;
                void assignNext();
              }}
              className="w-full bg-[var(--bg-accent)] text-[var(--content-on-color)]"
            >
              <ArrowsClockwise size={20} weight="bold" />
              Retry
            </BigButton>
          </div>
        )}

        {(isWaiting || isError) && (
          <>
            <button
              type="button"
              onClick={() => navigate('/picking/barcode-mapping')}
              className="flex w-full items-center gap-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4 text-left transition-colors hover:bg-[var(--bg-tertiary)] active:scale-[0.99]"
            >
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--bg-accent-subtle)]">
                <Barcode size={22} weight="duotone" className="text-[var(--content-accent)]" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-[var(--content-primary)]">Map manufacturer barcodes</p>
                <p className="mt-0.5 text-sm text-[var(--content-secondary)]">
                  Link bin QR and part barcodes to Busy SKUs while you wait.
                </p>
              </div>
              <ArrowRight size={20} weight="bold" className="shrink-0 text-[var(--content-tertiary)]" />
            </button>

            {!pushAlerts.enabled && (
              <Card className="border-[var(--border-warning)] bg-[var(--bg-warning-subtle)]">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Bell size={18} weight="fill" className="text-[var(--content-warning)]" />
                      <p className="font-semibold text-[var(--content-primary)]">
                        Picker alerts
                      </p>
                    </div>
                    <p className="text-sm text-[var(--content-secondary)]">
                      {pushAlerts.supported
                        ? !pushAlerts.standalone
                          ? 'Open the installed Home Screen app to enable picker alerts on iPhone or iPad.'
                          : pushAlerts.permission === 'denied'
                            ? 'Browser notifications are blocked on this device. Re-enable them in browser settings to receive picker alerts.'
                            : 'Turn on alerts on this device to receive new ready-to-pick orders.'
                        : 'This browser does not support push notifications. New orders still assign automatically when you open picking.'}
                    </p>
                    {pushAlerts.error && (
                      <p className="mt-2 text-xs text-[var(--content-negative)]">
                        {pushAlerts.error}
                      </p>
                    )}
                  </div>
                  {pushAlerts.supported && (
                    <button
                      type="button"
                      onClick={handleEnableAlerts}
                      disabled={pushAlerts.loading || !userName}
                      className="min-h-11 px-4 rounded-xl text-sm font-semibold bg-[var(--bg-warning)] text-[var(--content-primary)] disabled:opacity-50"
                    >
                      <span className="inline-flex items-center gap-2">
                        <Bell size={16} weight="fill" />
                        {pushAlerts.loading ? 'Enabling…' : 'Enable Alerts'}
                      </span>
                    </button>
                  )}
                </div>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}
