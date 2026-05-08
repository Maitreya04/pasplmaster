import { Check, MagnifyingGlass } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import type { AppUser } from '../../types';
import { useTeamUsers } from '../../hooks/useTeamUsers';
import { BottomSheet } from './BottomSheet';

interface SalespersonSelectorSheetProps {
  isOpen: boolean;
  onClose: () => void;
  selectedUserId?: number | null;
  onSelect: (user: AppUser) => void;
  title?: string;
}

export function SalespersonSelectorSheet({
  isOpen,
  ...props
}: SalespersonSelectorSheetProps): React.JSX.Element | null {
  if (!isOpen) return null;
  return <SalespersonSelectorSheetContent isOpen={isOpen} {...props} />;
}

function SalespersonSelectorSheetContent({
  isOpen,
  onClose,
  selectedUserId = null,
  onSelect,
  title = 'Select Salesperson',
}: SalespersonSelectorSheetProps): React.JSX.Element {
  const { data: salespeople = [], isLoading } = useTeamUsers('sales');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return salespeople;
    return salespeople
      .map((user) => {
        const name = user.full_name.toLowerCase();
        const station = (user.station_label ?? '').toLowerCase();
        let score = Number.POSITIVE_INFINITY;
        if (name === q) score = 0;
        else if (name.startsWith(q)) score = 1;
        else if (name.split(/\s+/).some((part) => part.startsWith(q))) score = 2;
        else if (station.startsWith(q)) score = 3;
        else if (name.includes(q)) score = 4;
        else if (station.includes(q)) score = 5;
        return { user, score };
      })
      .filter((entry) => Number.isFinite(entry.score))
      .sort((a, b) => a.score - b.score || a.user.full_name.localeCompare(b.user.full_name))
      .map((entry) => entry.user);
  }, [salespeople, query]);

  const closeAndReset = () => {
    setQuery('');
    onClose();
  };

  const handleSelect = (user: AppUser) => {
    onSelect(user);
    closeAndReset();
  };

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={closeAndReset}
      sheetClassName="h-[68vh] max-h-[68vh]"
      contentClassName="!px-0 !pb-0"
      keyboardBehavior="static"
    >
      <div className="flex h-full min-h-0 flex-col">
        <div className="shrink-0 space-y-4 px-5 pb-4">
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={closeAndReset}
              className="inline-flex min-h-11 items-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 text-sm font-semibold text-[var(--content-primary)]"
            >
              Cancel
            </button>
            <h2 className="text-lg font-semibold text-[var(--content-primary)]">{title}</h2>
            <span className="h-11 w-11" aria-hidden="true" />
          </div>

          <div className="relative">
            <MagnifyingGlass
              size={18}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--content-tertiary)]"
            />
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by name or station..."
              autoFocus
              className="w-full min-h-14 rounded-2xl border border-[var(--border-opaque)] bg-[var(--bg-secondary)] pl-10 pr-4 text-base text-[var(--content-primary)] placeholder:text-[var(--content-quaternary)] outline-none focus:ring-1 focus:ring-[var(--border-opaque)]"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
          <div className="space-y-2">
            <div className="flex items-center justify-between px-1">
              <p className="font-ds-label-size font-semibold uppercase tracking-[0.08em] text-[var(--content-tertiary)]">
                {query.trim() ? 'Matches' : 'Salespeople'}
              </p>
              {filtered.length > 0 && (
                <p className="text-xs text-[var(--content-tertiary)]">{filtered.length} shown</p>
              )}
            </div>

            {isLoading ? (
              <div className="rounded-2xl border border-dashed border-[var(--border-opaque)] bg-[var(--bg-secondary)] p-5 text-center">
                <p className="text-sm text-[var(--content-tertiary)]">Loading salespeople…</p>
              </div>
            ) : filtered.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[var(--border-opaque)] bg-[var(--bg-secondary)] p-5 text-center">
                <p className="text-sm font-semibold text-[var(--content-primary)]">No matches</p>
                <p className="mt-1 text-sm text-[var(--content-tertiary)]">
                  Try a different name or check that the salesperson is active.
                </p>
              </div>
            ) : (
              filtered.map((user) => {
                const isSelected = selectedUserId === user.id;
                return (
                  <button
                    key={user.id}
                    type="button"
                    onClick={() => handleSelect(user)}
                    className={`w-full rounded-2xl border px-4 py-3 text-left transition-colors ${
                      isSelected
                        ? 'border-[color-mix(in_srgb,var(--bg-accent)_34%,var(--border-subtle))] bg-[color-mix(in_srgb,var(--bg-accent)_8%,white)]'
                        : 'border-[var(--border-subtle)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-ds-lead font-semibold text-[var(--content-primary)]">
                          {user.full_name}
                        </p>
                        {user.station_label && (
                          <p className="mt-1 truncate text-sm text-[var(--content-tertiary)]">
                            {user.station_label}
                          </p>
                        )}
                      </div>
                      {isSelected && (
                        <Check size={16} weight="bold" className="shrink-0 text-[var(--content-accent)]" />
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      </div>
    </BottomSheet>
  );
}
