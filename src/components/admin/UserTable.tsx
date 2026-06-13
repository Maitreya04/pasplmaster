import { useEffect, useRef, useState } from 'react';
import { DotsThreeVertical } from '@phosphor-icons/react';
import { branchDisplayName } from '../../lib/auth/phoneAuth';
import { getUserManagementStatus } from '../../lib/admin/userManagement';
import type { UserActivationRow } from '../../hooks/useUserActivationStatus';

export type UserRowAction =
  | 'edit'
  | 'login_as'
  | 'revoke_access'
  | 'deactivate'
  | 'reactivate';

interface UserTableProps {
  rows: UserActivationRow[];
  pendingActionUserId: number | null;
  onAction: (action: UserRowAction, row: UserActivationRow) => void;
}

function statusLabel(row: UserActivationRow): { text: string; className: string } {
  const status = getUserManagementStatus(row);
  if (status === 'activated') {
    return { text: 'Activated', className: 'text-emerald-600 font-medium' };
  }
  if (status === 'deactivated') {
    return { text: 'Inactive', className: 'text-[var(--content-secondary)] font-medium' };
  }
  return { text: 'Pending', className: 'text-amber-600 font-medium' };
}

function actionItems(row: UserActivationRow): Array<{ action: UserRowAction; label: string; danger?: boolean }> {
  const status = getUserManagementStatus(row);
  if (row.role === 'admin') {
    return [];
  }

  if (status === 'deactivated') {
    return [{ action: 'reactivate', label: 'Reactivate user' }];
  }

  const items: Array<{ action: UserRowAction; label: string; danger?: boolean }> = [
    { action: 'edit', label: 'Edit details' },
  ];

  if (status === 'activated') {
    items.push({ action: 'login_as', label: 'Login as user' });
    items.push({ action: 'revoke_access', label: 'Revoke access', danger: true });
  }

  items.push({ action: 'deactivate', label: 'Deactivate user', danger: true });
  return items;
}

export function UserTable({
  rows,
  pendingActionUserId,
  onAction,
}: UserTableProps): React.JSX.Element {
  const [openMenuUserId, setOpenMenuUserId] = useState<number | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpenMenuUserId(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-[var(--border-subtle)] px-4 py-10 text-center">
        <p className="text-sm font-medium text-[var(--content-primary)]">No users match your filters</p>
        <p className="text-sm text-[var(--content-secondary)] mt-1">
          Try clearing search or filters, or add a new user.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-[var(--border-subtle)]">
      <table className="min-w-full text-sm">
        <thead className="bg-[var(--bg-tertiary)] text-left text-[var(--content-secondary)]">
          <tr>
            <th className="px-3 py-2 font-medium">Name</th>
            <th className="px-3 py-2 font-medium">Role</th>
            <th className="px-3 py-2 font-medium">Branch</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Phone</th>
            <th className="px-3 py-2 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const status = statusLabel(row);
            const items = actionItems(row);
            const isBusy = pendingActionUserId === row.id;

            return (
              <tr
                key={row.id}
                className={`border-t border-[var(--border-subtle)] ${!row.is_active ? 'opacity-70' : ''}`}
              >
                <td className="px-3 py-2 font-medium text-[var(--content-primary)]">{row.full_name}</td>
                <td className="px-3 py-2 capitalize">{row.role}</td>
                <td className="px-3 py-2">{branchDisplayName(row.stock_location_code)}</td>
                <td className="px-3 py-2">
                  <span className={status.className}>{status.text}</span>
                </td>
                <td className="px-3 py-2 font-mono">{row.phone ?? '—'}</td>
                <td className="px-3 py-2">
                  {items.length === 0 ? (
                    <span className="text-[var(--content-secondary)]">—</span>
                  ) : (
                    <div className="relative inline-block" ref={openMenuUserId === row.id ? menuRef : undefined}>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => setOpenMenuUserId((current) => (current === row.id ? null : row.id))}
                        className="inline-flex items-center gap-1 rounded-lg border border-[var(--border-subtle)] px-2 py-1 text-xs font-medium disabled:opacity-50"
                        aria-label={`Actions for ${row.full_name}`}
                      >
                        {isBusy ? 'Working…' : 'Actions'}
                        <DotsThreeVertical size={14} />
                      </button>

                      {openMenuUserId === row.id && (
                        <div className="absolute right-0 z-20 mt-1 min-w-44 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] shadow-lg py-1">
                          {items.map((item) => (
                            <button
                              key={item.action}
                              type="button"
                              onClick={() => {
                                setOpenMenuUserId(null);
                                onAction(item.action, row);
                              }}
                              className={`block w-full px-3 py-2 text-left text-sm hover:bg-[var(--bg-tertiary)] ${
                                item.danger ? 'text-[var(--content-negative)]' : 'text-[var(--content-primary)]'
                              }`}
                            >
                              {item.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
