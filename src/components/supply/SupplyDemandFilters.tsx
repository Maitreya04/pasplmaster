import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  demandLocationFilterLabel,
  demandLocationFilterParam,
  parseDemandLocationFilter,
  type DemandLocationFilter,
} from '../../lib/purchase/openPoDemand';
import {
  addDays,
  cleanDateParam,
  collectDemandDateKeys,
  dateKeyFromDate,
  monthStart,
} from '../../lib/purchase/supplyDemandFilters';
import { formatDateRangeLabel, formatShortDate, countLabel } from './supplyDemandShared';

export function useSupplyDemandUrlFilters() {
  const [searchParams, setSearchParams] = useSearchParams();
  const legacyDate = cleanDateParam(searchParams.get('date'));
  const selectedDateFrom = cleanDateParam(searchParams.get('from')) || legacyDate;
  const selectedDateTo = cleanDateParam(searchParams.get('to')) || legacyDate;
  const locationFilter = parseDemandLocationFilter(searchParams.get('warehouse'));
  const activeRangeLabel = formatDateRangeLabel(selectedDateFrom, selectedDateTo);
  const activeLocationLabel = demandLocationFilterLabel(locationFilter);
  const hasDateRange = Boolean(selectedDateFrom || selectedDateTo);
  const todayKey = dateKeyFromDate(new Date());
  const [draftDateFrom, setDraftDateFrom] = useState(selectedDateFrom);
  const [draftDateTo, setDraftDateTo] = useState(selectedDateTo);
  const dateRangeInvalid = Boolean(draftDateFrom && draftDateTo && draftDateFrom > draftDateTo);

  useEffect(() => {
    setDraftDateFrom(selectedDateFrom);
    setDraftDateTo(selectedDateTo);
  }, [selectedDateFrom, selectedDateTo]);

  const applyDateRange = (from: string, to: string) => {
    if (from && to && from > to) return;
    const next = new URLSearchParams(searchParams);
    next.delete('date');
    if (from) next.set('from', from);
    else next.delete('from');
    if (to) next.set('to', to);
    else next.delete('to');
    setSearchParams(next, { replace: true });
  };

  const clearDateRange = () => {
    setDraftDateFrom('');
    setDraftDateTo('');
    applyDateRange('', '');
  };

  const applyPresetRange = (from: string, to: string) => {
    setDraftDateFrom(from);
    setDraftDateTo(to);
    applyDateRange(from, to);
  };

  const applyLocationFilter = (filter: DemandLocationFilter) => {
    const next = new URLSearchParams(searchParams);
    const param = demandLocationFilterParam(filter);
    if (param) next.set('warehouse', param);
    else next.delete('warehouse');
    setSearchParams(next, { replace: true });
  };

  return {
    searchParams,
    setSearchParams,
    selectedDateFrom,
    selectedDateTo,
    locationFilter,
    activeRangeLabel,
    activeLocationLabel,
    hasDateRange,
    todayKey,
    draftDateFrom,
    draftDateTo,
    setDraftDateFrom,
    setDraftDateTo,
    dateRangeInvalid,
    applyDateRange,
    clearDateRange,
    applyPresetRange,
    applyLocationFilter,
    collectDemandDateKeys,
    addDays,
    monthStart,
    formatShortDate,
  };
}

export function SupplyDemandDateFilter({
  draftDateFrom,
  draftDateTo,
  setDraftDateFrom,
  setDraftDateTo,
  selectedDateFrom,
  selectedDateTo,
  hasDateRange,
  activeRangeLabel,
  dateRangeInvalid,
  todayKey,
  demandDates,
  applyDateRange,
  clearDateRange,
  applyPresetRange,
  formatShortDate,
  addDays,
  monthStart,
}: {
  draftDateFrom: string;
  draftDateTo: string;
  setDraftDateFrom: (v: string) => void;
  setDraftDateTo: (v: string) => void;
  selectedDateFrom: string;
  selectedDateTo: string;
  hasDateRange: boolean;
  activeRangeLabel: string;
  dateRangeInvalid: boolean;
  todayKey: string;
  demandDates: string[];
  applyDateRange: (from: string, to: string) => void;
  clearDateRange: () => void;
  applyPresetRange: (from: string, to: string) => void;
  formatShortDate: (value: string) => string;
  addDays: (dateKey: string, days: number) => string;
  monthStart: (dateKey: string) => string;
}) {
  return (
    <section className="mt-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-sm font-semibold text-[var(--content-primary)]">Order date range</p>
            <p className="mt-1 text-sm text-[var(--content-tertiary)]">
              Filter pending demand by when orders were created.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${
                hasDateRange
                  ? 'border-[var(--bg-accent)] bg-[var(--bg-accent-subtle)] text-[var(--content-accent)]'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-primary)] text-[var(--content-secondary)]'
              }`}
            >
              {activeRangeLabel}
            </span>
            {hasDateRange && (
              <button
                type="button"
                onClick={clearDateRange}
                className="inline-flex h-8 items-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 text-xs font-semibold text-[var(--content-secondary)] hover:bg-[var(--bg-tertiary)]"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-[var(--content-tertiary)]">
                From
              </span>
              <input
                type="date"
                value={draftDateFrom}
                onChange={(event) => setDraftDateFrom(event.target.value)}
                className="h-11 w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 text-sm text-[var(--content-primary)]"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-[var(--content-tertiary)]">
                To
              </span>
              <input
                type="date"
                value={draftDateTo}
                onChange={(event) => setDraftDateTo(event.target.value)}
                className="h-11 w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 text-sm text-[var(--content-primary)]"
              />
            </label>
          </div>
          <button
            type="button"
            onClick={() => applyDateRange(draftDateFrom, draftDateTo)}
            disabled={dateRangeInvalid}
            className="inline-flex h-11 items-center justify-center rounded-xl border border-[var(--bg-accent)] bg-[var(--bg-accent-subtle)] px-4 text-sm font-semibold text-[var(--content-accent)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
          >
            Apply
          </button>
        </div>

        {dateRangeInvalid && (
          <p className="text-sm text-[var(--content-negative)]">Start date must be before end date.</p>
        )}

        <div className="flex flex-wrap gap-2">
          {(
            [
              ['Today', todayKey, todayKey],
              ['Yesterday', addDays(todayKey, -1), addDays(todayKey, -1)],
              ['Last 7 days', addDays(todayKey, -6), todayKey],
              ['This month', monthStart(todayKey), todayKey],
            ] as const
          ).map(([label, from, to]) => {
            const active = selectedDateFrom === from && selectedDateTo === to;
            return (
              <button
                key={label}
                type="button"
                onClick={() => applyPresetRange(from, to)}
                className={`inline-flex items-center rounded-full border px-3 py-1 text-sm font-medium transition-colors ${
                  active
                    ? 'border-[var(--bg-accent)] bg-[var(--bg-accent-subtle)] text-[var(--content-accent)]'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-primary)] text-[var(--content-secondary)] hover:bg-[var(--bg-tertiary)]'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        {demandDates.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--content-tertiary)]">Recent order dates</p>
            <div className="flex flex-wrap gap-2">
              {demandDates.slice(0, 7).map((dateKey) => {
                const active = selectedDateFrom === dateKey && selectedDateTo === dateKey;
                return (
                  <button
                    key={dateKey}
                    type="button"
                    onClick={() => applyPresetRange(dateKey, dateKey)}
                    className={`inline-flex items-center rounded-full border px-3 py-1 text-sm font-medium transition-colors ${
                      active
                        ? 'border-[var(--bg-accent)] bg-[var(--bg-accent-subtle)] text-[var(--content-accent)]'
                        : 'border-[var(--border-subtle)] bg-[var(--bg-primary)] text-[var(--content-secondary)] hover:bg-[var(--bg-tertiary)]'
                    }`}
                  >
                    {formatShortDate(dateKey)}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

export function SupplyDemandWarehouseFilter({
  locationFilter,
  activeLocationLabel,
  applyLocationFilter,
}: {
  locationFilter: DemandLocationFilter;
  activeLocationLabel: string;
  applyLocationFilter: (filter: DemandLocationFilter) => void;
}) {
  return (
    <section className="mt-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-[var(--content-primary)]">Warehouse</p>
          <p className="mt-1 text-sm text-[var(--content-tertiary)]">
            Split pending demand by Indore (main store) vs Jabalpur stock location.
          </p>
        </div>
        <span
          className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${
            locationFilter !== 'all'
              ? 'border-[var(--bg-accent)] bg-[var(--bg-accent-subtle)] text-[var(--content-accent)]'
              : 'border-[var(--border-subtle)] bg-[var(--bg-primary)] text-[var(--content-secondary)]'
          }`}
        >
          {activeLocationLabel}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {(
          [
            ['all', 'All locations'],
            ['main_store', 'Indore'],
            ['jabalpur', 'Jabalpur'],
          ] as const
        ).map(([id, label]) => {
          const active = locationFilter === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => applyLocationFilter(id)}
              className={`inline-flex items-center rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                active
                  ? 'border-[var(--bg-accent)] bg-[var(--bg-accent-subtle)] text-[var(--content-accent)]'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-primary)] text-[var(--content-secondary)] hover:bg-[var(--bg-tertiary)]'
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function SupplyDemandAgeLegend() {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 font-ds-micro text-[var(--content-quaternary)]">
      <span>Age:</span>
      <span className="inline-flex items-center gap-1 rounded-md border border-[color-mix(in_srgb,var(--content-positive)_20%,transparent)] bg-[var(--bg-positive-subtle)] px-1.5 py-0.5 font-bold text-[var(--content-positive)]">
        &lt;7d fresh
      </span>
      <span className="inline-flex items-center gap-1 rounded-md border border-[color-mix(in_srgb,var(--content-warning)_20%,transparent)] bg-[var(--bg-warning-subtle)] px-1.5 py-0.5 font-bold text-[var(--content-warning)]">
        7-14d warm
      </span>
      <span className="inline-flex items-center gap-1 rounded-md border border-[color-mix(in_srgb,var(--content-negative)_20%,transparent)] bg-[var(--bg-negative-subtle)] px-1.5 py-0.5 font-bold text-[var(--content-negative)]">
        14d+ stale
      </span>
    </div>
  );
}

export function SupplyDemandSummaryStrip({
  activeRangeLabel,
  locationFilter,
  activeLocationLabel,
  skuCount,
  brandCount,
  orderCount,
  showBrandCount = true,
}: {
  activeRangeLabel: string;
  locationFilter: DemandLocationFilter;
  activeLocationLabel: string;
  skuCount: number;
  brandCount: number;
  orderCount: number;
  showBrandCount?: boolean;
}) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--content-secondary)]">
      <span className="font-semibold text-[var(--content-primary)]">{activeRangeLabel}</span>
      {locationFilter !== 'all' && (
        <span className="rounded-full bg-[var(--bg-primary)] px-2 py-0.5 text-xs font-semibold text-[var(--content-accent)]">
          {activeLocationLabel}
        </span>
      )}
      <span>{countLabel(skuCount, 'item')}</span>
      {showBrandCount && <span>{countLabel(brandCount, 'brand')}</span>}
      <span>{countLabel(orderCount, 'order')}</span>
    </div>
  );
}
