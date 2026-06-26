import { CaretLeft, CaretRight, Flag, HandTap, List, Package } from '@phosphor-icons/react';
import { normalizeUom } from '../../../lib/picking/pickerMicrocopy';
import { PickedLedger } from './PickedLedger';
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
  onPickItem: () => void;
  onNextItem: () => void;
  onPrevLine?: () => void;
  onNextLine?: () => void;
  onSeeAllLines?: () => void;
  onFlag?: () => void;
  onEditGroupMrp?: (groupId: string) => void;
  onEditGroupQty?: (groupId: string) => void;
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

function LineNavDots({
  lineIndex,
  totalLines,
}: {
  lineIndex: number;
  totalLines: number;
}): React.JSX.Element {
  const maxDots = Math.min(totalLines, 8);
  return (
    <div className="flex items-center gap-1" aria-hidden>
      {Array.from({ length: maxDots }, (_, i) => {
        const dotIndex =
          totalLines <= maxDots
            ? i
            : Math.round((i / Math.max(1, maxDots - 1)) * (totalLines - 1));
        const isActive = dotIndex === lineIndex;
        return (
          <span
            key={i}
            className={`h-1.5 rounded-full transition-all ${
              isActive
                ? 'w-3 bg-[var(--role-primary)]'
                : 'w-1.5 bg-[var(--border-opaque)]'
            }`}
          />
        );
      })}
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
  onPickItem,
  onNextItem,
  onPrevLine,
  onNextLine,
  onSeeAllLines,
  onFlag,
  onEditGroupMrp,
  onEditGroupQty,
  flashGroupId,
}: ItemDetailScreenProps): React.JSX.Element {
  const uomNorm = normalizeUom(uom);
  const hasLogged = totalLogged > 0;
  const qtyHero = hasLogged && remaining > 0 && !isComplete ? remaining : targetQty;
  const qtyLabel =
    hasLogged && remaining > 0 && !isComplete ? 'Still to pick' : 'Pick qty';
  const qtySubtext =
    hasLogged && remaining > 0 && !isComplete
      ? `${totalLogged} of ${targetQty} logged on this line`
      : `${targetQty} on this line`;
  const canGoPrev = lineIndex > 0;
  const canGoNext = lineIndex < totalLines - 1;
  const lineProgress = `Line ${lineIndex + 1} of ${totalLines}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <article className="pick-ticket mx-3 mt-2 shrink-0">
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

          <div className="pick-ticket-qty-panel">
            <IdentityStep step={3} label={qtyLabel} labelClassName="text-[var(--amber-9)]" />
            <div className="pick-ticket-qty-row">
              <span className="pick-ticket-qty-value font-mono font-extrabold tabular-nums">
                {qtyHero}
              </span>
              <span className="pick-ticket-uom">{uomNorm}</span>
            </div>
            <p className="mt-1 font-ds-micro text-[var(--content-tertiary)]">{qtySubtext}</p>
          </div>
        </div>
      </article>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-3">
        {hasLogged ? (
          <PickedLedger
            draft={draft}
            totalLogged={totalLogged}
            remaining={remaining}
            onEditGroupMrp={onEditGroupMrp}
            onEditGroupQty={onEditGroupQty}
            flashGroupId={flashGroupId}
            context="summary"
          />
        ) : (
          <div className="pick-ticket-empty flex flex-col items-center justify-center px-4 py-8 text-center">
            <div className="relative flex h-14 w-14 items-center justify-center">
              <div className="absolute inset-0 rounded-2xl bg-[var(--bg-secondary)] ring-1 ring-[var(--border-subtle)]" />
              <Package
                size={24}
                className="relative text-[var(--content-quaternary)]"
                weight="duotone"
              />
              <HandTap
                size={16}
                weight="fill"
                className="absolute -bottom-1 -right-1 text-[var(--role-primary)]"
              />
            </div>
            <p className="mt-3 max-w-[16rem] font-ds-caption-size font-semibold text-[var(--content-secondary)]">
              Nothing picked yet
            </p>
            <p className="mt-1 max-w-[16rem] font-ds-micro leading-relaxed text-[var(--content-tertiary)]">
              Grab the part from the shelf, then tap Pick item below.
            </p>
            <button
              type="button"
              onClick={onPickItem}
              className="mt-4 min-h-10 rounded-xl border border-dashed border-[var(--border-opaque)] bg-[var(--bg-secondary)] px-5 font-ds-caption-size font-bold text-[var(--content-secondary)] pick-pressable"
            >
              Pick item →
            </button>
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4">
        <div className="pick-line-nav mb-3 grid min-h-11 grid-cols-[1fr_auto_1fr] items-center">
          <button
            type="button"
            onClick={onPrevLine}
            disabled={!canGoPrev || !onPrevLine}
            className="flex min-h-11 items-center justify-start rounded-xl px-2 pick-pressable disabled:opacity-30"
            aria-label="Previous line"
          >
            <CaretLeft size={20} weight="bold" />
          </button>

          <div className="flex flex-col items-center gap-1 px-2">
            <span className="font-ds-micro font-semibold tabular-nums text-[var(--content-tertiary)]">
              {lineProgress}
            </span>
            <LineNavDots lineIndex={lineIndex} totalLines={totalLines} />
          </div>

          <button
            type="button"
            onClick={onNextLine}
            disabled={!canGoNext || !onNextLine}
            className="flex min-h-11 items-center justify-end rounded-xl px-2 pick-pressable disabled:opacity-30"
            aria-label="Next line"
          >
            <CaretRight size={20} weight="bold" />
          </button>
        </div>

        <div className="flex gap-2">
          {isComplete ? (
            <button
              type="button"
              onClick={onNextItem}
              className="min-h-12 flex-1 rounded-2xl bg-[var(--bg-inverse-primary)] font-ds-body-size font-extrabold text-white pick-pressable"
            >
              Next item →
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onPickItem}
                className="min-h-12 flex-1 rounded-2xl bg-[var(--bg-inverse-primary)] font-ds-body-size font-extrabold text-white pick-pressable"
              >
                {hasLogged && remaining > 0 ? 'Continue picking →' : 'Pick item →'}
              </button>
              {onFlag ? (
                <button
                  type="button"
                  onClick={onFlag}
                  className="flex min-h-12 min-w-12 items-center justify-center rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] pick-pressable"
                  aria-label="Flag item"
                >
                  <Flag size={20} weight="fill" className="text-[var(--content-warning-on-light)]" />
                </button>
              ) : null}
            </>
          )}
        </div>

        {onSeeAllLines ? (
          <button
            type="button"
            onClick={onSeeAllLines}
            className="mt-2 flex w-full min-h-10 items-center justify-center gap-2 rounded-xl font-ds-caption-size font-semibold text-[var(--content-secondary)] pick-pressable"
          >
            <List size={16} weight="bold" />
            See all lines as a list
          </button>
        ) : null}
      </div>
    </div>
  );
}
