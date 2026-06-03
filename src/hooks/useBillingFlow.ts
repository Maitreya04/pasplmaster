import { useState, useCallback, useRef } from 'react';
import type { OrderItem, SalesLineUnit } from '../types';
import { flagsFromOrderItems, type BillingLineEdit } from '../lib/billing/liveQueueDraft';

export type BillingFlowState = 'queue' | 'orderSheet' | 'report';

export interface ItemFlag {
  type: 'no_stock' | 'partial';
  availableQty?: number; // only for partial
}

export type { BillingLineEdit } from '../lib/billing/liveQueueDraft';

export function useBillingFlow() {
  const [state, setState] = useState<BillingFlowState>('queue');
  /** Keyed by `order_items.id`. */
  const [flags, setFlags] = useState<Record<number, ItemFlag>>({});
  /** Keyed by `order_items.id`. */
  const [lineEdits, setLineEdits] = useState<Record<number, BillingLineEdit>>({});
  /** True after the user edits flags or lines; false after hydrate or successful draft persist. */
  const draftDirtyRef = useRef(false);

  const markDraftDirty = useCallback(() => {
    draftDirtyRef.current = true;
  }, []);

  const resetDraftDirty = useCallback(() => {
    draftDirtyRef.current = false;
  }, []);

  const isDraftDirty = useCallback(() => draftDirtyRef.current, []);

  // --- Transitions ---

  const openOrder = useCallback(() => {
    setFlags({});
    setLineEdits({});
    draftDirtyRef.current = false;
    setState('orderSheet');
  }, []);

  const finishBilling = useCallback(() => {
    setFlags({});
    setLineEdits({});
    draftDirtyRef.current = false;
    setState('report');
  }, []);

  const nextOrder = useCallback(() => {
    setFlags({});
    setLineEdits({});
    draftDirtyRef.current = false;
    setState('queue');
  }, []);

  const returnToQueue = useCallback(() => {
    setFlags({});
    setLineEdits({});
    draftDirtyRef.current = false;
    setState('queue');
  }, []);

  /** When opening the sheet, restore flags from saved qty_shippable / qty_po on order lines. */
  const hydrateFromItems = useCallback((items: OrderItem[]) => {
    setFlags(flagsFromOrderItems(items) as Record<number, ItemFlag>);
    draftDirtyRef.current = false;
  }, []);

  // --- Flag Actions (keyed by order_items.id) ---

  const flagNoStock = useCallback((orderItemId: number) => {
    draftDirtyRef.current = true;
    setFlags((prev) => ({ ...prev, [orderItemId]: { type: 'no_stock' } }));
  }, []);

  const flagPartial = useCallback((orderItemId: number, availableQty: number) => {
    draftDirtyRef.current = true;
    setFlags((prev) => ({
      ...prev,
      [orderItemId]: { type: 'partial', availableQty },
    }));
  }, []);

  const clearFlag = useCallback((orderItemId: number) => {
    draftDirtyRef.current = true;
    setFlags((prev) => {
      const next = { ...prev };
      delete next[orderItemId];
      return next;
    });
  }, []);

  // --- Line edits ---

  const editLineQty = useCallback((orderItemId: number, qty: number) => {
    draftDirtyRef.current = true;
    setLineEdits((prev) => ({
      ...prev,
      [orderItemId]: { ...prev[orderItemId], qtyRequested: qty },
    }));
  }, []);

  const editLineRate = useCallback((orderItemId: number, rate: number) => {
    draftDirtyRef.current = true;
    setLineEdits((prev) => ({
      ...prev,
      [orderItemId]: { ...prev[orderItemId], priceQuoted: rate },
    }));
  }, []);

  const editLineSalesUnit = useCallback((orderItemId: number, salesUnit: SalesLineUnit) => {
    draftDirtyRef.current = true;
    setLineEdits((prev) => ({
      ...prev,
      [orderItemId]: { ...prev[orderItemId], salesUnit },
    }));
  }, []);

  const removeLine = useCallback((orderItemId: number) => {
    draftDirtyRef.current = true;
    setLineEdits((prev) => ({
      ...prev,
      [orderItemId]: { ...prev[orderItemId], removed: true },
    }));
    setFlags((prev) => {
      const next = { ...prev };
      delete next[orderItemId];
      return next;
    });
  }, []);

  const restoreLine = useCallback((orderItemId: number) => {
    draftDirtyRef.current = true;
    setLineEdits((prev) => {
      const cur = prev[orderItemId];
      if (!cur) return prev;
      const { removed: _removed, ...rest } = cur;
      const next = { ...prev };
      if (Object.keys(rest).length === 0) {
        delete next[orderItemId];
      } else {
        next[orderItemId] = rest;
      }
      return next;
    });
  }, []);

  /** Drop edit entries for rows no longer returned by the server (e.g. after draft persist deleted lines). */
  const pruneLineEditsForRemovedRows = useCallback((existingOrderItemIds: Set<number>) => {
    setLineEdits((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const id of Object.keys(next).map(Number)) {
        if (!existingOrderItemIds.has(id)) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, []);

  // --- Computed ---

  const flagCount = Object.keys(flags).length;
  const hasFlags = flagCount > 0;

  const removedCount = Object.values(lineEdits).filter((e) => e.removed).length;

  const editCount = Object.entries(lineEdits).filter(
    ([, e]) =>
      !e.removed &&
      (e.qtyRequested !== undefined ||
        e.priceQuoted !== undefined ||
        e.salesUnit !== undefined),
  ).length;

  return {
    state,
    flags,
    lineEdits,
    flagCount,
    hasFlags,
    removedCount,
    editCount,

    // Transitions
    openOrder,
    finishBilling,
    nextOrder,
    returnToQueue,
    hydrateFromItems,

    // Flag actions
    flagNoStock,
    flagPartial,
    clearFlag,

    // Line edits
    editLineQty,
    editLineRate,
    editLineSalesUnit,
    removeLine,
    restoreLine,
    pruneLineEditsForRemovedRows,
    markDraftDirty,

    isDraftDirty,
    resetDraftDirty,
  };
}
