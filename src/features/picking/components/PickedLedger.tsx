import { CheckCircle, Clock } from '@phosphor-icons/react';
import { mrpBatchLabel, normalizeUom } from '../../../lib/picking/pickerMicrocopy';
import type { ConfirmedPriceGroup, LineDraft } from '../../../types';

function EditableMrpCell({
  label,
  mrp,
  onPress,
  emphasized = false,
}: {
  label: string;
  mrp: number;
  onPress?: () => void;
  emphasized?: boolean;
}): React.JSX.Element {
  const value = (
    <span className="font-mono font-extrabold tabular-nums text-content-signal-ok">
      ₹{Math.round(mrp)}
    </span>
  );

  return (
    <div className="min-w-0 flex-1">
      <p className="pick-identity-label text-[var(--content-tertiary)]">{label}</p>
      {onPress ? (
        <button
          type="button"
          onClick={onPress}
          className={`mt-1 pick-editable-value pick-pressable text-left ${emphasized ? 'pick-editable-value-active' : ''}`}
        >
          {value}
        </button>
      ) : (
        <p className="mt-1">{value}</p>
      )}
    </div>
  );
}

function EditableQtyCell({
  qty,
  uom,
  onPress,
  typing = false,
  emphasized = false,
}: {
  qty: number;
  uom: string;
  onPress?: () => void;
  typing?: boolean;
  emphasized?: boolean;
}): React.JSX.Element {
  const uomNorm = normalizeUom(uom);
  const value = (
    <span className="font-mono font-extrabold tabular-nums text-[var(--content-primary)]">
      {qty} <span className="font-sans text-[0.85em] font-semibold">{uomNorm.toLowerCase()}</span>
      {typing ? (
        <span className="ml-1 font-sans text-[0.72em] font-semibold text-[var(--content-warning-on-light)]">
          typing
        </span>
      ) : null}
    </span>
  );

  return (
    <div className="min-w-0 flex-1">
      <p className="pick-identity-label text-[var(--content-tertiary)]">Qty</p>
      {onPress ? (
        <button
          type="button"
          onClick={onPress}
          className={`mt-1 pick-editable-value pick-pressable text-left ${emphasized ? 'pick-editable-value-active' : ''}`}
        >
          {value}
        </button>
      ) : (
        <p className="mt-1">{value}</p>
      )}
    </div>
  );
}

export interface LedgerBatchRowProps {
  variant: 'confirmed' | 'inProgress';
  batchIndex: number;
  qty: number;
  uom: string;
  mrp: number;
  onEditMrp?: () => void;
  onEditQty?: () => void;
  onUndo?: () => void;
  flash?: boolean;
}

export function LedgerBatchRow({
  variant,
  batchIndex,
  qty,
  uom,
  mrp,
  onEditMrp,
  onEditQty,
  onUndo,
  flash = false,
}: LedgerBatchRowProps): React.JSX.Element {
  const isInProgress = variant === 'inProgress';
  const rowClass = flash
    ? 'border-[var(--border-selected)] bg-[var(--bg-row-selected)]'
    : isInProgress
      ? 'border-[var(--border-warning)] bg-[var(--bg-warning-subtle)]/60'
      : 'border-[var(--border-subtle)] bg-[var(--bg-secondary)]';

  return (
    <div
      className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 ${rowClass}`}
    >
      {isInProgress ? (
        <Clock size={14} weight="fill" className="mt-4 shrink-0 text-[var(--content-warning-on-light)]" />
      ) : (
        <CheckCircle size={14} weight="fill" className="mt-4 shrink-0 text-[var(--content-positive)]" />
      )}
      <div className="grid min-w-0 flex-1 grid-cols-2 gap-3">
        <EditableMrpCell
          label={mrpBatchLabel(batchIndex)}
          mrp={mrp}
          onPress={onEditMrp}
        />
        <EditableQtyCell
          qty={qty}
          uom={uom}
          onPress={onEditQty}
          typing={isInProgress}
        />
      </div>
      {onUndo ? (
        <button
          type="button"
          onClick={onUndo}
          className="shrink-0 self-center rounded-lg px-2 py-1 font-ds-micro font-semibold text-[var(--content-secondary)] pick-pressable"
        >
          Undo
        </button>
      ) : null}
    </div>
  );
}

export type PickedLedgerMode = 'full' | 'strip';

function PickProgressStrip({
  totalLogged,
  targetQty,
  remaining,
  uom,
  inProgressQty,
}: {
  totalLogged: number;
  targetQty: number;
  remaining: number;
  uom: string;
  inProgressQty: number;
}): React.JSX.Element {
  const uomNorm = normalizeUom(uom);
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] px-3 py-2">
      <span className="font-mono font-ds-caption-size font-semibold tabular-nums text-[var(--content-secondary)]">
        {totalLogged}
        {inProgressQty > 0 ? ` + ${inProgressQty}` : ''} / {targetQty} on order
      </span>
      {remaining > 0 ? (
        <span className="font-ds-caption-size font-bold text-[var(--content-warning-on-light)]">
          {remaining} {uomNorm.toLowerCase()} left
        </span>
      ) : (
        <span className="font-ds-caption-size font-semibold text-[var(--content-positive)]">Complete</span>
      )}
    </div>
  );
}

function RemainingRow({ qty, uom }: { qty: number; uom: string }): React.JSX.Element {
  const uomNorm = normalizeUom(uom);
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-[var(--border-warning)] bg-[var(--bg-warning-subtle)] px-3 py-2.5">
      <Clock size={14} weight="fill" className="shrink-0 text-[var(--content-warning-on-light)]" />
      <div className="min-w-0 flex-1">
        <p className="pick-identity-label text-[var(--content-warning-on-light)]">Remaining</p>
        <p className="mt-0.5 font-ds-body-size font-semibold text-[var(--content-warning-on-light)]">
          {qty} {uomNorm.toLowerCase()} still to pick
        </p>
      </div>
    </div>
  );
}

export interface PickedLedgerProps {
  draft: LineDraft;
  totalLogged: number;
  remaining: number;
  onEditGroupMrp?: (groupId: string) => void;
  onEditGroupQty?: (groupId: string) => void;
  onEditInProgressMrp?: () => void;
  onEditInProgressQty?: () => void;
  onUndoGroup?: (groupId: string) => void;
  onClearPick?: () => void;
  flashGroupId?: string | null;
  context?: 'modal' | 'summary';
  mode?: PickedLedgerMode;
}

export function PickedLedger({
  draft,
  totalLogged,
  remaining,
  onEditGroupMrp,
  onEditGroupQty,
  onEditInProgressMrp,
  onEditInProgressQty,
  onUndoGroup,
  onClearPick,
  flashGroupId,
  context = 'modal',
  mode = 'full',
}: PickedLedgerProps): React.JSX.Element | null {
  const hasContent =
    draft.confirmedGroups.length > 0 ||
    draft.inProgress != null ||
    remaining > 0;

  if (!hasContent) return null;

  const ip = draft.inProgress;
  const ipQty = ip?.stage === 'qty' && ip.qty != null ? ip.qty : 0;
  const canEdit = onEditGroupMrp != null || onEditGroupQty != null;
  const lastGroupId =
    draft.confirmedGroups.length > 0
      ? draft.confirmedGroups[draft.confirmedGroups.length - 1]!.id
      : null;

  if (mode === 'strip') {
    return (
      <PickProgressStrip
        totalLogged={totalLogged}
        targetQty={draft.targetQty}
        remaining={remaining}
        uom={draft.uom}
        inProgressQty={ipQty}
      />
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-ds-label-size font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
          Picked so far
        </p>
        <p className="font-mono font-ds-caption-size text-[var(--content-secondary)]">
          {totalLogged}
          {ipQty > 0 ? ` + ${ipQty}` : ''} / {draft.targetQty} on order
        </p>
      </div>
      {canEdit && context === 'modal' ? (
        <p className="font-ds-micro text-[var(--content-quaternary)]">
          Dashed values are editable — tap MRP or qty
        </p>
      ) : null}
      <div className="space-y-1.5">
        {draft.confirmedGroups.map((group: ConfirmedPriceGroup, index: number) => (
          <LedgerBatchRow
            key={group.id}
            variant="confirmed"
            batchIndex={index}
            qty={group.qty}
            uom={draft.uom}
            mrp={group.mrp}
            onEditMrp={onEditGroupMrp ? () => onEditGroupMrp(group.id) : undefined}
            onEditQty={onEditGroupQty ? () => onEditGroupQty(group.id) : undefined}
            onUndo={
              onUndoGroup && group.id === lastGroupId
                ? () => onUndoGroup(group.id)
                : undefined
            }
            flash={flashGroupId === group.id}
          />
        ))}
        {ip?.stage === 'qty' && ip.mrp != null && ipQty > 0 ? (
          <LedgerBatchRow
            variant="inProgress"
            batchIndex={draft.confirmedGroups.length}
            qty={ipQty}
            uom={draft.uom}
            mrp={ip.mrp}
            onEditMrp={onEditInProgressMrp}
            onEditQty={onEditInProgressQty}
          />
        ) : null}
        {remaining > 0 ? <RemainingRow qty={remaining} uom={draft.uom} /> : null}
      </div>
      {onClearPick && draft.confirmedGroups.length > 0 ? (
        <div className="flex justify-end pt-0.5">
          <button
            type="button"
            onClick={onClearPick}
            className="font-ds-micro font-semibold text-[var(--content-negative)] pick-pressable"
          >
            Remove pick · start over
          </button>
        </div>
      ) : null}
    </div>
  );
}
