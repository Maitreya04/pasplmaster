import { useState, useCallback } from 'react';
import { Navigate, Link } from 'react-router-dom';
import { PinPad } from '../components/auth/PinPad';
import { useAuth } from '../context/AuthContext';
import {
  clearDeviceProfile,
  isValidPhone,
  isValidPin,
  loadDeviceProfile,
  normalizePhoneInput,
} from '../lib/auth/phoneAuth';

const ROLE_HOME: Record<string, string> = {
  sales: '/sales',
  billing: '/billing/queue',
  picking: '/picking',
  admin: '/admin',
  partner: '/partner/supply',
};

type LoginMode = 'quick' | 'full';

export default function LoginPage(): React.JSX.Element | null {
  const {
    loginWithPhone,
    isAuthenticated,
    role,
    authMode,
    authReady,
    canSwitchRoles,
    authRecoveryMessage,
  } = useAuth();

  const savedDevice = loadDeviceProfile();
  const [mode, setMode] = useState<LoginMode>(savedDevice ? 'quick' : 'full');
  const [phone, setPhone] = useState(savedDevice?.phone ?? '');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const displayError = error ?? authRecoveryMessage;

  const handleQuickUnlock = useCallback(
    async (candidatePin: string): Promise<boolean> => {
      if (!savedDevice) return false;
      setError(null);
      setSubmitting(true);
      const result = await loginWithPhone(savedDevice.phone, candidatePin);
      setSubmitting(false);
      if (!result.success) {
        setError(result.error ?? 'Incorrect PIN');
        return false;
      }
      return true;
    },
    [loginWithPhone, savedDevice],
  );

  if (authReady && isAuthenticated) {
    if (canSwitchRoles && !role) {
      return <Navigate to="/select-role" replace />;
    }
    if (authMode === 'supabase' && role && ROLE_HOME[role]) {
      return <Navigate to={ROLE_HOME[role]} replace />;
    }
    return <Navigate to="/select-role" replace />;
  }

  const handlePhoneLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    const normalizedPhone = normalizePhoneInput(phone);
    if (!isValidPhone(normalizedPhone)) {
      setError('Enter a valid 10-digit mobile number');
      return;
    }
    if (!isValidPin(pin)) {
      setError('PIN must be 4–6 digits');
      return;
    }

    setSubmitting(true);
    const result = await loginWithPhone(normalizedPhone, pin);
    setSubmitting(false);

    if (!result.success) {
      setError(result.error ?? 'Sign in failed');
      return;
    }
  };

  const switchToFullLogin = () => {
    clearDeviceProfile();
    setMode('full');
    setPhone('');
    setPin('');
    setError(null);
  };

  const quickDevice = mode === 'quick' ? savedDevice ?? loadDeviceProfile() : null;
  const loginSubtitle = authRecoveryMessage
    ? 'Enter your PIN again to reconnect'
    : mode === 'quick' && quickDevice
      ? `Welcome back, ${quickDevice.displayName}`
      : 'Sign in with phone + PIN';

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] flex flex-col items-center justify-between px-6 py-12 select-none relative overflow-hidden">
      <div className="absolute top-[-20%] left-[-20%] w-[60vw] h-[60vw] rounded-full bg-indigo-500/10 blur-[100px] pointer-events-none mix-blend-multiply" />
      <div className="absolute bottom-[-20%] right-[-20%] w-[70vw] h-[70vw] rounded-full bg-blue-500/10 blur-[120px] pointer-events-none mix-blend-multiply" />

      <div className="text-center relative z-10 pt-4">
        <h1 className="text-3xl font-bold tracking-tight text-[var(--content-primary)]">PASPL Master</h1>
        <p className="text-sm font-medium text-[var(--content-secondary)] mt-2">
          {loginSubtitle}
        </p>
        {mode === 'quick' && quickDevice && (
          <p className="text-xs text-[var(--content-tertiary)] mt-1">Enter your PIN to continue</p>
        )}
      </div>

      {mode === 'quick' && quickDevice ? (
        <div className="w-full max-w-xs relative z-10 flex flex-col items-center">
          {authRecoveryMessage && !error && (
            <p className="mb-4 text-center text-sm leading-5 text-[var(--content-negative)]">
              {authRecoveryMessage}
            </p>
          )}
          <PinPad
            onSubmit={handleQuickUnlock}
            disabled={submitting || !authReady}
            errorText={error}
          />

          <div className="mt-8 w-full text-center space-y-2">
            <button
              type="button"
              onClick={switchToFullLogin}
              className="text-sm text-[var(--content-secondary)] hover:text-[var(--content-primary)]"
            >
              Use another mobile number
            </button>
            <p className="text-sm text-[var(--content-secondary)]">
              Forgot PIN?{' '}
              <Link
                to="/reset-pin"
                className="font-semibold text-[var(--content-accent)] hover:underline"
              >
                Reset PIN
              </Link>
            </p>
          </div>
        </div>
      ) : (
        <form
          onSubmit={handlePhoneLogin}
          className="w-full max-w-sm relative z-10 space-y-4"
        >
          <label className="block">
            <span className="text-sm text-[var(--content-secondary)]">Mobile number</span>
            <input
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              value={phone}
              onChange={(e) => setPhone(normalizePhoneInput(e.target.value))}
              placeholder="9876543210"
              maxLength={10}
              className="mt-1 w-full rounded-xl border border-[var(--border-opaque)] bg-[var(--bg-secondary)] px-4 py-3 text-lg font-mono text-[var(--content-primary)]"
            />
          </label>

          <label className="block">
            <span className="text-sm text-[var(--content-secondary)]">PIN</span>
            <input
              type="password"
              inputMode="numeric"
              autoComplete="current-password"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="••••"
              maxLength={6}
              className="mt-1 w-full rounded-xl border border-[var(--border-opaque)] bg-[var(--bg-secondary)] px-4 py-3 text-lg font-mono text-[var(--content-primary)]"
            />
          </label>

          {displayError && <p className="text-sm text-[var(--content-negative)]">{displayError}</p>}

          <button
            type="submit"
            disabled={submitting || !authReady}
            className="w-full rounded-xl bg-[var(--content-accent)] text-white font-semibold py-3 disabled:opacity-50"
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>

          <div className="text-center space-y-2 pt-2">
            <p className="text-sm text-[var(--content-secondary)]">
              Forgot PIN?{' '}
              <Link
                to="/reset-pin"
                className="font-semibold text-[var(--content-accent)] hover:underline"
              >
                Reset PIN
              </Link>
            </p>
            <p className="text-sm text-[var(--content-secondary)]">
              New user?{' '}
              <Link
                to="/get-started"
                className="font-semibold text-[var(--content-accent)] hover:underline"
              >
                Get started →
              </Link>
            </p>
            {savedDevice && (
              <button
                type="button"
                onClick={() => {
                  setMode('quick');
                  setError(null);
                }}
                className="text-sm text-[var(--content-secondary)] hover:text-[var(--content-primary)]"
              >
                Back to quick unlock
              </button>
            )}
          </div>
        </form>
      )}

      <div className="h-8" />
    </div>
  );
}
