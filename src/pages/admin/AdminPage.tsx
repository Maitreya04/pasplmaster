import { useNavigate } from 'react-router-dom';
import { Upload, SignOut } from '@phosphor-icons/react';
import { useAuth } from '../../context/AuthContext';

export default function AdminPage() {
  const navigate = useNavigate();
  const { switchRole } = useAuth();

  return (
    <div className="theme-light role-admin min-h-screen bg-[var(--bg-primary)]">
      <div className="p-4 lg:px-6 max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-[var(--content-primary)]">Admin</h1>
          <button
            onClick={() => {
              switchRole();
              navigate('/select-role');
            }}
            className="flex items-center gap-2 text-sm text-[var(--content-tertiary)] hover:text-[var(--content-primary)] transition-colors"
          >
            <SignOut size={18} weight="regular" />
            Switch Role
          </button>
        </div>

        <button
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
      </div>
    </div>
  );
}
