import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShoppingCart, ClipboardText, Package } from '@phosphor-icons/react';
import { useAuth } from '../context/AuthContext';
import { BottomSheet } from '../components/shared';

type SheetMode = 'sales' | null;

const SALES_NAMES = [
  'Satish',
  'Hemant',
  'Mankar',
  'Raju Ji',
  'Rehan Multani',
  'Hardeep Singh',
  'Deepak',
  'Vinod',
  'Sachin Rao',
  'Anand Awasthi',
  'Gourav Yadav',
  'Mahendra Rajput',
  'Manish Sharma',
  'Shri Ram Sharma',
  'Asad Khan',
  'Direct',
];

const ROLES = [
  {
    key: 'sales' as const,
    icon: ShoppingCart,
    label: 'Sales',
    desc: 'Create & manage orders',
    tint: 'rgba(79, 70, 229, 0.12)',
    iconColor: '#818cf8',
  },
  {
    key: 'billing' as const,
    icon: ClipboardText,
    label: 'Billing',
    desc: 'Review & approve',
    tint: 'rgba(37, 99, 235, 0.12)',
    iconColor: '#60a5fa',
  },
  {
    key: 'picking' as const,
    icon: Package,
    label: 'Picking',
    desc: 'Pick & verify items',
    tint: 'rgba(245, 158, 11, 0.12)',
    iconColor: '#fbbf24',
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
    <div className="theme-dark min-h-screen bg-[var(--navy-950)] flex flex-col px-6 py-8">
      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="text-2xl font-bold text-white">Welcome</h1>
        <p className="text-sm text-[var(--navy-300)] mt-1">Select your role</p>
      </div>

      {/* Role cards */}
      <div className="flex-1 flex flex-col gap-4 max-w-md mx-auto w-full">
        {ROLES.map(({ key, icon: Icon, label, desc, tint, iconColor }) => (
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
            className="flex-1 rounded-2xl p-6 flex items-center gap-5 transition-transform duration-100 active:scale-[0.98]"
            style={{ backgroundColor: tint }}
          >
            <div
              className="w-14 h-14 rounded-xl flex items-center justify-center shrink-0"
              style={{ backgroundColor: `${iconColor}22` }}
            >
              <Icon size={28} weight="duotone" style={{ color: iconColor }} />
            </div>
            <div className="text-left">
              <p className="text-lg font-semibold text-white">{label}</p>
              <p className="text-sm text-[var(--navy-300)]">{desc}</p>
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
        className="mx-auto mt-6 text-xs text-[var(--navy-500)] hover:text-[var(--navy-300)] transition-colors"
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
