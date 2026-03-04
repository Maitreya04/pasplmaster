import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowsLeftRight } from '@phosphor-icons/react';
import { useAuth } from '../../context/AuthContext';
import type { AuthState } from '../../types';

type RoleKey = Exclude<AuthState['role'], null>;

const ROLE_HOME: Record<RoleKey, string> = {
  sales: '/sales',
  billing: '/billing',
  picking: '/picking',
  admin: '/admin',
};

const ROLE_LABEL: Record<RoleKey, string> = {
  sales: 'Sales',
  billing: 'Billing',
  picking: 'Picking',
  admin: 'Admin',
};

export function DevRoleSwitcher() {
  const { isAuthenticated, role, selectRole } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const isProd = import.meta.env.PROD;

  if (isProd || !isAuthenticated) return null;

  const handleSwitch = (target: RoleKey) => {
    if (target === 'sales') {
      selectRole('sales', 'Demo Sales');
    } else if (target === 'picking') {
      selectRole('picking', 'Demo Picker');
    } else if (target === 'billing') {
      selectRole('billing', 'Demo Billing');
    } else {
      selectRole('admin', 'Demo Admin');
    }
    navigate(ROLE_HOME[target]);
    setOpen(false);
  };

  const currentLabel = role ? ROLE_LABEL[role as RoleKey] : 'No role';

  return (
    <div className="fixed right-3 bottom-28 z-40 flex flex-col items-end gap-2 text-xs pointer-events-none">
      {open && (
        <div className="rounded-2xl bg-black/80 text-white shadow-lg backdrop-blur px-3 py-2 space-y-1 min-w-[180px] pointer-events-auto">
          <p className="mb-1 text-[10px] uppercase tracking-wide text-white/60">
            Dev Role Switch
          </p>
          <div className="flex flex-wrap gap-1.5">
            {(['sales', 'picking', 'billing'] as RoleKey[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => handleSwitch(key)}
                className={`h-6 px-3 rounded-full border text-[11px] transition-colors ${
                  role === key
                    ? 'bg-white text-black border-white'
                    : 'border-white/30 text-white/90 hover:bg-white/10'
                }`}
              >
                {ROLE_LABEL[key]}
              </button>
            ))}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-full bg-black/80 text-white px-3 py-1.5 shadow-lg backdrop-blur-sm pointer-events-auto"
      >
        <ArrowsLeftRight size={16} weight="bold" />
        <span className="text-[11px]">
          {currentLabel}
        </span>
      </button>
    </div>
  );
}

