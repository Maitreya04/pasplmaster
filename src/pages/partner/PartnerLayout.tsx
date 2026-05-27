import { Outlet, useNavigate } from 'react-router-dom';
import { SignOut } from '@phosphor-icons/react';
import { useAuth } from '../../context/AuthContext';

export default function PartnerLayout(): React.JSX.Element {
  const navigate = useNavigate();
  const { userName, switchRole } = useAuth();

  return (
    <div className="role-partner min-h-screen bg-[var(--bg-primary)]">
      <header className="sticky top-0 z-10 border-b border-[var(--border-subtle)] bg-[var(--bg-primary)]/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 lg:px-6">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-[var(--content-primary)]">
              {userName ?? 'Company Rep'}
            </p>
            <p className="text-xs text-[var(--content-tertiary)]">Pending demand portal</p>
          </div>
          <button
            type="button"
            onClick={() => {
              switchRole();
              navigate('/select-role');
            }}
            className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-[var(--content-tertiary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--content-primary)]"
          >
            <SignOut size={18} weight="regular" />
            Switch role
          </button>
        </div>
      </header>
      <Outlet />
    </div>
  );
}
