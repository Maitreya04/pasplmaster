import { useState, useCallback, useRef, useEffect } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { Backspace } from '@phosphor-icons/react';
import { useAuth } from '../../context/AuthContext';

export default function AdminPasscodePage() {
  const [code, setCode] = useState('');
  const [error, setError] = useState(false);
  const [checking, setChecking] = useState(false);
  const navigate = useNavigate();
  const { role, adminUnlocked, unlockAdmin } = useAuth();
  const errorTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (errorTimeout.current) clearTimeout(errorTimeout.current);
    };
  }, []);

  const handleDigit = useCallback(
    (digit: string) => {
      if (checking || error) return;

      const next = code + digit;
      if (next.length > 4) return;
      setCode(next);

      if (next.length === 4) {
        setChecking(true);
        const success = unlockAdmin(next);
        if (success) {
          navigate('/admin', { replace: true });
        } else {
          setError(true);
          errorTimeout.current = setTimeout(() => {
            setError(false);
            setCode('');
            setChecking(false);
          }, 1000);
        }
      }
    },
    [code, checking, error, unlockAdmin, navigate],
  );

  const handleBackspace = useCallback(() => {
    if (checking || error) return;
    setCode((prev) => prev.slice(0, -1));
  }, [checking, error]);

  if (role !== 'admin') return <Navigate to="/select-role" replace />;
  if (adminUnlocked) return <Navigate to="/admin" replace />;

  const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

  return (
    <div className="min-h-screen bg-[var(--navy-950)] flex flex-col items-center justify-between px-6 py-16 select-none">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-2xl font-bold text-[var(--navy-400)]">Admin</h1>
        <p className="text-sm text-[var(--navy-500)] mt-2">Enter admin passcode</p>
      </div>

      {/* Code circles + error message */}
      <div className="flex flex-col items-center gap-6">
        <div className={`flex gap-4 ${error ? 'animate-shake' : ''}`}>
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className={`w-4 h-4 rounded-full transition-all duration-150 ${
                i < code.length
                  ? error
                    ? 'bg-[var(--content-negative)] scale-110'
                    : 'bg-white scale-110'
                  : 'border-2 border-[var(--navy-600)]'
              }`}
            />
          ))}
        </div>
        <div className="h-5">
          {error && <p className="text-sm text-[var(--content-negative)]">Incorrect passcode</p>}
        </div>
      </div>

      {/* Number pad */}
      <div className="w-full max-w-[280px]">
        <div className="grid grid-cols-3 gap-3">
          {digits.map((d) => (
            <button
              key={d}
              onClick={() => handleDigit(d)}
              className="w-16 h-16 mx-auto rounded-full flex items-center justify-center font-mono text-xl text-white active:bg-[var(--navy-800)] transition-colors duration-100"
            >
              {d}
            </button>
          ))}
          <div />
          <button
            onClick={() => handleDigit('0')}
            className="w-16 h-16 mx-auto rounded-full flex items-center justify-center font-mono text-xl text-white active:bg-[var(--navy-800)] transition-colors duration-100"
          >
            0
          </button>
          <button
            onClick={handleBackspace}
            className="w-16 h-16 mx-auto rounded-full flex items-center justify-center text-[var(--navy-400)] active:bg-[var(--navy-800)] transition-colors duration-100"
            aria-label="Backspace"
          >
            <Backspace size={24} weight="regular" />
          </button>
        </div>
      </div>
    </div>
  );
}
