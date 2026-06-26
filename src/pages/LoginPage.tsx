import { useState, useCallback, useRef, useEffect } from 'react';
import { useNavigate, Navigate, Link } from 'react-router-dom';
import { Backspace } from '@phosphor-icons/react';
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

const LEGACY_LOGIN_ENABLED = true;

type LoginMode = 'quick' | 'full' | 'legacy';

export default function LoginPage(): React.JSX.Element | null {
  const navigate = useNavigate();
  const { loginWithPhone, login, isAuthenticated, role, authMode, authReady } = useAuth();

  const savedDevice = loadDeviceProfile();
  const [mode, setMode] = useState<LoginMode>(savedDevice ? 'quick' : 'full');
  const [phone, setPhone] = useState(savedDevice?.phone ?? '');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [legacyCode, setLegacyCode] = useState('');
  const [legacyError, setLegacyError] = useState(false);
  const [legacyChecking, setLegacyChecking] = useState(false);
  const legacyErrorTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (legacyErrorTimeout.current) clearTimeout(legacyErrorTimeout.current);
    };
  }, []);

  if (authReady && isAuthenticated) {
    if (authMode === 'supabase' && role && ROLE_HOME[role]) {
      return <Navigate to={ROLE_HOME[role]} replace />;
    }
    return <Navigate to="/select-role" replace />;
  }

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

  const handleLegacyDigit = useCallback(
    async (digit: string) => {
      if (legacyChecking || legacyError) return;

      const next = legacyCode + digit;
      if (next.length > 4) return;
      setLegacyCode(next);

      if (next.length === 4) {
        setLegacyChecking(true);
        const success = await login(next);
        if (success) {
          navigate('/select-role', { replace: true });
        } else {
          setLegacyError(true);
          legacyErrorTimeout.current = setTimeout(() => {
            setLegacyError(false);
            setLegacyCode('');
            setLegacyChecking(false);
          }, 1000);
        }
      }
    },
    [legacyChecking, legacyError, legacyCode, login, navigate],
  );

  const switchToFullLogin = () => {
    clearDeviceProfile();
    setMode('full');
    setPhone('');
    setPin('');
    setError(null);
  };

  const legacyDigits = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
  const quickDevice = mode === 'quick' ? savedDevice ?? loadDeviceProfile() : null;

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] flex flex-col items-center justify-between px-6 py-12 select-none relative overflow-hidden">
      <div className="absolute top-[-20%] left-[-20%] w-[60vw] h-[60vw] rounded-full bg-indigo-500/10 blur-[100px] pointer-events-none mix-blend-multiply" />
      <div className="absolute bottom-[-20%] right-[-20%] w-[70vw] h-[70vw] rounded-full bg-blue-500/10 blur-[120px] pointer-events-none mix-blend-multiply" />

      <div className="text-center relative z-10 pt-4">
        <h1 className="text-3xl font-bold tracking-tight text-[var(--content-primary)]">PASPL Master</h1>
        <p className="text-sm font-medium text-[var(--content-secondary)] mt-2">
          {mode === 'quick' && quickDevice
            ? `Welcome back, ${quickDevice.displayName}`
            : mode === 'full'
              ? 'Sign in with phone + PIN'
              : 'Legacy access code'}
        </p>
        {mode === 'quick' && quickDevice && (
          <p className="text-xs text-[var(--content-tertiary)] mt-1">Enter your PIN to continue</p>
        )}
      </div>

      {mode === 'quick' && quickDevice ? (
        <div className="w-full max-w-xs relative z-10 flex flex-col items-center">
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
              Not you? Sign in differently
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
            {LEGACY_LOGIN_ENABLED && (
              <button
                type="button"
                onClick={() => {
                  setMode('legacy');
                  setError(null);
                }}
                className="text-xs text-[var(--content-tertiary)] hover:text-[var(--content-secondary)]"
              >
                Use legacy access code
              </button>
            )}
          </div>
        </div>
      ) : mode === 'full' ? (
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

          {error && <p className="text-sm text-[var(--content-negative)]">{error}</p>}

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
            {LEGACY_LOGIN_ENABLED && (
              <button
                type="button"
                onClick={() => {
                  setMode('legacy');
                  setError(null);
                }}
                className="text-xs text-[var(--content-tertiary)] hover:text-[var(--content-secondary)]"
              >
                Use legacy access code
              </button>
            )}
          </div>
        </form>
      ) : (
        <div className="w-full max-w-xs relative z-10">
          <div className="flex flex-col items-center gap-6 mb-8">
            <div className={`flex gap-4 ${legacyError ? 'animate-shake' : ''}`}>
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className={`w-4 h-4 rounded-full transition-all duration-150 ${
                    i < legacyCode.length
                      ? legacyError
                        ? 'bg-[var(--content-negative)] scale-110'
                        : 'bg-[var(--content-primary)] scale-110'
                      : 'border-2 border-[var(--border-opaque)]'
                  }`}
                />
              ))}
            </div>
            <div className="h-5">
              {legacyError && <p className="text-sm text-[var(--content-negative)]">Incorrect code</p>}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            {legacyDigits.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => void handleLegacyDigit(d)}
                className="w-16 h-16 mx-auto rounded-full flex items-center justify-center font-mono text-xl text-[var(--content-primary)] bg-[var(--bg-secondary)] border border-[var(--border-opaque)]"
              >
                {d}
              </button>
            ))}
            <div />
            <button
              type="button"
              onClick={() => void handleLegacyDigit('0')}
              className="w-16 h-16 mx-auto rounded-full flex items-center justify-center font-mono text-xl text-[var(--content-primary)] bg-[var(--bg-secondary)] border border-[var(--border-opaque)]"
            >
              0
            </button>
            <button
              type="button"
              onClick={() => {
                if (legacyChecking || legacyError) return;
                setLegacyCode((prev) => prev.slice(0, -1));
              }}
              className="w-16 h-16 mx-auto rounded-full flex items-center justify-center text-[var(--content-secondary)] bg-[var(--bg-secondary)] border border-[var(--border-opaque)]"
              aria-label="Backspace"
            >
              <Backspace size={24} weight="regular" />
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              setMode(savedDevice ? 'quick' : 'full');
              setLegacyCode('');
              setLegacyError(false);
            }}
            className="mt-8 w-full text-sm text-[var(--content-tertiary)] hover:text-[var(--content-secondary)]"
          >
            Back to phone login
          </button>
        </div>
      )}

      <div className="h-8" />
    </div>
  );
}
