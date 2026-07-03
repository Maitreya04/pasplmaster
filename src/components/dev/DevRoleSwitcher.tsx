import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowsLeftRight } from '@phosphor-icons/react';
import { useAuth } from '../../context/AuthContext';
import { useTeamUsers } from '../../hooks/useTeamUsers';
import type { AuthState } from '../../types';

type RoleKey = Exclude<AuthState['role'], null>;

const ROLE_HOME: Record<RoleKey, string> = {
  sales: '/sales',
  billing: '/billing',
  picking: '/picking',
  admin: '/admin',
  partner: '/partner/supply',
};

const ROLE_LABEL: Record<RoleKey, string> = {
  sales: 'Sales',
  billing: 'Billing',
  picking: 'Picking',
  admin: 'Admin',
  partner: 'Partner',
};

export function DevRoleSwitcher(): React.JSX.Element | null {
  const { isAuthenticated, role, selectRole, canSwitchRoles, switchRole, startImpersonation, adminUnlocked, actualRole } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const { data: pickingUsers } = useTeamUsers('picking');

  const isDev = !import.meta.env.PROD;

  const devPickerTarget = useMemo(() => {
    const users = pickingUsers ?? [];
    return (
      users.find((user) => user.full_name === 'Test') ??
      users.find((user) => user.full_name === 'Demo Picker') ??
      users[0] ??
      null
    );
  }, [pickingUsers]);

  if (!isAuthenticated) return null;
  if (!isDev && !canSwitchRoles) return null;

  const handleSwitch = (target: RoleKey) => {
    if (target === 'sales') {
      selectRole('sales', 'Demo Sales');
    } else if (target === 'picking') {
      if (actualRole === 'admin' && adminUnlocked && devPickerTarget) {
        startImpersonation({
          userId: devPickerTarget.id,
          userName: devPickerTarget.full_name,
          role: 'picking',
          branch: devPickerTarget.stock_location_code ?? null,
        });
      } else {
        selectRole('picking', devPickerTarget?.full_name ?? 'Demo Picker');
      }
    } else if (target === 'billing') {
      selectRole('billing', 'Demo Billing');
    } else {
      selectRole('admin');
    }
    navigate(ROLE_HOME[target]);
    setOpen(false);
  };

  const handleOpenRoleSelect = () => {
    switchRole();
    navigate('/select-role');
    setOpen(false);
  };

  const currentLabel = role ? ROLE_LABEL[role as RoleKey] : 'Pick role';

  return (
    <div className="fixed right-3 bottom-28 z-40 flex flex-col items-end gap-2 text-xs pointer-events-none">
      {open && (
        <div className="rounded-2xl bg-black/80 text-white shadow-lg backdrop-blur px-3 py-2 space-y-2 min-w-[180px] pointer-events-auto">
          {canSwitchRoles && !isDev ? (
            <>
              <p className="font-ds-micro uppercase tracking-wide text-white/60">Test admin</p>
              <button
                type="button"
                onClick={handleOpenRoleSelect}
                className="w-full h-8 px-3 rounded-full border border-white/30 text-white/90 hover:bg-white/10 font-ds-label-size"
              >
                Switch role…
              </button>
            </>
          ) : (
            <>
              <p className="mb-1 font-ds-micro uppercase tracking-wide text-white/60">
                Dev Role Switch
              </p>
              <div className="flex flex-wrap gap-1.5">
                {(['sales', 'picking', 'billing'] as RoleKey[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => handleSwitch(key)}
                    className={`h-6 px-3 rounded-full border font-ds-label-size transition-colors ${
                      role === key
                        ? 'bg-white text-black border-white'
                        : 'border-white/30 text-white/90 hover:bg-white/10'
                    }`}
                  >
                    {ROLE_LABEL[key]}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-full bg-black/80 text-white px-3 py-1.5 shadow-lg backdrop-blur-sm pointer-events-auto"
      >
        <ArrowsLeftRight size={16} weight="bold" />
        <span className="font-ds-label-size">{currentLabel}</span>
      </button>
    </div>
  );
}
