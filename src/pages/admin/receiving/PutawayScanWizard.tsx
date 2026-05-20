import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import QRCode from 'qrcode';
import { Camera } from '@phosphor-icons/react';
import { BigButton, LiveQrScanner } from '../../../components/shared';
import type { LiveQrScannerResolved } from '../../../components/shared/LiveQrScanner';
import { useToast } from '../../../context/ToastContext';
import {
  receivingApplyInnerBreak,
  receivingApplyInnerOverflow,
  receivingPutawayInnerWhole,
  receivingPutawayToBinBulk,
  receivingPutawayToBinEachScan,
  receivingResolveLpScan,
  receivingTryRollUpPoForJobLine,
} from '../../../lib/receiving/receivingApi';
import { formatPackDefinitionHint } from '../../../lib/labelStudio/computeLabelPlan';
import { parseReceivingBinScan } from '../../../lib/receiving/receivingPrintUtils';
import { defaultPutawayBinId } from '../../../lib/wms/stagingBin';
import type { ItemPackDefinition } from '../../../types';
import type { ReceivingLpCandidate } from '../../../lib/receiving/receivingApi';
import type { Item } from '../../../types';
import type { ReceivingJobLineRow } from '../../../types/receiving';
import { itemPickCode } from '../../../utils/itemCodes';
import type { LicensePlate } from '../../../types';

type ScanSession = 'lp' | 'overflow' | 'bin_whole' | 'bin_putaway' | 'item_each' | null;

type ResolvePayload = {
  lp: LicensePlate & { id: number };
  allowed: string[];
  putawayRemaining: number | null;
};

export function PutawayScanWizard({
  line,
  jobId,
  items,
  packDef,
  userId,
  userName,
  onChange,
}: {
  line: ReceivingJobLineRow;
  jobId: number;
  items: Item[];
  packDef?: ItemPackDefinition;
  userId: number | null;
  userName: string | null;
  onChange: () => void;
}): ReactElement {
  const toast = useToast();
  const [session, setSession] = useState<ScanSession>(null);
  const [resolved, setResolved] = useState<ResolvePayload | null>(null);
  const [disposition, setDisposition] = useState<'overflow' | 'whole' | 'break' | null>(null);
  const [overflowBin, setOverflowBin] = useState('OVF-A1');
  const [lpCandidates, setLpCandidates] = useState<ReceivingLpCandidate[] | null>(null);
  const [bulkQty, setBulkQty] = useState('1');
  const [highValueScan, setHighValueScan] = useState(false);
  const [binConfirmed, setBinConfirmed] = useState<string | null>(null);
  const [eachPreviewQty, setEachPreviewQty] = useState(String(line.ea_per_inner || 1));
  const [qrSvg, setQrSvg] = useState<string | null>(null);

  const item = useMemo(
    () => items.find((i) => Number(i.busy_code) === Number(line.busy_code)),
    [items, line.busy_code],
  );
  const pickCode = item ? itemPickCode(item) : String(line.busy_code);
  const defaultStockBin = defaultPutawayBinId(item?.rack_no ?? null);

  useEffect(() => {
    let cancelled = false;
    void QRCode.toString(pickCode, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }).then((svg) => {
      if (!cancelled) setQrSvg(svg);
    });
    return () => {
      cancelled = true;
    };
  }, [pickCode]);

  const mrpOk = line.mrp_per_ea != null && Number(line.mrp_per_ea) > 0;
  const catalogPackHint = formatPackDefinitionHint({
    innerPackQty: packDef?.inner_pack_qty ?? line.ea_per_inner ?? null,
    outerPackQty: packDef?.outer_pack_qty ?? null,
  });

  const resetFlow = useCallback(() => {
    setResolved(null);
    setDisposition(null);
    setBinConfirmed(null);
    setSession(null);
    setHighValueScan(false);
    setLpCandidates(null);
  }, []);

  const handleLpResolved = useCallback(
    async (scan: LiveQrScannerResolved) => {
      try {
        const data = await receivingResolveLpScan(scan.rawValue, line.id);
        if (!data.success) {
          if (data.reason === 'pick_inner_lp' && Array.isArray(data.candidates)) {
            setLpCandidates(data.candidates as ReceivingLpCandidate[]);
            toast.info('Multiple inners — tap the carton you are holding.');
            return;
          }
          toast.error(data.reason ?? 'Could not resolve scan');
          return;
        }
        setLpCandidates(null);
        const lpRaw = data.license_plate as Record<string, unknown> | undefined;
        if (!lpRaw || typeof lpRaw.id !== 'number') {
          toast.error('Invalid license plate payload');
          return;
        }
        const lp = lpRaw as unknown as LicensePlate & { id: number };
        const rawAllowed = data.allowed_dispositions;
        const allowed = Array.isArray(rawAllowed)
          ? rawAllowed.filter((x): x is string => typeof x === 'string')
          : [];
        const rem =
          typeof lp.receiving_putaway_ea_remaining === 'number'
            ? lp.receiving_putaway_ea_remaining
            : data.putaway_ea_remaining != null
              ? Number(data.putaway_ea_remaining)
              : null;
        setResolved({
          lp: lp as LicensePlate & { id: number },
          allowed,
          putawayRemaining: Number.isFinite(rem) ? rem : null,
        });
        setDisposition(null);
        setBinConfirmed(null);
        setSession(null);
        toast.success('Inner LPN linked');
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Resolve failed';
        if (msg.includes('mrp_per_ea_required')) {
          toast.error('Enter MRP/ea in Verification before putaway.');
        } else {
          toast.error(msg);
        }
      }
    },
    [toast],
  );

  const runOverflow = async (binScanRaw?: string) => {
    if (!resolved || !mrpOk) return;
    const bin = (binScanRaw ?? overflowBin).trim().toUpperCase();
    if (!bin.startsWith('OVF-')) {
      toast.error('Overflow location must start with OVF-');
      return;
    }
    const r = await receivingApplyInnerOverflow(
      resolved.lp.id,
      bin,
      jobId,
      line.id,
      userId,
      userName,
    );
    if (!r.success) toast.error(r.reason ?? 'Overflow failed');
    else {
      toast.success('Overflow recorded');
      onChange();
      resetFlow();
    }
  };

  const applyWhole = async (raw: string) => {
    if (!resolved || !mrpOk) return;
    const parsed = parseReceivingBinScan(raw);
    if (!parsed.binId || parsed.binId.startsWith('OVF')) {
      toast.error('Scan a stock BIN (not overflow).');
      return;
    }
    if (parsed.skuBusyCode != null && Number(parsed.skuBusyCode) !== Number(line.busy_code)) {
      toast.error('BIN label SKU does not match this line.');
      return;
    }
    const r = await receivingPutawayInnerWhole(
      resolved.lp.id,
      parsed.binId,
      jobId,
      line.id,
      userId,
      userName,
    );
    if (!r.success) {
      if (String(r.reason).includes('mrp')) toast.error('Enter MRP/ea in Verification first.');
      else toast.error(r.reason ?? 'Putaway failed');
      return;
    }
    toast.success(`Whole inner put away (${r.qty_ea ?? ''} ea)`);
    try {
      await receivingTryRollUpPoForJobLine(line.id);
    } catch {
      /* optional */
    }
    onChange();
    resetFlow();
  };

  const runBreak = async () => {
    if (!resolved || !mrpOk) return;
    try {
      const r = await receivingApplyInnerBreak(resolved.lp.id, jobId, line.id, userId, userName);
      if (!r.success) {
        toast.error(r.reason ?? 'Break failed');
        return;
      }
      if (typeof r.each_label_batch_ea === 'number') setEachPreviewQty(String(r.each_label_batch_ea));
      setDisposition('break');
      setResolved((prev) =>
        prev
          ? {
              ...prev,
              lp: {
                ...prev.lp,
                receiving_lp_state: 'broken',
                receiving_putaway_ea_remaining: prev.lp.pack_qty,
              },
              putawayRemaining: prev.lp.pack_qty,
            }
          : prev,
      );
      toast.success('Inner marked broken — print each labels if needed, then put away');
      onChange();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Break failed';
      if (msg.includes('mrp_per_ea_required')) toast.error('Enter MRP/ea in Verification before putaway.');
      else toast.error(msg);
    }
  };

  const confirmBinForPutaway = (raw: string) => {
    const parsed = parseReceivingBinScan(raw);
    if (!parsed.binId || parsed.binId.startsWith('OVF')) {
      toast.error('Scan a stock BIN.');
      return;
    }
    if (parsed.skuBusyCode != null && Number(parsed.skuBusyCode) !== Number(line.busy_code)) {
      toast.error('BIN label SKU does not match this line.');
      return;
    }
    setBinConfirmed(parsed.binId);
    setSession(null);
    toast.success(`BIN ${parsed.binId} — confirm qty or scan each item`);
  };

  const runBulkPutaway = async () => {
    if (!resolved || !mrpOk || !binConfirmed) return;
    const n = Math.floor(Number(bulkQty) || 0);
    if (n <= 0) {
      toast.error('Enter a positive qty');
      return;
    }
    try {
      const r = await receivingPutawayToBinBulk(
        resolved.lp.id,
        binConfirmed,
        n,
        jobId,
        line.id,
        userId,
        userName,
      );
      if (!r.success) {
        if (String(r.reason).includes('mrp')) toast.error('Enter MRP/ea in Verification first.');
        else toast.error(r.reason ?? 'Bulk putaway failed');
        return;
      }
      toast.success(`Put away ${n} ea`);
      setBulkQty('1');
      const rem = r.putaway_ea_remaining;
      if (rem != null && rem > 0) {
        setResolved((prev) => (prev ? { ...prev, putawayRemaining: rem } : prev));
      } else {
        try {
          await receivingTryRollUpPoForJobLine(line.id);
        } catch {
          /* optional */
        }
        onChange();
        resetFlow();
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Putaway failed';
      toast.error(msg);
    }
  };

  const handleEachItemScan = async (scan: LiveQrScannerResolved) => {
    if (!resolved || !mrpOk || !binConfirmed) return;
    try {
      const r = await receivingPutawayToBinEachScan(
        resolved.lp.id,
        binConfirmed,
        scan.rawValue,
        jobId,
        line.id,
        userId,
        userName,
      );
      if (!r.success) {
        toast.error(r.reason ?? 'Scan did not count');
        return;
      }
      const rem = r.putaway_ea_remaining;
      toast.success(rem != null && rem > 0 ? `${rem} ea left` : 'Putaway complete');
      if (rem != null && rem > 0) {
        setResolved((prev) => (prev ? { ...prev, putawayRemaining: rem } : prev));
      } else {
        try {
          await receivingTryRollUpPoForJobLine(line.id);
        } catch {
          /* optional */
        }
        onChange();
        resetFlow();
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Scan-each failed');
    }
  };

  const printEachSheet = () => {
    const n = Math.max(1, Math.min(80, Math.floor(Number(eachPreviewQty) || 1)));
    const w = window.open('', '_blank');
    if (!w) return;
    const cards = Array.from({ length: n })
      .map(
        () =>
          `<div style="display:inline-block;border:1px solid #333;padding:8px;margin:6px;width:120px;vertical-align:top">
          <div style="font:600 11px sans-serif">EACH · ${line.lot_no}</div>
          <div style="font:800 12px monospace;margin-top:4px">${pickCode}</div>
          <div style="font:11px sans-serif;margin-top:4px">${line.sku_description_snapshot.slice(0, 80)}</div>
          ${qrSvg ? `<div style="margin-top:6px">${qrSvg}</div>` : ''}
        </div>`,
      )
      .join('');
    w.document.write(
      `<!DOCTYPE html><html><head><title>Each labels</title></head><body>${cards}<script>window.onload=function(){window.print()}</script></body></html>`,
    );
    w.document.close();
  };

  if (line.receive_mode === 'loose') {
    return (
      <div className="mb-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-3 text-sm text-[var(--content-secondary)]">
        Loose line — no pack putaway wizard.
      </div>
    );
  }

  return (
    <div className="mb-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-4">
      <p className="font-mono text-sm font-semibold">
        {line.busy_code} · {line.lot_no}
      </p>
      {!mrpOk ? (
        <p className="mt-2 text-sm text-[var(--content-warning)]">
          Set <strong>MRP/ea</strong> in Verification before putaway.{' '}
          <a href={`?step=mrp`} className="underline font-semibold">
            Go to MRP
          </a>
        </p>
      ) : (
        <p className="mt-1 text-xs text-[var(--content-tertiary)]">
          MRP ₹{Number(line.mrp_per_ea).toFixed(2)}/ea · Lot {line.lot_no}
        </p>
      )}

      {lpCandidates != null && lpCandidates.length > 0 ? (
        <div className="mt-3 space-y-2">
          <p className="text-xs font-semibold text-[var(--content-secondary)]">
            Multiple open inners — tap the carton you are holding:
          </p>
          {lpCandidates.map((c) => (
            <BigButton
              key={c.id}
              type="button"
              variant="secondary"
              className="w-full min-h-10 font-mono text-xs"
              onClick={() => {
                void (async () => {
                  const data = await receivingResolveLpScan(c.lpn_code, line.id);
                  if (!data.success || !data.license_plate) {
                    toast.error(data.reason ?? 'Could not resolve');
                    return;
                  }
                  const lpRaw = data.license_plate as Record<string, unknown>;
                  if (typeof lpRaw.id !== 'number') return;
                  const lp = lpRaw as unknown as LicensePlate & { id: number };
                  const rawAllowed = data.allowed_dispositions;
                  const allowed = Array.isArray(rawAllowed)
                    ? rawAllowed.filter((x): x is string => typeof x === 'string')
                    : [];
                  const rem =
                    typeof lp.receiving_putaway_ea_remaining === 'number'
                      ? lp.receiving_putaway_ea_remaining
                      : data.putaway_ea_remaining != null
                        ? Number(data.putaway_ea_remaining)
                        : null;
                  setResolved({
                    lp,
                    allowed,
                    putawayRemaining: Number.isFinite(rem) ? rem : null,
                  });
                  setLpCandidates(null);
                  toast.success(`Linked ${c.lpn_code}`);
                })();
              }}
            >
              {c.lpn_code}
              {c.receiving_pack_seq != null ? ` · #${c.receiving_pack_seq}` : ''} · {c.pack_qty} ea
            </BigButton>
          ))}
        </div>
      ) : null}

      {!resolved ? (
        <BigButton
          type="button"
          variant="secondary"
          className="mt-3 w-full min-h-11"
          disabled={!mrpOk}
          onClick={() => setSession('lp')}
        >
          <Camera size={20} weight="bold" />
          Scan inner carton (Pack or LPN QR)
        </BigButton>
      ) : (
        <div className="mt-3 space-y-3">
          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 text-xs font-mono">
            <p>{resolved.lp.lpn_code}</p>
            <p className="text-[var(--content-tertiary)] mt-1">
              state: {resolved.lp.receiving_lp_state ?? '—'} · pack {resolved.lp.pack_qty} ea
              {resolved.putawayRemaining != null ? ` · putaway left ${resolved.putawayRemaining}` : ''}
            </p>
          </div>

          {disposition == null && resolved.lp.receiving_lp_state !== 'broken' ? (
            resolved.allowed.includes('note_outer_lp') ? (
              <div className="space-y-2">
                {catalogPackHint ? (
                  <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-medium text-sky-950 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-100">
                    {catalogPackHint}
                  </p>
                ) : null}
                <p className="text-xs text-[var(--content-tertiary)]">
                  Scanned an <strong>outer</strong> label — putaway uses <strong>inner</strong> or <strong>piece</strong>{' '}
                  stickers. Scan an inner LPN or PASPL-PACK inner QR instead.
                </p>
              </div>
            ) : (
            <div className="grid gap-2 sm:grid-cols-3">
              {resolved.allowed.includes('overflow') && (
                <BigButton type="button" variant="secondary" onClick={() => setDisposition('overflow')}>
                  Overflow
                </BigButton>
              )}
              {resolved.allowed.includes('whole') && (
                <BigButton type="button" variant="secondary" onClick={() => setDisposition('whole')}>
                  Whole to BIN
                </BigButton>
              )}
              {resolved.allowed.includes('break') && (
                <BigButton type="button" variant="secondary" onClick={() => setDisposition('break')}>
                  Break open
                </BigButton>
              )}
            </div>
            )
          ) : null}

          {disposition === 'overflow' && (
            <div className="space-y-2">
              <label className="text-xs font-semibold block">
                Overflow BIN
                <input
                  value={overflowBin}
                  onChange={(e) => setOverflowBin(e.target.value.toUpperCase())}
                  className="mt-1 min-h-10 w-full rounded-lg border border-[var(--border-subtle)] px-2 font-mono"
                />
              </label>
              <div className="flex gap-2">
                <BigButton type="button" variant="secondary" className="flex-1" onClick={() => void runOverflow()}>
                  Confirm overflow
                </BigButton>
                <BigButton type="button" variant="primary" className="flex-1" onClick={() => setSession('overflow')}>
                  Scan OVF QR
                </BigButton>
              </div>
            </div>
          )}

          {disposition === 'whole' && (
            <div className="space-y-1">
              <p className="text-xs text-[var(--content-tertiary)]">
                Default destination: <span className="font-mono font-semibold">{defaultStockBin}</span>
              </p>
              <BigButton type="button" variant="primary" className="w-full" onClick={() => setSession('bin_whole')}>
                Scan BIN / rack label
              </BigButton>
            </div>
          )}

          {disposition === 'break' && resolved.lp.receiving_lp_state !== 'broken' && (
            <BigButton
              type="button"
              variant="primary"
              className="w-full bg-[var(--bg-accent)] text-[var(--content-on-color)]"
              disabled={!mrpOk}
              onClick={() => void runBreak()}
            >
              Confirm break (open inner)
            </BigButton>
          )}

          {resolved.lp.receiving_lp_state === 'broken' && (
              <div className="rounded-xl border border-dashed border-[var(--border-subtle)] p-3 space-y-3">
                {line.sell_unit_snapshot !== 'PACK' && (
                  <>
                    <p className="text-xs font-bold uppercase text-[var(--content-accent)]">Each labels</p>
                    <label className="text-xs font-semibold block">
                      Stickers per sheet (max 80)
                      <input
                        value={eachPreviewQty}
                        onChange={(e) => setEachPreviewQty(e.target.value)}
                        className="mt-1 min-h-10 w-24 rounded-lg border border-[var(--border-subtle)] px-2 font-mono"
                      />
                    </label>
                    <BigButton type="button" variant="secondary" className="min-h-10" onClick={printEachSheet}>
                      Print each sheet
                    </BigButton>
                  </>
                )}
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={highValueScan}
                    onChange={(e) => setHighValueScan(e.target.checked)}
                    className="h-4 w-4 accent-[var(--role-primary)]"
                  />
                  High-value scan-each mode
                </label>
                {!binConfirmed ? (
                  <BigButton type="button" variant="primary" className="w-full" onClick={() => setSession('bin_putaway')}>
                    Scan BIN to start putaway
                  </BigButton>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs font-mono text-[var(--content-secondary)]">BIN {binConfirmed}</p>
                    {highValueScan ? (
                      <BigButton type="button" variant="primary" className="w-full" onClick={() => setSession('item_each')}>
                        Scan item QR (+1 ea)
                      </BigButton>
                    ) : (
                      <>
                        <label className="text-xs font-semibold block">
                          Eaches to put away (bulk)
                          <input
                            value={bulkQty}
                            onChange={(e) => setBulkQty(e.target.value.replace(/[^\d]/g, ''))}
                            className="mt-1 min-h-10 w-full rounded-lg border border-[var(--border-subtle)] px-2 font-mono"
                            inputMode="numeric"
                          />
                        </label>
                        <BigButton
                          type="button"
                          variant="primary"
                          className="w-full"
                          disabled={!mrpOk}
                          onClick={() => void runBulkPutaway()}
                        >
                          Confirm bulk putaway
                        </BigButton>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

          <BigButton type="button" variant="secondary" className="w-full min-h-10" onClick={resetFlow}>
            Scan different LPN
          </BigButton>
        </div>
      )}

      {session === 'lp' && (
        <LiveQrScanner
          title="Scan inner LPN"
          helpText="Aim at the inner carton QR code"
          pickItem={{
            itemId: -1,
            name: 'Receiving LPN',
            busyCode: null,
          }}
          onClose={() => setSession(null)}
          onResolved={(r) => {
            void handleLpResolved(r);
            setSession(null);
          }}
          onError={(m) => toast.error(m)}
        />
      )}
      {session === 'overflow' && (
        <LiveQrScanner
          title="Scan overflow location"
          helpText="OVF-* BIN license plate"
          pickItem={{ itemId: -1, name: 'Overflow', busyCode: null }}
          onClose={() => setSession(null)}
          onResolved={(r) => {
            const o = parseReceivingBinScan(r.rawValue);
            setOverflowBin(o.binId);
            void runOverflow(o.binId);
            setSession(null);
          }}
          onError={(m) => toast.error(m)}
        />
      )}
      {session === 'bin_whole' && (
        <LiveQrScanner
          title="Scan stock BIN"
          helpText="Label Studio BIN or rack QR"
          pickItem={{ itemId: -1, name: 'BIN', busyCode: line.busy_code }}
          onClose={() => setSession(null)}
          onResolved={(r) => {
            void applyWhole(r.rawValue);
            setSession(null);
          }}
          onError={(m) => toast.error(m)}
        />
      )}
      {session === 'bin_putaway' && (
        <LiveQrScanner
          title="Scan BIN for putaway"
          helpText="Same BIN where pieces are landing"
          pickItem={{ itemId: -1, name: 'BIN', busyCode: line.busy_code }}
          onClose={() => setSession(null)}
          onResolved={(r) => {
            confirmBinForPutaway(r.rawValue);
          }}
          onError={(m) => toast.error(m)}
        />
      )}
      {session === 'item_each' && (
        <LiveQrScanner
          title="Scan each item"
          helpText="ITEM QR (+1 ea)"
          pickItem={{
            itemId: item?.id ?? -1,
            name: line.sku_description_snapshot,
            busyCode: line.busy_code,
            itemCode: pickCode,
          }}
          onClose={() => setSession(null)}
          onResolved={(r) => {
            void handleEachItemScan(r);
          }}
          onError={(m) => toast.error(m)}
        />
      )}
    </div>
  );
}
