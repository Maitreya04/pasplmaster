import { CaretLeft, CaretRight, Flag } from '@phosphor-icons/react';
import { normalizeUom } from '../../../lib/picking/pickerMicrocopy';
import { pickQtyStripCopy } from '../lib/pickQtyDisplay';
import {
  derivePickLineUiState,
  pickPrimaryCta,
  pickSecondaryCta,
  pickUndoLineLabel,
  type PickLineUiState,
} from '../lib/pickLineCta';
import { PickedLedger } from './PickedLedger';
import { PickLineNavCenter } from './PickLineNavCenter';
import type { PickLineChip } from './PickLineChipStrip';
import { PickQtyMeter } from './PickQtyMeter';
import { usePickLineChipStrip } from '../lib/pickLineNav';
import type { LineDraft } from '../../../types';

export interface ItemDetailScreenProps {
  rackNo: string | null;
  partCode: string;
  itemName: string;
  targetQty: number;
  uom: string;
  draft: LineDraft;
  totalLogged: number;
  remaining: number;
  isComplete: boolean;
  lineIndex: number;
  totalLines: number;
  doneCount: number;
  lineChips: PickLineChip[];
  markedStatus?: 'picked' | 'partial' | 'flagged';
  revisitComplete?: boolean;
  onPickItem: () => void;
  onNextItem: () => void;
  onFinishOrder?: () => void;
  onPrevLine?: () => void;
  onNextLine?: () => void;
  onGoToLine?: (index: number) => void;
  onSeeAllLines?: () => void;
  onFlag?: () => void;
  onShortPick?: () => void;
  onEditPick?: () => void;
  onEditGroupMrp?: (groupId: string) => void;
  onEditGroupQty?: (groupId: string) => void;
  onUndoGroup?: (groupId: string) => void;
  onClearPick?: () => void;
  onUndoLine?: () => void;
  undoLinePending?: boolean;
  flashGroupId?: string | null;
}

function IdentityStep({
  step,
  label,
  labelClassName = 'text-[var(--content-tertiary)]',
}: {
  step: number;
  label: string;
  labelClassName?: string;
}): React.JSX.Element {
  return (
    <div className="pick-ticket-step-row">
      <span className="pick-ticket-step" aria-hidden>
        {step}
      </span>
      <p className={`pick-identity-label ${labelClassName}`}>{label}</p>
    </div>
  );
}

function LineStatusStrip({
  uiState,
  totalLogged,
  targetQty,
  uom,
  onUndoLine,
  undoLineLabel,
  undoLinePending = false,
}: {
  uiState: PickLineUiState;
  totalLogged: number;
  targetQty: number;
  uom: string;
  onUndoLine?: () => void;
  undoLineLabel?: string | null;
  undoLinePending?: boolean;
}): React.JSX.Element | null {
  const showUndo = onUndoLine != null && undoLineLabel != null;

  if (uiState === 'flagged') {
    return (
      <div className="pick-line-status-strip pick-line-status-strip--flagged pick-line-status-strip--with-action">
        <p className="min-w-0 flex-1 font-ds-caption-size font-semibold leading-snug">
          Flagged for billing — no pick needed
        </p>
        {showUndo ? (
          <button
            type="button"
            onClick={onUndoLine}
            disabled={undoLinePending}
            className="pick-line-status-undo pick-pressable disabled:opacity-50"
          >
            {undoLinePending ? 'Undoing…' : undoLineLabel}
          </button>
        ) : null}
      </div>
    );
  }

  if (uiState !== 'marked_picked' && uiState !== 'marked_partial' && uiState !== 'complete') {
    return null;
  }

  const logged = uiState === 'marked_picked' && totalLogged === 0 ? targetQty : totalLogged;
  const isPartial = uiState === 'marked_partial' || logged < targetQty;
  const statusCopy =
    uiState === 'marked_partial'
      ? `Short pick · shipping ${logged} of ${targetQty} ${normalizeUom(uom).toLowerCase()}`
      : pickQtyStripCopy(logged, targetQty, uom);

  return (
    <div
      className={`pick-line-status-strip pick-line-status-strip--with-action ${
        isPartial ? 'pick-line-status-strip--partial' : 'pick-line-status-strip--complete'
      }`}
    >
      <p className="min-w-0 flex-1 text-left font-ds-caption-size font-semibold leading-snug">
        {statusCopy}
      </p>
      {showUndo ? (
        <button
          type="button"
          onClick={onUndoLine}
          disabled={undoLinePending}
          className="pick-line-status-undo pick-pressable disabled:opacity-50"
        >
          {undoLinePending ? 'Undoing…' : undoLineLabel}
        </button>
      ) : null}
    </div>
  );
}

export function ItemDetailScreen({
  rackNo,
  partCode,
  itemName,
  targetQty,
  uom,
  draft,
  totalLogged,
  remaining,
  isComplete,
  lineIndex,
  totalLines,
  doneCount,
  lineChips,
  markedStatus,
  revisitComplete = false,
  onPickItem,
  onNextItem,
  onFinishOrder,
  onPrevLine,
  onNextLine,
  onGoToLine,
  onSeeAllLines,
  onFlag,
  onShortPick,
  onEditPick,
  onEditGroupMrp,
  onEditGroupQty,
  onUndoGroup,
  onClearPick,
  onUndoLine,
  undoLinePending = false,
  flashGroupId,
}: ItemDetailScreenProps): React.JSX.Element {
  const hasLogged = totalLogged > 0;
  const uiState = derivePickLineUiState(markedStatus, totalLogged, targetQty, isComplete);
  const isTicketComplete =
    uiState === 'marked_picked' ||
    uiState === 'complete' ||
    uiState === 'marked_partial' ||
    uiState === 'flagged';

  const primary = pickPrimaryCta(
    uiState,
    remaining,
    targetQty,
    uom,
    lineIndex,
    totalLines,
    revisitComplete,
  );
  const secondary = pickSecondaryCta(uiState, revisitComplete, lineIndex, totalLines);
  const undoLineLabel = pickUndoLineLabel(uiState);

  const canGoPrev = lineIndex > 0;
  const canGoNext = lineIndex < totalLines - 1;
  const lineProgress = `Line ${lineIndex + 1} of ${totalLines}`;
  const showChipStrip = usePickLineChipStrip(totalLines);
  const showLineNav = totalLines > 1 && onGoToLine;

  const handlePrimary = () => {
    if (primary.kind === 'pick') {
      onPickItem();
      return;
    }
    if (primary.kind === 'edit') {
      (onEditPick ?? onPickItem)();
      return;
    }
    if (primary.kind === 'finish') {
      (onFinishOrder ?? onNextItem)();
      return;
    }
    onNextItem();
  };

  const handleSecondary = () => {
    onNextItem();
  };

  const primaryClass =
    primary.kind === 'pick'
      ? 'pick-cta pick-cta--action'
      : primary.kind === 'edit'
        ? 'pick-cta pick-cta--edit'
        : primary.kind === 'finish'
          ? 'pick-cta pick-cta--finish'
          : 'pick-cta pick-cta--nav';

  const showFlag =
    onFlag &&
    uiState !== 'marked_picked' &&
    uiState !== 'marked_partial' &&
    uiState !== 'flagged' &&
    primary.kind !== 'next' &&
    primary.kind !== 'finish';

  const showShortPick =
    onShortPick != null &&
    uiState === 'in_progress' &&
    totalLogged > 0 &&
    remaining > 0;

  return (
    <div className="pick-detail flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="pick-detail-body min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <article
          className={`pick-ticket mx-3 mt-2 ${
            uiState === 'marked_picked' || uiState === 'complete'
              ? 'pick-ticket--complete'
              : uiState === 'marked_partial'
                ? 'pick-ticket--partial'
                : uiState === 'flagged'
                  ? 'pick-ticket--flagged'
                  : ''
          }`}
        >
          <div className="pick-ticket-nav">
            <IdentityStep step={1} label="Walk to rack" labelClassName="text-[var(--amber-9)]" />
            <p className="pick-ticket-rack-value font-mono font-extrabold text-[var(--content-primary)]">
              {rackNo ?? '—'}
            </p>
          </div>

          <div className="pick-ticket-perforation" aria-hidden />

          <div className="pick-ticket-mission">
            <IdentityStep step={2} label="Part no" />
            <p className="pick-ticket-part-value font-mono font-extrabold text-[var(--content-primary)]">
              {partCode}
            </p>
            <p className="pick-ticket-item-name line-clamp-2 font-ds-caption-size leading-snug text-[var(--content-secondary)]">
              {itemName}
            </p>

            <PickQtyMeter
              totalLogged={totalLogged}
              targetQty={targetQty}
              remaining={remaining}
              uom={uom}
              uiState={uiState}
            />
          </div>
        </article>

        <div className="px-3 pb-3 pt-2">
          {hasLogged ? (
            <PickedLedger
              draft={draft}
              totalLogged={totalLogged}
              remaining={remaining}
              onEditGroupMrp={onEditGroupMrp}
              onEditGroupQty={onEditGroupQty}
              onUndoGroup={onUndoGroup}
              onClearPick={isTicketComplete ? undefined : onClearPick}
              onFinishShort={showShortPick ? onShortPick : undefined}
              flashGroupId={flashGroupId}
              context="summary"
            />
          ) : isTicketComplete ? (
            <p className="pick-ticket-zero font-ds-micro text-[var(--content-tertiary)]">
              {uiState === 'flagged'
                ? 'Line flagged — undo below if this was a mistake.'
                : 'Line marked complete — tap Edit pick below to change batches.'}
            </p>
          ) : (
            <p className="pick-ticket-zero font-ds-micro text-[var(--content-tertiary)]">
              No batches logged yet.
            </p>
          )}
        </div>
      </div>

      <div className="pick-detail-dock shrink-0 border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
        <LineStatusStrip
          uiState={uiState}
          totalLogged={totalLogged}
          targetQty={targetQty}
          uom={uom}
          onUndoLine={onUndoLine}
          undoLineLabel={undoLineLabel}
          undoLinePending={undoLinePending}
        />

        {showLineNav ? (
          <div className="pick-detail-nav-row">
            <button
              type="button"
              onClick={onPrevLine}
              disabled={!canGoPrev || !onPrevLine}
              className="pick-detail-nav-arrow pick-pressable disabled:opacity-30"
              aria-label="Previous line"
            >
              <CaretLeft size={18} weight="bold" />
            </button>

            <PickLineNavCenter
              chips={lineChips}
              currentIndex={lineIndex}
              totalLines={totalLines}
              doneCount={doneCount}
              onSelectLine={onGoToLine}
              onSeeAllLines={onSeeAllLines ?? (() => {})}
            />

            <button
              type="button"
              onClick={onNextLine}
              disabled={!canGoNext || !onNextLine}
              className="pick-detail-nav-arrow pick-pressable disabled:opacity-30"
              aria-label="Next line"
            >
              <CaretRight size={18} weight="bold" />
            </button>
          </div>
        ) : null}

        {showLineNav && showChipStrip ? (
          <p className="pick-detail-line-label mb-2 text-center font-ds-micro font-semibold tabular-nums text-[var(--content-quaternary)]">
            {lineProgress}
          </p>
        ) : null}

        <div className="pick-detail-cta-stack space-y-2">
          <div className="pick-detail-cta-row flex gap-2">
            {secondary ? (
              <>
                <button
                  type="button"
                  onClick={handlePrimary}
                  className={`min-h-12 flex-1 ${primaryClass} pick-pressable`}
                >
                  {primary.label}
                </button>
                <button
                  type="button"
                  onClick={handleSecondary}
                  className="pick-cta pick-cta--nav min-h-12 flex-1 pick-pressable"
                >
                  {secondary.label}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={handlePrimary}
                className={`min-h-12 w-full ${primaryClass} pick-pressable`}
              >
                {primary.label}
              </button>
            )}
          </div>
          {showFlag ? (
            <button
              type="button"
              onClick={onFlag}
              className="flex min-h-10 w-full items-center justify-center gap-1.5 font-ds-caption-size font-semibold text-[var(--content-tertiary)] pick-pressable hover:text-[var(--content-warning-on-light)]"
            >
              <Flag size={16} weight="fill" aria-hidden />
              <span>Flag issue</span>
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
