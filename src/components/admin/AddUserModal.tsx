import { useMemo, useState } from 'react';
import { X } from '@phosphor-icons/react';
import {
  BRANCH_OPTIONS,
  MANAGEABLE_ROLES,
  adminUserManagementErrorMessage,
} from '../../lib/admin/userManagement';
import type { CreateUserInput } from '../../hooks/useUserActivationStatus';
import type { StockLocationCode, UserRole } from '../../types';

interface AddUserModalProps {
  existingNames: string[];
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: (input: CreateUserInput) => Promise<void>;
}

export function AddUserModal({
  existingNames,
  isSubmitting,
  onClose,
  onSubmit,
}: AddUserModalProps): React.JSX.Element {
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<Exclude<UserRole, 'admin'>>('sales');
  const [branch, setBranch] = useState<StockLocationCode>('main_store');
  const [stationLabel, setStationLabel] = useState('');
  const [error, setError] = useState<string | null>(null);

  const normalizedExisting = useMemo(
    () => new Set(existingNames.map((name) => name.trim().toLowerCase())),
    [existingNames],
  );

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
        aria-labelledby="add-user-title"
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h3 id="add-user-title" className="text-lg font-bold text-[var(--content-primary)]">
              Add user
            </h3>
            <p className="text-sm text-[var(--content-secondary)] mt-1">
              Create a staff profile. They can set up login at Get started on the sign-in page.
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
              placeholder="e.g. Ashok Kumar"
              autoFocus
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
                placeholder="e.g. Station 1"
              />
            </label>
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
              {isSubmitting ? 'Creating…' : 'Create user'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
