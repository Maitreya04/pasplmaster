import { useState, useCallback, useRef } from 'react';
import type { OrderItem } from '../types';
import { flagsFromOrderItems } from '../lib/billing/liveQueueDraft';

export type BillingFlowState = 'queue' | 'orderSheet' | 'report';

export interface ItemFlag {
  type: 'no_stock' | 'partial';
  availableQty?: number; // only for partial
}

export function useBillingFlow() {
  const [state, setState] = useState<BillingFlowState>('queue');
  const [flags, setFlags] = useState<Record<number, ItemFlag>>({});
  /** True after the user edits flags; false after hydrate or successful draft persist. */
  const draftDirtyRef = useRef(false);

  const resetDraftDirty = useCallback(() => {
    draftDirtyRef.current = false;
  }, []);

  const isDraftDirty = useCallback(() => draftDirtyRef.current, []);

  // --- Transitions ---

  const openOrder = useCallback(() => {
    setFlags({});
    draftDirtyRef.current = false;
    setState('orderSheet');
  }, []);

  const finishBilling = useCallback(() => {
    setFlags({});
    draftDirtyRef.current = false;
    setState('report');
  }, []);

  const nextOrder = useCallback(() => {
    setFlags({});
    draftDirtyRef.current = false;
    setState('queue');
  }, []);

  const returnToQueue = useCallback(() => {
    setFlags({});
    draftDirtyRef.current = false;
    setState('queue');
  }, []);

  /** When opening the sheet, restore flags from saved qty_shippable / qty_po on order lines. */
  const hydrateFromItems = useCallback((items: OrderItem[]) => {
    setFlags(flagsFromOrderItems(items) as Record<number, ItemFlag>);
    draftDirtyRef.current = false;
  }, []);

  // --- Flag Actions (keyed by item index) ---

  const flagNoStock = useCallback((itemIndex: number) => {
    draftDirtyRef.current = true;
    setFlags(prev => ({ ...prev, [itemIndex]: { type: 'no_stock' } }));
  }, []);

  const flagPartial = useCallback((itemIndex: number, availableQty: number) => {
    draftDirtyRef.current = true;
    setFlags(prev => ({
      ...prev,
      [itemIndex]: { type: 'partial', availableQty },
    }));
  }, []);

  const clearFlag = useCallback((itemIndex: number) => {
    draftDirtyRef.current = true;
    setFlags(prev => {
      const next = { ...prev };
      delete next[itemIndex];
      return next;
    });
  }, []);

  // --- Computed ---

  const flagCount = Object.keys(flags).length;
  const hasFlags = flagCount > 0;

  return {
    state,
    flags,
    flagCount,
    hasFlags,

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

    isDraftDirty,
    resetDraftDirty,
  };
}
