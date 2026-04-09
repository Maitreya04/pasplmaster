import { useState, useCallback } from 'react';

export type BillingFlowState = 'queue' | 'orderSheet' | 'report';

export interface ItemFlag {
  type: 'no_stock' | 'partial';
  availableQty?: number; // only for partial
}

export function useBillingFlow() {
  const [state, setState] = useState<BillingFlowState>('queue');
  const [flags, setFlags] = useState<Record<number, ItemFlag>>({});

  // --- Transitions ---

  const openOrder = useCallback(() => {
    setFlags({});
    setState('orderSheet');
  }, []);

  const finishBilling = useCallback(() => {
    setState('report');
  }, []);

  const nextOrder = useCallback(() => {
    setFlags({});
    setState('queue');
  }, []);

  const returnToQueue = useCallback(() => {
    setFlags({});
    setState('queue');
  }, []);

  // --- Flag Actions (keyed by item index) ---

  const flagNoStock = useCallback((itemIndex: number) => {
    setFlags(prev => ({ ...prev, [itemIndex]: { type: 'no_stock' } }));
  }, []);

  const flagPartial = useCallback((itemIndex: number, availableQty: number) => {
    setFlags(prev => ({
      ...prev,
      [itemIndex]: { type: 'partial', availableQty },
    }));
  }, []);

  const clearFlag = useCallback((itemIndex: number) => {
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

    // Flag actions
    flagNoStock,
    flagPartial,
    clearFlag,
  };
}
