import { useCallback, useMemo, useState } from 'react';
import { CheckCircle, MagnifyingGlass } from '@phosphor-icons/react';
import { useTransports } from '../../hooks/useTransports';
import type { Transport } from '../../types';
import { BottomSheet } from './BottomSheet';
import { SelectTrigger } from './SelectTrigger';

interface SearchableTransportDropdownProps {
  value: Transport | null;
  onChange: (transport: Transport | null) => void;
  placeholder?: string;
}

function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function filterTransports(transports: Transport[], query: string, limit = 30): Transport[] {
  const q = normalizeSearchText(query);
  if (!q) return transports.slice(0, limit);

  return transports
    .map((transport) => {
      const name = transport.name.toLowerCase();
      const gstin = transport.gstin?.toLowerCase() ?? '';
      let score = Number.POSITIVE_INFINITY;
      if (name === q) score = 0;
      else if (name.startsWith(q)) score = 1;
      else if (name.split(/\s+/).some((part) => part.startsWith(q))) score = 2;
      else if (gstin.startsWith(q)) score = 3;
      else if (name.includes(q)) score = 4;
      else if (gstin.includes(q)) score = 5;
      return { transport, score };
    })
    .filter((entry) => Number.isFinite(entry.score))
    .sort((a, b) => a.score - b.score || a.transport.name.localeCompare(b.transport.name))
    .slice(0, limit)
    .map((entry) => entry.transport);
}

export function SearchableTransportDropdown({
  value,
  onChange,
  placeholder = 'Select Transport',
}: SearchableTransportDropdownProps): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const { data: transports = [], isLoading } = useTransports();

  const openSheet = useCallback(() => {
    setOpen(true);
    setQuery('');
  }, []);

  const closeSheet = useCallback(() => {
    setOpen(false);
    setQuery('');
  }, []);

  const filtered = useMemo(
    () => filterTransports(transports, query),
    [transports, query],
  );

  return (
    <div className="space-y-2.5">
      <SelectTrigger
        onClick={openSheet}
        open={open}
        placeholder={placeholder}
        hasValue={!!value}
      >
        {value && (
          <>
            <span className="block truncate">{value.name}</span>
            {value.gstin && (
              <span className="mt-0.5 block truncate text-sm font-normal text-[var(--content-tertiary)]">
                {value.gstin}
              </span>
            )}
          </>
        )}
      </SelectTrigger>

      {open && (
        <BottomSheet
          isOpen={open}
          onClose={closeSheet}
          title="Transport"
          sheetClassName="h-[62vh] max-h-[62vh]"
          contentClassName="!px-0 !pb-0"
          keyboardBehavior="static"
        >
          <div className="flex h-full min-h-0 flex-col">
            <div className="shrink-0 space-y-4 px-5 pb-4">
              <div className="relative">
                <MagnifyingGlass
                  size={18}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--content-tertiary)]"
                />
                <input
                  type="text"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search by transport name or GSTIN…"
                  autoFocus
                  className="w-full min-h-14 rounded-2xl border border-[var(--border-opaque)] bg-[var(--bg-secondary)] pl-10 pr-4 text-base text-[var(--content-primary)] placeholder:text-[var(--content-quaternary)] outline-none focus:ring-1 focus:ring-[var(--border-opaque)]"
                />
              </div>

              {value && (
                <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-ds-label-size font-semibold uppercase tracking-[0.08em] text-[var(--content-tertiary)]">
                        Selected
                      </p>
                      <p className="mt-1 font-ds-lead font-semibold text-[var(--content-primary)]">
                        {value.name}
                      </p>
                      {value.gstin && (
                        <p className="mt-1 text-sm text-[var(--content-tertiary)]">
                          {value.gstin}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => onChange(null)}
                      className="shrink-0 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-1.5 text-xs font-semibold text-[var(--content-secondary)] hover:bg-[var(--bg-tertiary)]"
                    >
                      Clear
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
              <div className="space-y-2">
                <div className="flex items-center justify-between px-1">
                  <p className="font-ds-label-size font-semibold uppercase tracking-[0.08em] text-[var(--content-tertiary)]">
                    {query.trim() ? 'Matches' : 'Transports'}
                  </p>
                  {!isLoading && filtered.length > 0 && (
                    <p className="text-xs text-[var(--content-tertiary)]">
                      {filtered.length} shown
                    </p>
                  )}
                </div>

                {isLoading ? (
                  <p className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4 text-sm text-[var(--content-tertiary)]">
                    Loading transports…
                  </p>
                ) : filtered.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-[var(--border-opaque)] bg-[var(--bg-secondary)] p-5 text-center">
                    <p className="text-sm font-semibold text-[var(--content-primary)]">
                      No transports found
                    </p>
                    <p className="mt-1 text-sm text-[var(--content-tertiary)]">
                      Try a different name or GSTIN.
                    </p>
                  </div>
                ) : (
                  filtered.map((transport) => (
                    <button
                      key={transport.id}
                      type="button"
                      onClick={() => {
                        onChange(transport);
                        closeSheet();
                      }}
                      className={`w-full rounded-2xl border px-4 py-3 text-left transition-colors ${
                        value?.id === transport.id
                          ? 'border-[color-mix(in_srgb,var(--bg-accent)_34%,var(--border-subtle))] bg-[color-mix(in_srgb,var(--bg-accent)_8%,white)]'
                          : 'border-[var(--border-subtle)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)]'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-ds-lead font-semibold text-[var(--content-primary)]">
                            {transport.name}
                          </p>
                          {transport.gstin && (
                            <p className="mt-1 line-clamp-1 text-sm text-[var(--content-tertiary)]">
                              {transport.gstin}
                            </p>
                          )}
                        </div>
                        {value?.id === transport.id && (
                          <CheckCircle size={20} weight="fill" className="shrink-0 text-[var(--content-accent)]" />
                        )}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        </BottomSheet>
      )}
    </div>
  );
}
