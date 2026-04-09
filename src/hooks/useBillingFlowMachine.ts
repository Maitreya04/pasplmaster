import { useState, useCallback } from 'react';
import type { OrderItem } from '../types';

export type BillingFlowState = 
  | 'orient' 
  | 'commit' 
  | 'process' 
  | 'resolve' 
  | 'communicate' 
  | 'complete';

export type ResolveDecision = 
  | 'bill_available'           // E.g., bill 3, drop 7
  | 'bill_available_po_rest'   // E.g., bill 3, send 7 to PO
  | 'drop_entirely';

export type ManualFlagType = 'no_stock' | 'partial_stock';

export interface ManualFlag {
  itemIndex: number;
  type: ManualFlagType;
  availableQty: number; // 0 for no_stock, partial qty for partial_stock
}

export interface FlagIssue {
  itemIndex: number;
  type: 'no_stock' | 'partial_stock' | 'price_flag' | 'other_flag';
  description: string;
}

export function useBillingFlowMachine(items: OrderItem[]) {
  const [state, setState] = useState<BillingFlowState>('orient');
  const [activeItemIndex, setActiveItemIndex] = useState(0);
  
  // Track array of issues to resolve. Populated upon entering 'resolve' mode.
  const [issues, setIssues] = useState<FlagIssue[]>([]);
  const [activeIssueIndex, setActiveIssueIndex] = useState(0);

  // Track the actual decisions made during resolve mode.
  // Record<item.id, Decision>
  const [decisions, setDecisions] = useState<Record<number, ResolveDecision>>({});

  // Manual flags set by billing person during Process phase
  const [manualFlags, setManualFlags] = useState<Record<number, ManualFlag>>({});

  const isProcessComplete = activeItemIndex >= items.length;

  const reset = useCallback(() => {
    setState('orient');
    setActiveItemIndex(0);
    setIssues([]);
    setActiveIssueIndex(0);
    setDecisions({});
    setManualFlags({});
  }, []);

  const startCommit = useCallback(() => {
    setState('commit');
  }, []);

  const confirmCommit = useCallback(() => {
    setState('process');
    setActiveItemIndex(0);
  }, []);

  const advanceProcessCursor = useCallback(() => {
    setActiveItemIndex((prev) => prev + 1);
  }, []);

  const jumpToItem = useCallback((index: number) => {
    setActiveItemIndex(Math.max(0, Math.min(index, items.length)));
  }, [items.length]);

  // Flag an item manually during Process phase
  const flagItem = useCallback((itemIndex: number, type: ManualFlagType, availableQty: number) => {
    setManualFlags((prev) => ({
      ...prev,
      [itemIndex]: { itemIndex, type, availableQty },
    }));
    // Auto-advance past the flagged item
    setActiveItemIndex((prev) => prev + 1);
  }, []);

  const unflagItem = useCallback((itemIndex: number) => {
    setManualFlags((prev) => {
      const next = { ...prev };
      delete next[itemIndex];
      return next;
    });
  }, []);

  const finishProcessPhase = useCallback(() => {
    // Merge manual flags + auto-detected issues
    const detectedIssues: FlagIssue[] = [];
    
    items.forEach((item, index) => {
      // 1. Check manual flags first (billing person flagged during process)
      const manual = manualFlags[index];
      if (manual) {
        detectedIssues.push({
          itemIndex: index,
          type: manual.type,
          description: manual.type === 'no_stock'
            ? `No stock in Busy. Requested ${item.qty_requested}.`
            : `Partial stock in Busy. Requested ${item.qty_requested}, only ${manual.availableQty} available.`,
        });
        return;
      }

      // 2. Existing flags (e.g. from picker or earlier billing)
      if (item.state === 'flagged') {
        detectedIssues.push({
          itemIndex: index,
          type: 'other_flag',
          description: item.flag_reason || 'Needs supervisor attention',
        });
        return;
      }
      
      // 3. Stock constraints from database
      const requested = item.qty_requested;
      const shippable = item.qty_shippable;
      
      if (shippable === 0) {
        detectedIssues.push({
          itemIndex: index,
          type: 'no_stock',
          description: `No stock available. Requested ${requested}.`,
        });
      } else if (shippable != null && shippable < requested) {
        detectedIssues.push({
          itemIndex: index,
          type: 'partial_stock',
          description: `Partial stock. Requested ${requested}, but only ${shippable} available.`,
        });
      }
    });

    if (detectedIssues.length > 0) {
      setIssues(detectedIssues);
      setActiveIssueIndex(0);
      setState('resolve');
      return true;
    } else {
      // No issues, return false so parent can trigger approveMutation
      return false;
    }
  }, [items, manualFlags]);

  const recordDecisionAndNext = useCallback((itemId: number, decision: ResolveDecision) => {
    setDecisions((prev) => ({ ...prev, [itemId]: decision }));
    
    setActiveIssueIndex((prev) => {
      const nextIndex = prev + 1;
      if (nextIndex >= issues.length) {
        // We resolved everything.
        // Let state respond to this via effect or set directly:
        setState('communicate');
        return prev; // keep at end
      }
      return nextIndex;
    });
  }, [issues.length]);

  const parkOrder = useCallback(() => {
    // Exits immediately to orient
    setState('orient');
  }, []);

  const confirmCommunication = useCallback(() => {
    setState('complete');
  }, []);

  return {
    state,
    reset,
    startCommit,
    confirmCommit,
    
    // Process State
    activeItemIndex,
    isProcessComplete,
    advanceProcessCursor,
    jumpToItem,
    flagItem,
    unflagItem,
    manualFlags,
    finishProcessPhase,
    
    // Resolve State
    issues,
    activeIssueIndex,
    currentIssue: issues.length > 0 ? issues[activeIssueIndex] : null,
    decisions,
    recordDecisionAndNext,
    parkOrder,
    
    // Communicate State
    confirmCommunication,
  };
}
