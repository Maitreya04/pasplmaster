import { useNavigate } from 'react-router-dom';
import { SignOut } from '@phosphor-icons/react';
import { useAuth } from '../../context/AuthContext';

const ROLE_HOME: Record<string, string> = {
  sales: '/sales',
  billing: '/billing/queue',
  picking: '/picking',
  admin: '/admin',
};

export function ImpersonationBanner(): React.JSX.Element | null {
  const navigate = useNavigate();
  const { isImpersonating, userName, role, exitImpersonation } = useAuth();

  if (!isImpersonating || !userName || !role) return null;

  const handleExit = () => {
    exitImpersonation();
    navigate(ROLE_HOME.admin ?? '/admin', { replace: true });
  };

  return (
    <div className="sticky top-0 z-50 flex items-center justify-between gap-3 border-b border-amber-300/40 bg-amber-50 px-4 py-2 text-sm text-amber-950">
      <p>
        Viewing as <span className="font-semibold">{userName}</span>
        <span className="text-amber-800 capitalize"> ({role})</span>
      </p>
      <button
        type="button"
        onClick={handleExit}
        className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-950 hover:bg-amber-100"
      >
        <SignOut size={14} />
        Exit impersonation
      </button>
    </div>
  );
}
