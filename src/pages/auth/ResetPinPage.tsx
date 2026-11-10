import { useMemo, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase/client';
import { useAuth } from '../../context/AuthContext';
import {
  isValidPhone,
  isValidPin,
  normalizePhoneInput,
  resetPinErrorMessage,
  resetUserPin,
} from '../../lib/auth/phoneAuth';

const ROLE_HOME: Record<string, string> = {
  sales: '/sales',
  billing: '/billing/queue',
  picking: '/picking',
  admin: '/admin',
};

type Step = 'name' | 'phone' | 'pin';

interface ResetUser {
  id: number;
  full_name: string;
  role: string;
}

async function fetchResetUsers(): Promise<ResetUser[]> {
  const { data, error } = await supabase.rpc('list_users_for_pin_reset');
  if (error) throw error;
  return (data ?? []) as ResetUser[];
}

export default function ResetPinPage(): React.JSX.Element | null {
  const navigate = useNavigate();
  const { loginWithPhone, isAuthenticated, role, authMode, authReady } = useAuth();

  const [step, setStep] = useState<Step>('name');
  const [search, setSearch] = useState('');
  const [selectedUser, setSelectedUser] = useState<ResetUser | null>(null);
  const [phone, setPhone] = useState('');
  const [phoneLast4, setPhoneLast4] = useState<string | null>(null);
  const [codeRequested, setCodeRequested] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const { data: resetUsers = [], isLoading: usersLoading } = useQuery({
    queryKey: ['pin-reset-users'],
    queryFn: fetchResetUsers,
    staleTime: 30_000,
  });

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return resetUsers;
    return resetUsers.filter((user) => user.full_name.toLowerCase().includes(query));
  }, [resetUsers, search]);

  if (authReady && isAuthenticated && authMode === 'supabase' && role && ROLE_HOME[role]) {
    return <Navigate to={ROLE_HOME[role]} replace />;
  }

  const handleSelectUser = (user: ResetUser) => {
    setSelectedUser(user);
    setSearch(user.full_name);
    setError(null);
  };

  const continueFromName = () => {
    if (!selectedUser) {
      setError('Select your name from the list');
      return;
    }
    setError(null);
    setStep('phone');
  };

  const requestResetCode = async () => {
    if (!selectedUser) return;
    const normalizedPhone = normalizePhoneInput(phone);
    if (!isValidPhone(normalizedPhone)) {
      setError('Enter a valid 10-digit mobile number');
      return;
    }
    setLoading(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('generate_self_service_reset_code', {
      p_user_id: selectedUser.id,
      p_phone: normalizedPhone,
    });
    setLoading(false);
    if (rpcError) {
      setError('Could not start PIN reset. Try again.');
      return;
    }
    if (!data?.success) {
      setError(resetPinErrorMessage(data?.error));
      return;
    }
    setPhoneLast4((data.phone_last4 as string | undefined) ?? null);
    setCodeRequested(true);
    setInviteCode('');
  };

  const continueFromPhone = () => {
    if (!isValidPhone(phone)) {
      setError('Enter a valid 10-digit mobile number');
      return;
    }
    if (!codeRequested || !inviteCode.trim()) {
      setError('Request a reset code, then enter the code from your manager.');
      return;
    }
    setError(null);
    setStep('pin');
  };

  const submitReset = async (event: React.FormEvent) => {
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
    if (!inviteCode || !selectedUser) {
      setError('Reset incomplete. Start again from the beginning.');
      return;
    }

    setLoading(true);
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

    const reset = await resetUserPin({
      supabaseUrl,
      anonKey,
      inviteCode,
      phone: normalizedPhone,
      pin,
    });
    setLoading(false);

    if ('error' in reset) {
      setError(resetPinErrorMessage(reset.error));
      return;
    }

    const signIn = await loginWithPhone(normalizedPhone, pin);
    if (!signIn.success) {
      setError('PIN updated. Sign in with your phone and new PIN.');
      navigate('/login', { replace: true });
      return;
    }

    const home = ROLE_HOME[reset.role];
    navigate(home ?? '/select-role', { replace: true });
  };

  const stepNumber = step === 'name' ? 1 : step === 'phone' ? 2 : 3;

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] px-6 py-12">
      <div className="max-w-md mx-auto space-y-6">
        <div>
          <Link to="/login" className="text-sm text-[var(--content-accent)] hover:underline">
            ← Back to sign in
          </Link>
          <h1 className="text-2xl font-bold text-[var(--content-primary)] mt-4">Reset PIN</h1>
          <p className="text-sm text-[var(--content-secondary)] mt-1">
            Verify your identity, then choose a new PIN.
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs font-medium text-[var(--content-secondary)]">
          {[1, 2, 3].map((n) => (
            <div key={n} className="flex items-center gap-2">
              <span
                className={`inline-flex h-6 w-6 items-center justify-center rounded-full ${
                  n <= stepNumber
                    ? 'bg-[var(--content-accent)] text-white'
                    : 'border border-[var(--border-opaque)]'
                }`}
              >
                {n}
              </span>
              {n < 3 && <span className="w-8 h-px bg-[var(--border-opaque)]" />}
            </div>
          ))}
        </div>

        {step === 'name' && (
          <div className="space-y-4">
            <label className="block">
              <span className="text-sm text-[var(--content-secondary)]">Select your name</span>
              <input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setSelectedUser(null);
                }}
                placeholder="Search your name…"
                className="mt-1 w-full rounded-xl border border-[var(--border-opaque)] bg-[var(--bg-secondary)] px-4 py-3"
              />
            </label>

            {usersLoading && (
              <p className="text-sm text-[var(--content-secondary)]">Loading names…</p>
            )}

            {!usersLoading && resetUsers.length === 0 && (
              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4">
                <p className="text-sm text-[var(--content-secondary)]">
                  No activated accounts found. Use Get started if you have not set up yet.
                </p>
              </div>
            )}

            {!usersLoading && filteredUsers.length > 0 && (
              <ul className="max-h-56 overflow-y-auto rounded-xl border border-[var(--border-subtle)] divide-y divide-[var(--border-subtle)]">
                {filteredUsers.map((user) => (
                  <li key={user.id}>
                    <button
                      type="button"
                      onClick={() => handleSelectUser(user)}
                      className={`w-full px-4 py-3 text-left hover:bg-[var(--bg-tertiary)] ${
                        selectedUser?.id === user.id ? 'bg-[var(--bg-tertiary)]' : ''
                      }`}
                    >
                      <p className="font-medium text-[var(--content-primary)]">{user.full_name}</p>
                      <p className="text-xs text-[var(--content-secondary)] mt-0.5 capitalize">
                        {user.role}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {error && <p className="text-sm text-[var(--content-negative)]">{error}</p>}

            <button
              type="button"
              disabled={!selectedUser}
              onClick={continueFromName}
              className="w-full rounded-xl bg-[var(--content-accent)] text-white font-semibold py-3 disabled:opacity-50"
            >
              Continue
            </button>
          </div>
        )}

        {step === 'phone' && selectedUser && (
          <div className="space-y-4">
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4">
              <p className="font-semibold text-[var(--content-primary)]">{selectedUser.full_name}</p>
              {phoneLast4 && (
                <p className="text-sm text-[var(--content-secondary)] mt-1">
                  Registered number ends in {phoneLast4}
                </p>
              )}
            </div>

            <label className="block">
              <span className="text-sm text-[var(--content-secondary)]">Enter your mobile number</span>
              <input
                type="tel"
                inputMode="numeric"
                value={phone}
                onChange={(e) => {
                  setPhone(normalizePhoneInput(e.target.value));
                  setCodeRequested(false);
                  setInviteCode('');
                }}
                placeholder="9876543210"
                maxLength={10}
                className="mt-1 w-full rounded-xl border border-[var(--border-opaque)] bg-[var(--bg-secondary)] px-4 py-3 font-mono text-lg"
              />
            </label>

            <button
              type="button"
              disabled={loading || !isValidPhone(phone)}
              onClick={() => void requestResetCode()}
              className="w-full rounded-xl border border-[var(--border-opaque)] bg-[var(--bg-secondary)] font-semibold py-3 disabled:opacity-50"
            >
              {loading ? 'Requesting…' : codeRequested ? 'Request code again' : 'Request reset code'}
            </button>

            {codeRequested && (
              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4 space-y-3">
                <p className="text-sm text-[var(--content-secondary)]">
                  Ask your manager for the reset code (Admin → Users). It is not shown here.
                </p>
                <input
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                  placeholder="Manager reset code"
                  autoCapitalize="characters"
                  className="w-full rounded-xl border border-[var(--border-opaque)] bg-[var(--bg-primary)] px-4 py-3 font-mono text-lg tracking-wider"
                />
              </div>
            )}

            {error && <p className="text-sm text-[var(--content-negative)]">{error}</p>}

            <button
              type="button"
              disabled={loading || !codeRequested || !inviteCode.trim()}
              onClick={continueFromPhone}
              className="w-full rounded-xl bg-[var(--content-accent)] text-white font-semibold py-3 disabled:opacity-50"
            >
              Continue
            </button>

            <button
              type="button"
              onClick={() => {
                setStep('name');
                setInviteCode('');
                setPhone('');
                setPhoneLast4(null);
                setCodeRequested(false);
                setError(null);
              }}
              className="w-full text-sm text-[var(--content-tertiary)]"
            >
              Choose a different name
            </button>
          </div>
        )}

        {step === 'pin' && selectedUser && (
          <form onSubmit={(e) => void submitReset(e)} className="space-y-4">
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4">
              <p className="font-semibold text-[var(--content-primary)]">{selectedUser.full_name}</p>
              <p className="text-sm text-[var(--content-secondary)] mt-1 font-mono">
                {normalizePhoneInput(phone)}
              </p>
            </div>

            <label className="block">
              <span className="text-sm text-[var(--content-secondary)]">New PIN (4–6 digits)</span>
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
              <span className="text-sm text-[var(--content-secondary)]">Confirm new PIN</span>
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
              {loading ? 'Updating PIN…' : 'Update PIN & sign in'}
            </button>

            <button
              type="button"
              onClick={() => {
                setStep('phone');
                setPin('');
                setConfirmPin('');
                setError(null);
              }}
              className="w-full text-sm text-[var(--content-tertiary)]"
            >
              Back
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
