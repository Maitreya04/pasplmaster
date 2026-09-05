import { useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import {
  endCustomerVisit,
  startCustomerVisit,
  type StartVisitResult,
} from '../lib/visit/visitService';
import type { VisitOutcome } from '../types/visit';
import { useActiveVisit } from './useWorkday';

export function useVisitTracking() {
  const { userId } = useAuth();
  const { activeVisit, invalidate, setActiveVisit, isLoading, isError, refetch } = useActiveVisit();
  const startMutation = useMutation({
    mutationFn: async (params: {
      customerId: number;
      interactionType?: 'field' | 'phone' | 'walkin';
    }): Promise<StartVisitResult> => {
      return startCustomerVisit({
        userId,
        customerId: params.customerId,
        interactionType: params.interactionType,
      });
    },
    onSuccess: async (result) => {
      if (result.success) {
        await refetch();
        invalidate();
      }
    },
  });

  const endMutation = useMutation({
    mutationFn: async (params: {
      visitId: string;
      outcome: VisitOutcome;
      notes?: string;
      ordersPlaced?: number;
      paymentCollectedAmount?: number;
      ledgerShared?: boolean;
    }) => {
      await endCustomerVisit({
        userId,
        visitId: params.visitId,
        outcome: params.outcome,
        notes: params.notes,
        ordersPlaced: params.ordersPlaced,
        paymentCollectedAmount: params.paymentCollectedAmount,
        ledgerShared: params.ledgerShared,
      });
    },
    onSuccess: () => {
      setActiveVisit(null);
      invalidate();
    },
  });

  const requestStartVisit = useCallback(
    async (customerId: number, interactionType: 'field' | 'phone' | 'walkin' = 'field') => {
      const result = await startMutation.mutateAsync({ customerId, interactionType });

      if (result.success) {
        return { status: 'started' as const, visitId: result.visitId };
      }

      if (result.error === 'visit_already_active') {
        await refetch();
        invalidate();
        return { status: 'already_active' as const };
      }

      return { status: 'error' as const, error: result.error };
    },
    [invalidate, refetch, startMutation],
  );

  return {
    activeVisit,
    isLoadingVisit: isLoading,
    visitLoadFailed: isError,
    refreshVisit: refetch,
    requestStartVisit,
    endVisit: endMutation.mutateAsync,
    isStarting: startMutation.isPending,
    isEnding: endMutation.isPending,
  };
}
