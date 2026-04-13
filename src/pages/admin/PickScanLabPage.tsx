import { useCallback, useDeferredValue, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Camera,
  CaretLeft,
  CheckCircle,
  ClipboardText,
  Warning,
} from '@phosphor-icons/react';
import { useItems } from '../../hooks/useItems';
import { useToast } from '../../context/ToastContext';
import { BigButton, LiveQrScanner, SearchInput, Skeleton } from '../../components/shared';
import type { Item, ScanResult } from '../../types';
import { appHaptics } from '../../lib/haptics';
import { matchQrPayload, qrExpectedCodes } from '../../lib/scanner/qrMatch';
import { itemPickCode } from '../../utils/itemCodes';

type ScanLabRecord = Item & {
  pickCode: string;
};

function buildScanLabRecord(item: Item): ScanLabRecord | null {
  const pickCode = itemPickCode(item);
  if (!pickCode) return null;
  return { ...item, pickCode };
}

function matchesQuery(item: ScanLabRecord, query: string): boolean {
  if (!query) return true;
  const haystack = [
    item.name,
    item.pickCode,
    item.alias1,
    item.alias,
    item.rack_no,
    item.main_group,
    item.parent_group,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(query);
}

export default function PickScanLabPage(): React.JSX.Element {
  const navigate = useNavigate();
  const toast = useToast();
  const { data: items = [], isLoading, error, refetch, isFetching } = useItems();
  const [query, setQuery] = useState('');
  const [liveTarget, setLiveTarget] = useState<ScanLabRecord | null>(null);
  const [lastResult, setLastResult] = useState<{
    item: ScanLabRecord;
    result: ScanResult;
  } | null>(null);
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());

  const labelableItems = useMemo(
    () => items.map(buildScanLabRecord).filter((item): item is ScanLabRecord => item !== null),
    [items],
  );

  const filteredItems = useMemo(
    () =>
      labelableItems
        .filter((item) => matchesQuery(item, deferredQuery))
        .sort((a, b) => a.pickCode.localeCompare(b.pickCode, undefined, { numeric: true, sensitivity: 'base' }))
        .slice(0, 24),
    [deferredQuery, labelableItems],
  );

  const startScan = useCallback((item: ScanLabRecord) => {
    appHaptics.impactLight();
    setLiveTarget(item);
  }, []);

  const closeScan = useCallback(() => {
    setLiveTarget(null);
  }, []);

  const handleDetected = useCallback((rawValue: string) => {
    setLiveTarget((current) => {
      if (!current) return null;

      const match = matchQrPayload({
        rawValue,
        name: current.name,
        alias1: current.alias1,
        alias: current.alias,
        itemAlias: null,
      });

      const result: ScanResult = {
        scannedText: rawValue,
        confidence: match.confidence,
        isMatch: match.isMatch,
        matchedAgainst: match.matchedAgainst,
        matchStrategy: match.matchStrategy,
        ocrExtracted: {
          partNumber: match.extractedCode,
          mrp: current.mrp ?? null,
        },
        method: 'qr_scan',
        timestamp: new Date().toISOString(),
        extractedCode: match.extractedCode ?? undefined,
        extractedDescription: match.extractedDescription ?? undefined,
        reason: match.reason,
      };

      setLastResult({ item: current, result });
      if (result.isMatch) appHaptics.success();
      else appHaptics.warning();

      return null;
    });
  }, []);

  return (
    <div className="role-admin min-h-screen bg-[var(--bg-primary)]">
      <div className="mx-auto max-w-5xl p-4 lg:px-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/admin')}
            className="min-h-11 min-w-11 rounded-xl text-[var(--content-secondary)]"
          >
            <CaretLeft size={24} weight="bold" />
          </button>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-[var(--content-primary)]">Pick Scan Lab</h1>
            <p className="text-sm text-[var(--content-tertiary)]">
              Test the live QR scanner against Alias 1 and Alias without touching live orders.
            </p>
          </div>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <section className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--content-tertiary)]">
              How To Test
            </p>
            <div className="mt-3 space-y-3 text-sm text-[var(--content-secondary)]">
              <p>1. Print a label from Label Studio or use any QR that encodes the item&apos;s Alias 1 or Alias.</p>
              <p>2. Search the SKU below and tap `Test Scan`.</p>
              <p>3. Try normal light, then dim light with torch, then step back to test distance.</p>
              <p>4. A perfect scan should decode once and match instantly without OCR or network delay.</p>
            </div>
          </section>

          <section className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--content-tertiary)]">
              Latest Result
            </p>
            {lastResult ? (
              <div className="mt-3 space-y-3">
                <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-[var(--content-primary)]">
                        {lastResult.item.name}
                      </p>
                      <p className="mt-1 font-mono text-sm text-[var(--content-tertiary)]">
                        Expected: {lastResult.item.pickCode}
                      </p>
                    </div>
                    {lastResult.result.isMatch ? (
                      <CheckCircle size={22} weight="fill" className="text-[var(--content-positive)]" />
                    ) : (
                      <Warning size={22} weight="fill" className="text-[var(--content-warning)]" />
                    )}
                  </div>
                  <div className="mt-3 space-y-1 text-sm text-[var(--content-secondary)]">
                    <p>Read: <span className="font-mono">{lastResult.result.scannedText}</span></p>
                    <p>Reason: {lastResult.result.reason ?? 'No reason recorded'}</p>
                    <p>Confidence: {lastResult.result.confidence}%</p>
                    <p>Strategy: {lastResult.result.matchStrategy}</p>
                  </div>
                </div>
              </div>
            ) : (
              <p className="mt-3 text-sm text-[var(--content-tertiary)]">
                No scans yet. Run a test and the decoded payload will show up here.
              </p>
            )}
          </section>
        </div>

        <div className="mt-6">
          <SearchInput
            placeholder="Search by item name, alias, alias1, rack..."
            value={query}
            onChange={setQuery}
            loading={isFetching}
          />
        </div>

        {isLoading ? (
          <div className="mt-6 space-y-3">
            <Skeleton variant="card" count={6} />
          </div>
        ) : error ? (
          <div className="mt-6 rounded-3xl border border-[var(--border-negative)] bg-[var(--bg-negative-subtle)] p-5">
            <p className="font-semibold text-[var(--content-negative)]">Failed to load items</p>
            <BigButton
              variant="secondary"
              className="mt-4"
              onClick={() => void refetch()}
            >
              Retry
            </BigButton>
          </div>
        ) : (
          <div className="mt-6 grid gap-3">
            {filteredItems.length === 0 ? (
              <div className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-5 text-sm text-[var(--content-tertiary)]">
                No testable items found. Try a broader search or make sure the item has Alias 1 or Alias.
              </div>
            ) : (
              filteredItems.map((item) => (
                <article
                  key={item.id}
                  className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4"
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0">
                      <p className="font-semibold text-[var(--content-primary)]">{item.name}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {qrExpectedCodes({
                          alias1: item.alias1,
                          alias: item.alias,
                          itemAlias: null,
                        }).map((code) => (
                          <span
                            key={code}
                            className="rounded-full bg-[var(--bg-tertiary)] px-3 py-1 font-mono text-xs text-[var(--content-secondary)]"
                          >
                            {code}
                          </span>
                        ))}
                        {item.rack_no && (
                          <span className="rounded-full bg-[var(--bg-warning-subtle)] px-3 py-1 text-xs text-[var(--content-warning)]">
                            Rack {item.rack_no}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard
                            .writeText(item.pickCode)
                            .then(() => toast.success('Pick code copied'))
                            .catch(() => toast.error('Could not copy pick code'));
                        }}
                        className="flex h-11 items-center justify-center gap-2 rounded-2xl bg-[var(--bg-tertiary)] px-4 text-sm font-medium text-[var(--content-secondary)]"
                      >
                        <ClipboardText size={18} weight="regular" />
                        Copy Code
                      </button>
                      <button
                        type="button"
                        onClick={() => startScan(item)}
                        className="flex h-11 items-center justify-center gap-2 rounded-2xl bg-[var(--bg-positive)] px-4 text-sm font-semibold text-[var(--content-on-color)]"
                      >
                        <Camera size={18} weight="bold" />
                        Test Scan
                      </button>
                    </div>
                  </div>
                </article>
              ))
            )}
          </div>
        )}
      </div>

      {liveTarget && (
        <LiveQrScanner
          key={liveTarget.id}
          title={liveTarget.name}
          expectedCodes={qrExpectedCodes({
            alias1: liveTarget.alias1,
            alias: liveTarget.alias,
            itemAlias: null,
          })}
          onClose={closeScan}
          onDetected={handleDetected}
          onError={(message) => {
            toast.error(message);
            closeScan();
          }}
        />
      )}
    </div>
  );
}
