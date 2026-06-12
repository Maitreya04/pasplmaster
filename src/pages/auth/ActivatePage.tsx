import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase/client';
import { useAuth } from '../../context/AuthContext';
import {
  activateUserAccount,
  branchDisplayName,
  inviteCodeErrorMessage,
  isValidPhone,
  isValidPin,
  normalizePhoneInput,
  type ValidateInviteCodeResult,
} from '../../lib/auth/phoneAuth';

const ROLE_HOME: Record<string, string> = {
  sales: '/sales',
  billing: '/billing/queue',
  picking: '/picking',
  admin: '/admin',
};

type Step = 'code' | 'details';

export default function ActivatePage(): React.JSX.Element | null {
  const navigate = useNavigate();
  const { loginWithPhone, isAuthenticated, role, authMode, authReady } = useAuth();

  const [step, setStep] = useState<Step>('code');
  const [inviteCode, setInviteCode] = useState('');
  const [preview, setPreview] = useState<ValidateInviteCodeResult | null>(null);
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (authReady && isAuthenticated && authMode === 'supabase' && role && ROLE_HOME[role]) {
    return <Navigate to={ROLE_HOME[role]} replace />;
  }

  const validateCode = async () => {
    setError(null);
    setLoading(true);
    const { data, error: rpcError } = await supabase.rpc('validate_invite_code', {
      p_code: inviteCode.trim().toUpperCase(),
    });
    setLoading(false);

    if (rpcError) {
      setError('Could not validate code. Try again.');
      return;
    }

    const result = data as ValidateInviteCodeResult;
    if (!result.valid) {
      setError(inviteCodeErrorMessage(result.error));
      return;
    }

    setPreview(result);
    setStep('details');
  };

  const activate = async (event: React.FormEvent) => {
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
    if (pin !== confirmPin) {
      setError('PINs do not match');
      return;
    }

    setLoading(true);
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

    const activation = await activateUserAccount({
      supabaseUrl,
      anonKey,
      inviteCode,
      phone: normalizedPhone,
      pin,
    });
    setLoading(false);

    if ('error' in activation) {
      setError(inviteCodeErrorMessage(activation.error));
      return;
    }

    const signIn = await loginWithPhone(normalizedPhone, pin);
    if (!signIn.success) {
      setError('Account created. Sign in with your phone and PIN.');
      navigate('/login', { replace: true });
      return;
    }

    const home = ROLE_HOME[activation.role];
    navigate(home ?? '/select-role', { replace: true });
  };

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] px-6 py-12">
      <div className="max-w-md mx-auto space-y-6">
        <div>
          <Link to="/login" className="text-sm text-[var(--content-accent)] hover:underline">
            ← Back to sign in
          </Link>
          <h1 className="text-2xl font-bold text-[var(--content-primary)] mt-4">Activate account</h1>
          <p className="text-sm text-[var(--content-secondary)] mt-1">
            Enter the invite code from your manager, then set your phone and PIN.
          </p>
        </div>

        {step === 'code' ? (
          <div className="space-y-4">
            <label className="block">
              <span className="text-sm text-[var(--content-secondary)]">Invite code</span>
              <input
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                placeholder="SHAN-4829"
                className="mt-1 w-full rounded-xl border border-[var(--border-opaque)] bg-[var(--bg-secondary)] px-4 py-3 font-mono text-lg uppercase"
              />
            </label>
            {error && <p className="text-sm text-[var(--content-negative)]">{error}</p>}
            <button
              type="button"
              disabled={loading || inviteCode.trim().length < 5}
              onClick={() => void validateCode()}
              className="w-full rounded-xl bg-[var(--content-accent)] text-white font-semibold py-3 disabled:opacity-50"
            >
              {loading ? 'Checking…' : 'Continue'}
            </button>
          </div>
        ) : (
          <form onSubmit={(e) => void activate(e)} className="space-y-4">
            {preview?.valid && (
              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4">
                <p className="font-semibold text-[var(--content-primary)]">
                  Welcome, {preview.full_name}!
                </p>
                <p className="text-sm text-[var(--content-secondary)] mt-1">
                  Role: {preview.role} · Branch: {branchDisplayName(preview.branch)}
                </p>
              </div>
            )}

            <label className="block">
              <span className="text-sm text-[var(--content-secondary)]">Mobile number</span>
              <input
                type="tel"
                inputMode="numeric"
                value={phone}
                onChange={(e) => setPhone(normalizePhoneInput(e.target.value))}
                maxLength={10}
                className="mt-1 w-full rounded-xl border border-[var(--border-opaque)] bg-[var(--bg-secondary)] px-4 py-3 font-mono text-lg"
              />
            </label>

            <label className="block">
              <span className="text-sm text-[var(--content-secondary)]">Choose PIN (4–6 digits)</span>
              <input
                type="password"
                inputMode="numeric"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                maxLength={6}
                className="mt-1 w-full rounded-xl border border-[var(--border-opaque)] bg-[var(--bg-secondary)] px-4 py-3 font-mono text-lg"
              />
            </label>

            <label className="block">
              <span className="text-sm text-[var(--content-secondary)]">Confirm PIN</span>
              <input
                type="password"
                inputMode="numeric"
                value={confirmPin}
                onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                maxLength={6}
                className="mt-1 w-full rounded-xl border border-[var(--border-opaque)] bg-[var(--bg-secondary)] px-4 py-3 font-mono text-lg"
              />
            </label>

            {error && <p className="text-sm text-[var(--content-negative)]">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-[var(--content-accent)] text-white font-semibold py-3 disabled:opacity-50"
            >
              {loading ? 'Activating…' : 'Activate account'}
            </button>

            <button
              type="button"
              onClick={() => {
                setStep('code');
                setPreview(null);
                setError(null);
              }}
              className="w-full text-sm text-[var(--content-tertiary)]"
            >
              Use a different code
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
