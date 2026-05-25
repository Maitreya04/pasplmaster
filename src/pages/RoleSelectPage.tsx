import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShoppingCart, ClipboardText, Package } from '@phosphor-icons/react';
import { useAuth } from '../context/AuthContext';
import { BottomSheet } from '../components/shared';
import { useTeamUsers } from '../hooks/useTeamUsers';
import { warmPickQueueRoute } from '../lib/picking/warmPickQueue';

type SheetMode = 'sales' | 'billing' | 'picking' | null;

import { SALES_NAMES, PICKER_NAMES, BILLING_NAMES } from '../utils/constants';

/* Design system: indigo (sales), blue (billing), amber (picking) — use palette tokens */
const ROLES = [
  {
    key: 'sales' as const,
    icon: ShoppingCart,
    label: 'Sales',
    desc: 'Create & manage orders',
    bgClass: 'bg-indigo-50',
    iconBgClass: 'bg-indigo-100',
    iconColorClass: 'text-indigo-600',
  },
  {
    key: 'billing' as const,
    icon: ClipboardText,
    label: 'Billing',
    desc: 'Review & approve',
    bgClass: 'bg-blue-50',
    iconBgClass: 'bg-blue-100',
    iconColorClass: 'text-blue-600',
  },
  {
    key: 'picking' as const,
    icon: Package,
    label: 'Picking',
    desc: 'Pick & verify items',
    bgClass: 'bg-amber-50',
    iconBgClass: 'bg-amber-100',
    iconColorClass: 'text-amber-600',
  },
] as const;

export default function RoleSelectPage(): React.JSX.Element | null {
  const [sheetMode, setSheetMode] = useState<SheetMode>(null);
  const navigate = useNavigate();
  const { selectRole } = useAuth();

  // Fetch user names from DB, fall back to hardcoded constants
  const { data: salesUsers } = useTeamUsers('sales');
  const { data: billingUsers } = useTeamUsers('billing');
  const { data: pickingUsers } = useTeamUsers('picking');

  const salesNames = useMemo(
    () => salesUsers?.map(u => u.full_name) ?? SALES_NAMES,
    [salesUsers],
  );
  const billingNames = useMemo(
    () => billingUsers?.map(u => u.full_name) ?? BILLING_NAMES,
    [billingUsers],
  );
  const pickerNames = useMemo(
    () => pickingUsers?.map(u => u.full_name) ?? PICKER_NAMES,
    [pickingUsers],
  );

  function handleSalesSelect(name: string) {
    selectRole('sales', name);
    setSheetMode(null);
    navigate('/sales');
  }

  function handleBillingSelect(name: string) {
    selectRole('billing', name);
    setSheetMode(null);
    navigate('/billing');
  }

  function handlePickerSelect(name: string) {
    selectRole('picking', name);
    setSheetMode(null);
    warmPickQueueRoute(null);
    navigate('/picking');
  }

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] flex flex-col px-6 py-8 relative overflow-hidden">
      {/* Ambient glowing background orbs */}
      <div className="absolute top-[-10%] left-[-10%] w-[40vw] h-[40vw] rounded-full bg-indigo-500/10 blur-[80px] pointer-events-none mix-blend-multiply" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[50vw] h-[50vw] rounded-full bg-blue-500/10 blur-[100px] pointer-events-none mix-blend-multiply" />
      
      {/* Header */}
      <div className="text-center mb-8 relative z-10 pt-4">
        <h1 className="text-3xl font-bold tracking-tight text-[var(--content-primary)]">Welcome</h1>
        <p className="text-sm font-medium text-[var(--content-secondary)] mt-1.5">Select your role to continue</p>
      </div>

      {/* Role cards */}
      <div className="flex-1 flex flex-col gap-4 max-w-md mx-auto w-full relative z-10">
        {ROLES.map(({ key, icon: Icon, label, desc, bgClass, iconBgClass, iconColorClass }) => (
          <button
            key={key}
            onClick={() => {
              if (key === 'billing') {
                setSheetMode('billing');
              } else if (key === 'picking') {
                warmPickQueueRoute(null);
                setSheetMode('picking');
              } else {
                setSheetMode('sales');
              }
            }}
            className={`flex-1 rounded-2xl p-6 flex items-center gap-5 border border-[var(--border-subtle)] shadow-[var(--shadow-card)] transition-[transform,box-shadow,border-color] duration-[var(--transition-ui)] active:scale-[0.98] hover:shadow-[var(--shadow-card-hover)] hover:border-[var(--border-opaque)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--content-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-primary)] ${bgClass}`}
          >
            <div
              className={`w-14 h-14 rounded-xl flex items-center justify-center shrink-0 ${iconBgClass}`}
            >
              <Icon size={28} weight="duotone" className={iconColorClass} />
            </div>
            <div className="text-left">
              <p className="text-lg font-semibold text-[var(--content-primary)]">{label}</p>
              <p className="text-sm text-[var(--content-secondary)]">{desc}</p>
            </div>
          </button>
        ))}
      </div>

      {/* Admin link */}
      <button
        onClick={() => {
          selectRole('admin');
          navigate('/admin-passcode');
        }}
        className="mx-auto mt-6 min-h-11 min-w-11 flex items-center justify-center text-xs text-[var(--content-tertiary)] hover:text-[var(--content-primary)] transition-colors duration-[var(--transition-ui)] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--content-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-primary)] rounded"
      >
        Admin
      </button>

      {/* Sales name picker */}
      <BottomSheet isOpen={sheetMode === 'sales'} onClose={() => setSheetMode(null)} title="Select your name">
        <div className="space-y-1">
          {salesNames.map((name) => (
            <button
              key={name}
              onClick={() => handleSalesSelect(name)}
              className="w-full text-left px-4 py-3 rounded-xl text-[var(--content-primary)] hover:bg-[var(--bg-tertiary)] active:bg-[var(--bg-tertiary)] transition-colors duration-150 text-base"
            >
              {name}
            </button>
          ))}
        </div>
      </BottomSheet>

      {/* Billing name picker */}
      <BottomSheet isOpen={sheetMode === 'billing'} onClose={() => setSheetMode(null)} title="Select your name">
        <div className="space-y-1">
          {billingNames.map((name) => (
            <button
              key={name}
              onClick={() => handleBillingSelect(name)}
              className="w-full text-left px-4 py-3 rounded-xl text-[var(--content-primary)] hover:bg-[var(--bg-tertiary)] active:bg-[var(--bg-tertiary)] transition-colors duration-150 text-base"
            >
              {name}
            </button>
          ))}
        </div>
      </BottomSheet>

      {/* Picker name picker */}
      <BottomSheet isOpen={sheetMode === 'picking'} onClose={() => setSheetMode(null)} title="Select your name">
        <div className="space-y-1">
          {pickerNames.map((name) => (
            <button
              key={name}
              onClick={() => handlePickerSelect(name)}
              className="w-full text-left px-4 py-3 rounded-xl text-[var(--content-primary)] hover:bg-[var(--bg-tertiary)] active:bg-[var(--bg-tertiary)] transition-colors duration-150 text-base"
            >
              {name}
            </button>
          ))}
        </div>
      </BottomSheet>
    </div>
  );
}
