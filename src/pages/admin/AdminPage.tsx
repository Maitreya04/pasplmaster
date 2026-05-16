import { useNavigate } from 'react-router-dom';
import {
  Upload,
  SignOut,
  ChartBar,
  Tag,
  Camera,
  MagicWand,
  Database,
  Barcode,
  Scales,
  Warehouse,
} from '@phosphor-icons/react';
import { useAuth } from '../../context/AuthContext';
import { NotificationDiagnosticsPanel } from '../../components/notifications/NotificationDiagnosticsPanel';

export default function AdminPage(): React.JSX.Element | null {
  const navigate = useNavigate();
  const { switchRole } = useAuth();

  return (
    <div className="role-admin min-h-screen bg-[var(--bg-primary)]">
      <div className="p-4 lg:px-6 max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-[var(--content-primary)]">Admin</h1>
          <button
            onClick={() => {
              switchRole();
              navigate('/select-role');
            }}
            className="flex items-center gap-2 text-sm text-[var(--content-tertiary)] hover:text-[var(--content-primary)] transition-colors min-h-11"
          >
            <SignOut size={18} weight="regular" />
            Switch Role
          </button>
        </div>

        <div className="mb-8">
          <NotificationDiagnosticsPanel />
        </div>

        <div className="space-y-3">
          <button
            type="button"
            onClick={() => navigate('/admin/cycle-count')}
            className="w-full flex items-center gap-4 p-4 rounded-2xl bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors border border-[var(--border-subtle)]"
          >
            <div className="w-12 h-12 rounded-xl bg-[var(--bg-accent-subtle)] flex items-center justify-center">
              <Database size={22} weight="regular" className="text-[var(--content-accent)]" />
            </div>
            <div className="text-left">
              <p className="font-semibold text-[var(--content-primary)]">WMS cycle count</p>
              <p className="text-sm text-[var(--content-tertiary)]">
                Bin inventory setup, counts, and variance approvals
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => navigate('/admin/bin-onboarding')}
            className="w-full flex items-center gap-4 p-4 rounded-2xl bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors border border-[var(--border-subtle)]"
          >
            <div className="w-12 h-12 rounded-xl bg-[var(--role-primary-subtle)] flex items-center justify-center">
              <Warehouse size={22} weight="regular" className="text-[var(--role-primary)]" />
            </div>
            <div className="text-left">
              <p className="font-semibold text-[var(--content-primary)]">
                SKU onboarding (bin + barcode + UoM)
              </p>
              <p className="text-sm text-[var(--content-tertiary)]">
                Floor wizard: map tiers at the bin and confirm pack sizes in one worksheet
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => navigate('/admin/barcode-mapping')}
            className="w-full flex items-center gap-4 p-4 rounded-2xl bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors border border-[var(--border-subtle)]"
          >
            <div className="w-12 h-12 rounded-xl bg-[var(--bg-positive-subtle)] flex items-center justify-center">
              <Barcode size={22} weight="regular" className="text-[var(--content-positive)]" />
            </div>
            <div className="text-left">
              <p className="font-semibold text-[var(--content-primary)]">Barcode mapping</p>
              <p className="text-sm text-[var(--content-tertiary)]">
                Link manufacturer barcodes to Busy SKUs
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => navigate('/admin/uom-onboarding')}
            className="w-full flex items-center gap-4 p-4 rounded-2xl bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors border border-[var(--border-subtle)]"
          >
            <div className="w-12 h-12 rounded-xl bg-[var(--bg-accent-subtle)] flex items-center justify-center">
              <Scales size={22} weight="regular" className="text-[var(--content-accent)]" />
            </div>
            <div className="text-left">
              <p className="font-semibold text-[var(--content-primary)]">UoM onboarding</p>
              <p className="text-sm text-[var(--content-tertiary)]">
                Scan-driven pack/box hierarchy per Busy code + coverage gaps
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => navigate('/admin/supply')}
            className="w-full flex items-center gap-4 p-4 rounded-2xl bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors border border-[var(--border-subtle)]"
          >
            <div className="w-12 h-12 rounded-xl bg-[var(--bg-accent-subtle)] flex items-center justify-center">
              <ChartBar size={22} weight="regular" className="text-[var(--content-accent)]" />
            </div>
            <div className="text-left">
              <p className="font-semibold text-[var(--content-primary)]">Supply cockpit</p>
              <p className="text-sm text-[var(--content-tertiary)]">
                PO demand rollups & pending queue
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => navigate('/admin/upload')}
            className="w-full flex items-center gap-4 p-4 rounded-2xl bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
          >
            <div className="w-12 h-12 rounded-xl bg-[var(--bg-tertiary)] flex items-center justify-center">
              <Upload size={22} weight="regular" className="text-[var(--content-secondary)]" />
            </div>
            <div className="text-left">
              <p className="font-semibold text-[var(--content-primary)]">Upload Data</p>
              <p className="text-sm text-[var(--content-tertiary)]">Import items, stock & customers</p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => navigate('/admin/labels')}
            className="w-full flex items-center gap-4 p-4 rounded-2xl bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors border border-[var(--border-subtle)]"
          >
            <div className="w-12 h-12 rounded-xl bg-[var(--bg-warning-subtle)] flex items-center justify-center">
              <Tag size={22} weight="regular" className="text-[var(--content-warning)]" />
            </div>
            <div className="text-left">
              <p className="font-semibold text-[var(--content-primary)]">Label Studio</p>
              <p className="text-sm text-[var(--content-tertiary)]">
                Print A4 SKU labels with alias fallback
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => navigate('/admin/pick-scan-lab')}
            className="w-full flex items-center gap-4 p-4 rounded-2xl bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors border border-[var(--border-subtle)]"
          >
            <div className="w-12 h-12 rounded-xl bg-[var(--bg-positive-subtle)] flex items-center justify-center">
              <Camera size={22} weight="regular" className="text-[var(--content-positive)]" />
            </div>
            <div className="text-left">
              <p className="font-semibold text-[var(--content-primary)]">Pick Scan Lab</p>
              <p className="text-sm text-[var(--content-tertiary)]">
                Test live QR picking against Alias 1 / Alias
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => navigate('/admin/ocr-lab')}
            className="w-full flex items-center gap-4 p-4 rounded-2xl bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors border border-[var(--border-subtle)]"
          >
            <div className="w-12 h-12 rounded-xl bg-[var(--bg-accent-subtle)] flex items-center justify-center">
              <MagicWand size={22} weight="regular" className="text-[var(--content-accent)]" />
            </div>
            <div className="text-left">
              <p className="font-semibold text-[var(--content-primary)]">OCR Order Lab</p>
              <p className="text-sm text-[var(--content-tertiary)]">
                Test handwritten order extraction and item matching
              </p>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
