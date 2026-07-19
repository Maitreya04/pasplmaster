import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash, X } from '@phosphor-icons/react';
import type { UserActivationRow } from '../../hooks/useUserActivationStatus';
import {
  useCopyPreviousYearTargets,
  useFinancialYears,
  useSaveUserSalesTargets,
  useUserSalesTargets,
  type EditableSalesTargetRow,
} from '../../hooks/useSalesTargetManagement';

interface SalesTargetsModalProps {
  user: UserActivationRow;
  onClose: () => void;
}

const blankRow = (): EditableSalesTargetRow => ({
  product_group: '',
  annual_target_lakhs: 0,
  category: null,
});

export function SalesTargetsModal({ user, onClose }: SalesTargetsModalProps): React.JSX.Element {
  const { data: years = [], isLoading: yearsLoading } = useFinancialYears();
  const activeYear = years.find((year) => year.is_active) ?? years[0] ?? null;
  const [selectedYear, setSelectedYear] = useState<string>('');
  const { data: targets = [], isLoading: targetsLoading } = useUserSalesTargets(
    user.id,
    selectedYear || null,
  );
  const saveTargets = useSaveUserSalesTargets();
  const copyTargets = useCopyPreviousYearTargets();
  const [rows, setRows] = useState<EditableSalesTargetRow[]>([blankRow()]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedYear && activeYear?.label) {
      setSelectedYear(activeYear.label);
    }
  }, [activeYear?.label, selectedYear]);

  useEffect(() => {
    if (!selectedYear || targetsLoading) return;
    if (targets.length === 0) {
      setRows([blankRow()]);
      return;
    }
    setRows(
      targets.map((target) => ({
        product_group: target.product_group,
        annual_target_lakhs: Number(target.annual_target_lakhs || 0),
        category: target.category,
      })),
    );
  }, [selectedYear, targets, targetsLoading]);

  const previousYear = useMemo(() => {
    const current = years.find((year) => year.label === selectedYear);
    if (!current) return null;
    const older = years
      .filter((year) => new Date(year.starts_on) < new Date(current.starts_on))
      .sort((a, b) => new Date(b.starts_on).getTime() - new Date(a.starts_on).getTime());
    return older[0] ?? null;
  }, [selectedYear, years]);

  const selectedYearRow = years.find((year) => year.label === selectedYear);
  const isLocked = selectedYearRow?.is_locked ?? false;

  const updateRow = (
    index: number,
    field: keyof EditableSalesTargetRow,
    value: string,
  ) => {
    setRows((current) =>
      current.map((row, rowIndex) =>
        rowIndex === index
          ? {
              ...row,
              [field]: field === 'annual_target_lakhs' ? Number(value || 0) : value,
            }
          : row,
      ),
    );
  };

  const save = async () => {
    if (!selectedYear) {
      setError('Choose a financial year.');
      return;
    }
    setError(null);
    try {
      await saveTargets.mutateAsync({
        userName: user.full_name,
        financialYearLabel: selectedYear,
        rows,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save targets');
    }
  };

  const copyPrevious = async () => {
    if (!previousYear || !selectedYear) return;
    setError(null);
    try {
      await copyTargets.mutateAsync({
        userId: user.id,
        fromFinancialYearLabel: previousYear.label,
        toFinancialYearLabel: selectedYear,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not copy targets');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        className="ds-card p-6 max-w-3xl w-full shadow-xl animate-slide-up"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sales-targets-title"
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h3 id="sales-targets-title" className="text-lg font-bold text-[var(--content-primary)]">
              Sales targets
            </h3>
            <p className="text-sm text-[var(--content-secondary)] mt-1">
              {user.full_name}
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

        <div className="flex flex-wrap items-end gap-3 mb-4">
          <label className="block">
            <span className="text-sm font-medium text-[var(--content-primary)]">Financial year</span>
            <select
              value={selectedYear}
              onChange={(event) => setSelectedYear(event.target.value)}
              className="mt-1 w-40 rounded-xl border border-[var(--border-subtle)] px-3 py-2 text-sm"
              disabled={yearsLoading}
            >
              {years.map((year) => (
                <option key={year.id} value={year.label}>
                  FY {year.label}{year.is_active ? ' active' : ''}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={() => void copyPrevious()}
            disabled={!previousYear || isLocked || copyTargets.isPending}
            className="rounded-xl border border-[var(--border-subtle)] px-3 py-2 text-sm font-medium disabled:opacity-50"
          >
            {copyTargets.isPending ? 'Copying...' : `Copy ${previousYear?.label ?? 'previous FY'}`}
          </button>
        </div>

        <div className="overflow-x-auto rounded-xl border border-[var(--border-subtle)]">
          <table className="min-w-full text-sm">
            <thead className="bg-[var(--bg-tertiary)] text-left text-[var(--content-secondary)]">
              <tr>
                <th className="px-3 py-2 font-medium">Product group</th>
                <th className="px-3 py-2 font-medium">Annual target (L)</th>
                <th className="px-3 py-2 font-medium">Category</th>
                <th className="px-3 py-2 font-medium"> </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index} className="border-t border-[var(--border-subtle)]">
                  <td className="px-3 py-2">
                    <input
                      value={row.product_group}
                      onChange={(event) => updateRow(index, 'product_group', event.target.value)}
                      className="w-full rounded-lg border border-[var(--border-subtle)] px-2 py-1.5"
                      placeholder="e.g. U4 WHEELER"
                      disabled={isLocked}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={row.annual_target_lakhs}
                      onChange={(event) => updateRow(index, 'annual_target_lakhs', event.target.value)}
                      className="w-32 rounded-lg border border-[var(--border-subtle)] px-2 py-1.5 font-mono"
                      disabled={isLocked}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      value={row.category ?? ''}
                      onChange={(event) => updateRow(index, 'category', event.target.value)}
                      className="w-28 rounded-lg border border-[var(--border-subtle)] px-2 py-1.5"
                      placeholder="Optional"
                      disabled={isLocked}
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => setRows((current) => current.filter((_, rowIndex) => rowIndex !== index))}
                      disabled={rows.length <= 1 || isLocked}
                      className="p-2 rounded-lg border border-[var(--border-subtle)] text-[var(--content-secondary)] disabled:opacity-40"
                      aria-label="Remove target row"
                    >
                      <Trash size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setRows((current) => [...current, blankRow()])}
            disabled={isLocked}
            className="rounded-xl border border-[var(--border-subtle)] px-3 py-2 text-sm font-medium flex items-center gap-2 disabled:opacity-50"
          >
            <Plus size={16} />
            Add row
          </button>

          {isLocked && (
            <p className="text-sm text-[var(--content-secondary)]">This financial year is locked.</p>
          )}
          {error && <p className="text-sm text-[var(--content-negative)]">{error}</p>}

          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saveTargets.isPending}
              className="rounded-xl border border-[var(--border-subtle)] px-4 py-2 text-sm disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={isLocked || saveTargets.isPending}
              className="rounded-xl bg-[var(--content-accent)] text-white px-4 py-2 text-sm font-semibold disabled:opacity-50"
            >
              {saveTargets.isPending ? 'Saving...' : 'Save targets'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
