import { useMemo, useState } from 'react';
import { X } from '@phosphor-icons/react';
import {
  BRANCH_OPTIONS,
  MANAGEABLE_ROLES,
  adminUserManagementErrorMessage,
} from '../../lib/admin/userManagement';
import type { UpdateUserInput, UserActivationRow } from '../../hooks/useUserActivationStatus';
import type { StockLocationCode, UserRole } from '../../types';

interface EditUserModalProps {
  user: UserActivationRow;
  existingNames: string[];
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: (input: UpdateUserInput) => Promise<void>;
}

export function EditUserModal({
  user,
  existingNames,
  isSubmitting,
  onClose,
  onSubmit,
}: EditUserModalProps): React.JSX.Element {
  const activated = Boolean(user.auth_id);
  const [fullName, setFullName] = useState(user.full_name);
  const [role, setRole] = useState<Exclude<UserRole, 'admin'>>(
    user.role as Exclude<UserRole, 'admin'>,
  );
  const [branch, setBranch] = useState<StockLocationCode>(user.stock_location_code ?? 'main_store');
  const [stationLabel, setStationLabel] = useState(user.station_label ?? '');
  const [error, setError] = useState<string | null>(null);
  const phone = user.phone ?? '';

  const normalizedExisting = useMemo(
    () =>
      new Set(
        existingNames
          .filter((name) => name.trim().toLowerCase() !== user.full_name.trim().toLowerCase())
          .map((name) => name.trim().toLowerCase()),
      ),
    [existingNames, user.full_name],
  );

  const roleChanged = role !== user.role;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmedName = fullName.trim();

    if (trimmedName.length < 2) {
      setError('Enter the staff member’s full name.');
      return;
    }

    if (normalizedExisting.has(trimmedName.toLowerCase())) {
      setError('A user with this name already exists.');
      return;
    }

    setError(null);
    try {
      await onSubmit({
        userId: user.id,
        fullName: trimmedName,
        role,
        branch,
        stationLabel: role === 'billing' ? stationLabel.trim() : undefined,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : adminUserManagementErrorMessage(undefined));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        className="ds-card p-6 max-w-lg w-full shadow-xl animate-slide-up"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-user-title"
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h3 id="edit-user-title" className="text-lg font-bold text-[var(--content-primary)]">
              Edit user
            </h3>
            <p className="text-sm text-[var(--content-secondary)] mt-1">
              Update role, branch, and profile details for {user.full_name}.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl border border-[var(--border-subtle)] text-[var(--content-secondary)]"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={(event) => void handleSubmit(event)} className="space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-[var(--content-primary)]">Full name</span>
            <input
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              className="mt-1 w-full rounded-xl border border-[var(--border-subtle)] px-3 py-2 text-sm"
            />
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-sm font-medium text-[var(--content-primary)]">Role</span>
              <select
                value={role}
                onChange={(event) => setRole(event.target.value as Exclude<UserRole, 'admin'>)}
                className="mt-1 w-full rounded-xl border border-[var(--border-subtle)] px-3 py-2 text-sm"
              >
                {MANAGEABLE_ROLES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-sm font-medium text-[var(--content-primary)]">Branch</span>
              <select
                value={branch}
                onChange={(event) => setBranch(event.target.value as StockLocationCode)}
                className="mt-1 w-full rounded-xl border border-[var(--border-subtle)] px-3 py-2 text-sm"
              >
                {BRANCH_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {role === 'billing' && (
            <label className="block">
              <span className="text-sm font-medium text-[var(--content-primary)]">
                Station label (optional)
              </span>
              <input
                value={stationLabel}
                onChange={(event) => setStationLabel(event.target.value)}
                className="mt-1 w-full rounded-xl border border-[var(--border-subtle)] px-3 py-2 text-sm"
              />
            </label>
          )}

          <label className="block">
            <span className="text-sm font-medium text-[var(--content-primary)]">Phone</span>
            <input
              value={phone}
              readOnly
              className="mt-1 w-full rounded-xl border border-[var(--border-subtle)] px-3 py-2 text-sm font-mono bg-[var(--bg-tertiary)]"
              placeholder="Available after activation"
            />
            <span className="block text-xs text-[var(--content-secondary)] mt-1">
              {activated
                ? 'Phone login is tied to activation. Revoke access to change it.'
                : 'Phone is set when the user activates their account.'}
            </span>
          </label>

          {activated && roleChanged && (
            <p className="text-sm text-amber-700 bg-amber-50 rounded-xl px-3 py-2">
              Changing role updates permissions immediately for this activated user.
            </p>
          )}

          {error && <p className="text-sm text-[var(--content-negative)]">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="rounded-xl border border-[var(--border-subtle)] px-4 py-2 text-sm disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-xl bg-[var(--content-accent)] text-white px-4 py-2 text-sm font-semibold disabled:opacity-50"
            >
              {isSubmitting ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
