import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShoppingCart, ClipboardText, Package } from '@phosphor-icons/react';
import { useAuth } from '../context/AuthContext';
import { BottomSheet } from '../components/shared';

type SheetMode = 'sales' | null;

import { SALES_NAMES } from '../utils/constants';

/* Design system: indigo (sales), blue (billing), amber (picking) — use palette tokens */
const ROLES = [
  {
    key: 'sales' as const,
    icon: ShoppingCart,
    label: 'Sales',
    desc: 'Create & manage orders',
    bgClass: 'bg-[color-mix(in_srgb,var(--indigo-7)_8%,transparent)]',
    iconBgClass: 'bg-[color-mix(in_srgb,var(--indigo-7)_22%,transparent)]',
    iconColorClass: 'text-[var(--indigo-7)]',
  },
  {
    key: 'billing' as const,
    icon: ClipboardText,
    label: 'Billing',
    desc: 'Review & approve',
    bgClass: 'bg-[color-mix(in_srgb,var(--blue-7)_8%,transparent)]',
    iconBgClass: 'bg-[color-mix(in_srgb,var(--blue-7)_22%,transparent)]',
    iconColorClass: 'text-[var(--blue-7)]',
  },
  {
    key: 'picking' as const,
    icon: Package,
    label: 'Picking',
    desc: 'Pick & verify items',
    bgClass: 'bg-[color-mix(in_srgb,var(--amber-7)_8%,transparent)]',
    iconBgClass: 'bg-[color-mix(in_srgb,var(--amber-7)_22%,transparent)]',
    iconColorClass: 'text-[var(--amber-7)]',
  },
] as const;

export default function RoleSelectPage() {
  const [sheetMode, setSheetMode] = useState<SheetMode>(null);
  const navigate = useNavigate();
  const { selectRole } = useAuth();

  function handleSalesSelect(name: string) {
    selectRole('sales', name);
    setSheetMode(null);
    navigate('/sales');
  }

  return (
    <div className="theme-light min-h-screen bg-[var(--bg-primary)] flex flex-col px-6 py-8">
      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="text-2xl font-bold text-[var(--content-primary)]">Welcome</h1>
        <p className="text-sm text-[var(--content-secondary)] mt-1">Select your role</p>
      </div>

      {/* Role cards */}
      <div className="flex-1 flex flex-col gap-4 max-w-md mx-auto w-full">
        {ROLES.map(({ key, icon: Icon, label, desc, bgClass, iconBgClass, iconColorClass }) => (
          <button
            key={key}
            onClick={() => {
              if (key === 'billing') {
                selectRole('billing');
                navigate('/billing');
              } else if (key === 'picking') {
                selectRole('picking');
                navigate('/picking');
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
        className="mx-auto mt-6 text-xs text-[var(--content-tertiary)] hover:text-[var(--content-primary)] transition-colors duration-[var(--transition-ui)] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--content-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-primary)] rounded"
      >
        Admin
      </button>

      {/* Sales name picker */}
      <BottomSheet isOpen={sheetMode === 'sales'} onClose={() => setSheetMode(null)} title="Select your name">
        <div className="space-y-1">
          {SALES_NAMES.map((name) => (
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
    </div>
  );
}
