import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, UsersThree } from '@phosphor-icons/react';
import { AddUserModal } from '../../components/admin/AddUserModal';
import { ConfirmDialog } from '../../components/admin/ConfirmDialog';
import { EditUserModal } from '../../components/admin/EditUserModal';
import { UserTable, type UserRowAction } from '../../components/admin/UserTable';
import { useAuth } from '../../context/AuthContext';
import {
  BRANCH_OPTIONS,
  MANAGEABLE_ROLES,
  getUserManagementStatus,
  type UserManagementStatus,
} from '../../lib/admin/userManagement';
import {
  useCreateUser,
  useDeactivateUser,
  useReactivateUser,
  useRevokeUserAccess,
  useUpdateUser,
  useUserActivationStatus,
  type UserActivationRow,
} from '../../hooks/useUserActivationStatus';

type PendingConfirm =
  | { type: 'revoke'; row: UserActivationRow }
  | { type: 'deactivate'; row: UserActivationRow }
  | null;

const ROLE_HOME: Record<string, string> = {
  sales: '/sales',
  billing: '/billing/queue',
  picking: '/picking',
};

export default function UserManagementPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { userId, startImpersonation } = useAuth();
  const { data: rows = [], isLoading, error } = useUserActivationStatus();
  const createUser = useCreateUser(userId);
  const updateUser = useUpdateUser(userId);
  const deactivateUser = useDeactivateUser(userId);
  const revokeAccess = useRevokeUserAccess(userId);
  const reactivateUser = useReactivateUser(userId);

  const [pendingActionUserId, setPendingActionUserId] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | string>('all');
  const [branchFilter, setBranchFilter] = useState<'all' | string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | UserManagementStatus>('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingUser, setEditingUser] = useState<UserActivationRow | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm>(null);

  const existingNames = useMemo(() => rows.map((row) => row.full_name), [rows]);

  const stats = useMemo(() => {
    const total = rows.length;
    const active = rows.filter((row) => row.is_active && row.auth_id).length;
    const pending = rows.filter(
      (row) => row.is_active && !row.auth_id && row.role !== 'admin',
    ).length;
    const inactive = rows.filter((row) => !row.is_active).length;
    return { total, active, pending, inactive };
  }, [rows]);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (query && !row.full_name.toLowerCase().includes(query)) return false;
      if (roleFilter !== 'all' && row.role !== roleFilter) return false;
      if (branchFilter !== 'all' && row.stock_location_code !== branchFilter) return false;
      if (statusFilter !== 'all' && getUserManagementStatus(row) !== statusFilter) return false;
      return true;
    });
  }, [rows, search, roleFilter, branchFilter, statusFilter]);

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2500);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        setShowAddModal(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleCreateUser = async (input: Parameters<typeof createUser.mutateAsync>[0]) => {
    const result = await createUser.mutateAsync(input);
    showToast(`Created ${result.full_name ?? input.fullName}. Tell them to open Get started.`);
  };

  const handleUpdateUser = async (input: Parameters<typeof updateUser.mutateAsync>[0]) => {
    await updateUser.mutateAsync(input);
    showToast(`Updated ${input.fullName}`);
  };

  const handleConfirmAction = async () => {
    if (!pendingConfirm) return;
    const { row } = pendingConfirm;
    setPendingActionUserId(row.id);
    try {
      if (pendingConfirm.type === 'revoke') {
        await revokeAccess.mutateAsync(row.id);
        showToast(`Revoked access for ${row.full_name}`);
      } else {
        await deactivateUser.mutateAsync(row.id);
        showToast(`Deactivated ${row.full_name}`);
      }
      setPendingConfirm(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setPendingActionUserId(null);
    }
  };

  const handleLoginAs = (row: UserActivationRow) => {
    if (!row.auth_id || row.role === 'admin') {
      showToast('This user cannot be impersonated');
      return;
    }

    const started = startImpersonation({
      userId: row.id,
      userName: row.full_name,
      role: row.role as 'sales' | 'billing' | 'picking',
      branch: row.stock_location_code,
    });

    if (!started) {
      showToast('Unlock admin access before using Login as');
      return;
    }

    const home = ROLE_HOME[row.role];
    if (home) {
      navigate(home);
      showToast(`Viewing as ${row.full_name}`);
    }
  };

  const handleRowAction = (action: UserRowAction, row: UserActivationRow) => {
    switch (action) {
      case 'edit':
        setEditingUser(row);
        return;
      case 'login_as':
        handleLoginAs(row);
        return;
      case 'revoke_access':
        setPendingConfirm({ type: 'revoke', row });
        return;
      case 'deactivate':
        setPendingConfirm({ type: 'deactivate', row });
        return;
      case 'reactivate':
        setPendingActionUserId(row.id);
        void reactivateUser
          .mutateAsync(row.id)
          .then(() => showToast(`Reactivated ${row.full_name}`))
          .catch((err: unknown) =>
            showToast(err instanceof Error ? err.message : 'Reactivation failed'),
          )
          .finally(() => setPendingActionUserId(null));
        return;
      default:
        return;
    }
  };

  return (
    <div className="role-admin min-h-screen bg-[var(--bg-primary)]">
      <div className="p-4 lg:px-6 max-w-6xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/admin')}
            className="p-2 rounded-xl border border-[var(--border-subtle)] text-[var(--content-secondary)]"
            aria-label="Back to admin"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-[var(--content-primary)] flex items-center gap-2">
              <UsersThree size={24} />
              User management
            </h1>
            <p className="text-sm text-[var(--content-secondary)]">
              Add staff, edit roles and branches, and manage access. New users set up at Get started.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-3">
            <p className="text-xs text-[var(--content-secondary)]">Total</p>
            <p className="text-2xl font-bold text-[var(--content-primary)]">{stats.total}</p>
          </div>
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-3">
            <p className="text-xs text-[var(--content-secondary)]">Active</p>
            <p className="text-2xl font-bold text-emerald-600">{stats.active}</p>
          </div>
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-3">
            <p className="text-xs text-[var(--content-secondary)]">Pending</p>
            <p className="text-2xl font-bold text-amber-600">{stats.pending}</p>
          </div>
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-3">
            <p className="text-xs text-[var(--content-secondary)]">Inactive</p>
            <p className="text-2xl font-bold text-[var(--content-secondary)]">{stats.inactive}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="rounded-xl bg-[var(--content-accent)] text-white px-4 py-2 text-sm font-semibold flex items-center gap-2"
          >
            <Plus size={16} weight="bold" />
            Add user
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <label className="md:col-span-2 block">
            <span className="text-xs font-medium text-[var(--content-secondary)]">Search</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by name"
              className="mt-1 w-full rounded-xl border border-[var(--border-subtle)] px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-[var(--content-secondary)]">Role</span>
            <select
              value={roleFilter}
              onChange={(event) => setRoleFilter(event.target.value)}
              className="mt-1 w-full rounded-xl border border-[var(--border-subtle)] px-3 py-2 text-sm"
            >
              <option value="all">All roles</option>
              {MANAGEABLE_ROLES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
              <option value="admin">Admin</option>
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-[var(--content-secondary)]">Status</span>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
              className="mt-1 w-full rounded-xl border border-[var(--border-subtle)] px-3 py-2 text-sm"
            >
              <option value="all">All statuses</option>
              <option value="pending">Pending</option>
              <option value="activated">Activated</option>
              <option value="deactivated">Deactivated</option>
            </select>
          </label>
          <label className="block md:col-span-2">
            <span className="text-xs font-medium text-[var(--content-secondary)]">Branch</span>
            <select
              value={branchFilter}
              onChange={(event) => setBranchFilter(event.target.value)}
              className="mt-1 w-full rounded-xl border border-[var(--border-subtle)] px-3 py-2 text-sm"
            >
              <option value="all">All branches</option>
              {BRANCH_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {toast && (
          <p className="text-sm text-[var(--content-accent)] bg-[var(--bg-secondary)] rounded-xl px-4 py-2">
            {toast}
          </p>
        )}

        {isLoading && <p className="text-sm text-[var(--content-secondary)]">Loading users…</p>}
        {error && (
          <p className="text-sm text-[var(--content-negative)]">
            Could not load users. Apply migrations 128–134 first.
          </p>
        )}

        {!isLoading && !error && (
          <UserTable
            rows={filteredRows}
            pendingActionUserId={pendingActionUserId}
            onAction={handleRowAction}
          />
        )}
      </div>

      {showAddModal && (
        <AddUserModal
          existingNames={existingNames}
          isSubmitting={createUser.isPending}
          onClose={() => setShowAddModal(false)}
          onSubmit={handleCreateUser}
        />
      )}

      {editingUser && (
        <EditUserModal
          user={editingUser}
          existingNames={existingNames}
          isSubmitting={updateUser.isPending}
          onClose={() => setEditingUser(null)}
          onSubmit={handleUpdateUser}
        />
      )}

      {pendingConfirm?.type === 'revoke' && (
        <ConfirmDialog
          title={`Revoke access for ${pendingConfirm.row.full_name}?`}
          description="This removes their phone login immediately. They can set up again via Get started."
          confirmLabel="Revoke access"
          tone="danger"
          isSubmitting={revokeAccess.isPending}
          onCancel={() => setPendingConfirm(null)}
          onConfirm={() => void handleConfirmAction()}
        />
      )}

      {pendingConfirm?.type === 'deactivate' && (
        <ConfirmDialog
          title={`Deactivate ${pendingConfirm.row.full_name}?`}
          description="They will lose access to PASPL and disappear from active staff lists until reactivated."
          confirmLabel="Deactivate user"
          tone="danger"
          isSubmitting={deactivateUser.isPending}
          onCancel={() => setPendingConfirm(null)}
          onConfirm={() => void handleConfirmAction()}
        />
      )}
    </div>
  );
}
