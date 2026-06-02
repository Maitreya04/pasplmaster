import { useCallback, useState } from 'react';
import type { Item } from '../types';
import { autoSelectUnitId } from '../lib/sales/sellingUnits';

export const ITEM_CARD_STATE = {
  IDLE: 'idle',
  ACTIVE: 'active',
  CONFIRMED: 'confirmed',
} as const;

export type ItemCardState = (typeof ITEM_CARD_STATE)[keyof typeof ITEM_CARD_STATE];

export interface ConfirmedCardSnapshot {
  unitId: string;
  qty: number;
}

export function useItemCardState() {
  const [activeItemId, setActiveItemId] = useState<number | null>(null);
  const [selectedUnit, setSelectedUnit] = useState<string | null>(null);
  const [confirmedByItemId, setConfirmedByItemId] = useState<
    Record<number, ConfirmedCardSnapshot>
  >({});

  const cardStateFor = useCallback(
    (itemId: number): ItemCardState => {
      if (activeItemId === itemId) return ITEM_CARD_STATE.ACTIVE;
      if (confirmedByItemId[itemId]) return ITEM_CARD_STATE.CONFIRMED;
      return ITEM_CARD_STATE.IDLE;
    },
    [activeItemId, confirmedByItemId],
  );

  const activate = useCallback((item: Item) => {
    setActiveItemId(item.id);
    setSelectedUnit(autoSelectUnitId(item));
    setConfirmedByItemId((prev) => {
      if (!prev[item.id]) return prev;
      const next = { ...prev };
      delete next[item.id];
      return next;
    });
  }, []);

  const selectUnit = useCallback((unitId: string) => {
    setSelectedUnit(unitId);
  }, []);

  const resetActive = useCallback(() => {
    setActiveItemId(null);
    setSelectedUnit(null);
  }, []);

  const markConfirmed = useCallback((itemId: number, unitId: string, qty: number) => {
    setConfirmedByItemId((prev) => ({
      ...prev,
      [itemId]: { unitId, qty },
    }));
    setActiveItemId(null);
    setSelectedUnit(null);
  }, []);

  const reopenConfirmed = useCallback((item: Item) => {
    const snap = confirmedByItemId[item.id];
    setActiveItemId(item.id);
    setSelectedUnit(null);
    setConfirmedByItemId((prev) => {
      const next = { ...prev };
      delete next[item.id];
      return next;
    });
    return snap?.qty ?? 1;
  }, [confirmedByItemId]);

  const clearConfirmed = useCallback((itemId: number) => {
    setConfirmedByItemId((prev) => {
      if (!prev[itemId]) return prev;
      const next = { ...prev };
      delete next[itemId];
      return next;
    });
  }, []);

  return {
    activeItemId,
    selectedUnit,
    confirmedByItemId,
    cardStateFor,
    activate,
    selectUnit,
    resetActive,
    markConfirmed,
    reopenConfirmed,
    clearConfirmed,
    setSelectedUnit,
  };
}
