import { useCallback, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import { captureCurrentPosition } from '../lib/geo/geolocation';
import {
  endCustomerVisit,
  startCustomerVisit,
  type StartVisitResult,
} from '../lib/visit/visitService';
import type { GeofenceEvaluation, VisitOutcome, VisitOverrideReason } from '../types/visit';
import { useActiveVisit } from './useWorkday';

export function useVisitTracking() {
  const { userId } = useAuth();
  const { activeVisit, invalidate, setActiveVisit } = useActiveVisit();
  const [pendingEvaluation, setPendingEvaluation] = useState<GeofenceEvaluation | null>(null);
  const [pendingCustomerId, setPendingCustomerId] = useState<number | null>(null);

  const startMutation = useMutation({
    mutationFn: async (params: {
      customerId: number;
      acknowledgeWarn?: boolean;
      overrideReason?: VisitOverrideReason;
      interactionType?: 'field' | 'phone' | 'walkin';
      skipGps?: boolean;
    }): Promise<StartVisitResult> => {
      let lat: number | null = null;
      let lng: number | null = null;
      let accuracy: number | null = null;

      if (!params.skipGps && params.interactionType !== 'phone') {
        try {
          const pos = await captureCurrentPosition();
          lat = pos.latitude;
          lng = pos.longitude;
          accuracy = pos.accuracy;
        } catch {
          // Visit proceeds without GPS — never block per design doc.
        }
      }

      return startCustomerVisit({
        userId,
        customerId: params.customerId,
        lat,
        lng,
        accuracyM: accuracy,
        acknowledgeWarn: params.acknowledgeWarn,
        overrideReason: params.overrideReason,
        interactionType: params.interactionType,
      });
    },
    onSuccess: (result) => {
      if (result.success) {
        setPendingEvaluation(null);
        setPendingCustomerId(null);
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

      if (result.error === 'warn_ack_required') {
        setPendingEvaluation(result.evaluation ?? null);
        setPendingCustomerId(customerId);
        return { status: 'warn' as const, evaluation: result.evaluation };
      }

      if (result.error === 'override_required') {
        setPendingEvaluation(result.evaluation ?? null);
        setPendingCustomerId(customerId);
        return { status: 'override' as const, evaluation: result.evaluation };
      }

      if (result.error === 'visit_already_active') {
        invalidate();
        return { status: 'already_active' as const };
      }

      return { status: 'error' as const, error: result.error };
    },
    [invalidate, startMutation],
  );

  const confirmWarnStart = useCallback(async () => {
    if (pendingCustomerId == null) return;
    const result = await startMutation.mutateAsync({
      customerId: pendingCustomerId,
      acknowledgeWarn: true,
    });
    if (result.success) {
      setPendingEvaluation(null);
      setPendingCustomerId(null);
    }
    return result;
  }, [pendingCustomerId, startMutation]);

  const confirmOverrideStart = useCallback(
    async (reason: VisitOverrideReason) => {
      if (pendingCustomerId == null) return;
      const result = await startMutation.mutateAsync({
        customerId: pendingCustomerId,
        overrideReason: reason,
        acknowledgeWarn: true,
      });
      if (result.success) {
        setPendingEvaluation(null);
        setPendingCustomerId(null);
      }
      return result;
    },
    [pendingCustomerId, startMutation],
  );

  const cancelPendingStart = useCallback(() => {
    setPendingEvaluation(null);
    setPendingCustomerId(null);
  }, []);

  return {
    activeVisit,
    pendingEvaluation,
    requestStartVisit,
    confirmWarnStart,
    confirmOverrideStart,
    cancelPendingStart,
    endVisit: endMutation.mutateAsync,
    isStarting: startMutation.isPending,
    isEnding: endMutation.isPending,
  };
}
