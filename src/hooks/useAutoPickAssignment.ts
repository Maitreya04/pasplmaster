import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase/client';
import { useAuth } from '../context/AuthContext';
import { subscribeToTable } from '../lib/realtime';
import {
  isBillingQueueEventsEnabled,
  isDirectTableRealtimeEnabled,
  isSupabasePostgresChangesEnabled,
} from '../lib/realtimePolicy';

const QUEUE_EVENTS_ON = isSupabasePostgresChangesEnabled() && isBillingQueueEventsEnabled();
const DIRECT_TABLE_REALTIME_ON = isDirectTableRealtimeEnabled();

export type AutoPickAssignStatus = 'idle' | 'assigning' | 'waiting' | 'error';

export interface AssignNextPickingOrderResult {
  success: boolean;
  order_id?: number;
  claim_id?: number;
  resumed?: boolean;
  reason?: string;
}

interface UseAutoPickAssignmentOptions {
  /** When false, skip auto-retry subscriptions (e.g. while navigating away). */
  enabled?: boolean;
}

interface UseAutoPickAssignmentReturn {
  status: AutoPickAssignStatus;
  errorMessage: string | null;
  assignNext: () => Promise<AssignNextPickingOrderResult | null>;
  reset: () => void;
}

export function useAutoPickAssignment(
  options: UseAutoPickAssignmentOptions = {},
): UseAutoPickAssignmentReturn {
  const { enabled = true } = options;
  const { userId } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<AutoPickAssignStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const assigningRef = useRef(false);
  const statusRef = useRef(status);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const assignNext = useCallback(async (): Promise<AssignNextPickingOrderResult | null> => {
    if (!userId || assigningRef.current) return null;
    assigningRef.current = true;
    setStatus('assigning');
    setErrorMessage(null);

    try {
      const { data, error } = await supabase.rpc('assign_next_picking_order', {
        p_user_id: userId,
      });
      if (error) throw error;

      const result = data as AssignNextPickingOrderResult;
      if (result.success && result.order_id != null) {
        void queryClient.invalidateQueries({ queryKey: ['claimable-orders'] });
        navigate(`/picking/pick/${result.order_id}`, { replace: true });
        return result;
      }

      if (result.reason === 'queue_empty') {
        setStatus('waiting');
        return result;
      }

      throw new Error(result.reason ?? 'assign_failed');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to assign order';
      setStatus('error');
      setErrorMessage(message);
      return null;
    } finally {
      assigningRef.current = false;
    }
  }, [navigate, queryClient, userId]);

  const reset = useCallback(() => {
    setStatus('idle');
    setErrorMessage(null);
  }, []);

  // When waiting, retry assign when approved orders or picking claims change.
  useEffect(() => {
    if (!enabled || !userId || status !== 'waiting') return;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRetry = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (statusRef.current === 'waiting' && !assigningRef.current) {
          void assignNext();
        }
      }, 750);
    };

    const subscriptions: Array<() => void> = [];

    if (QUEUE_EVENTS_ON) {
      subscriptions.push(
        subscribeToTable({
          channelName: `auto-pick-events:${userId}`,
          table: 'queue_events',
          filter: 'stage=eq.picking',
          events: ['INSERT'],
          onChange: scheduleRetry,
          onReconnect: scheduleRetry,
        }),
      );
    } else if (DIRECT_TABLE_REALTIME_ON) {
      subscriptions.push(
        subscribeToTable({
          channelName: `auto-pick-orders:${userId}`,
          table: 'orders',
          onChange: scheduleRetry,
          onReconnect: scheduleRetry,
        }),
        subscribeToTable({
          channelName: `auto-pick-claims:${userId}`,
          table: 'work_claims',
          onChange: scheduleRetry,
          onReconnect: scheduleRetry,
        }),
      );
    } else {
      const pollId = window.setInterval(scheduleRetry, 5_000);
      subscriptions.push(() => window.clearInterval(pollId));
    }

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      for (const unsubscribe of subscriptions) unsubscribe();
    };
  }, [assignNext, enabled, status, userId]);

  return { status, errorMessage, assignNext, reset };
}
