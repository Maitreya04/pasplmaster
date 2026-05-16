import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase/client';
import { useAuth } from '../context/AuthContext';
import type { ClaimStage } from '../types';

/** Heartbeat interval: 25 seconds */
const HEARTBEAT_INTERVAL_MS = 25_000;

interface ClaimResult {
  success: boolean;
  claim_id?: number;
  claim_version?: number;
  reclaimed?: boolean;
  reason?: string;
  claimed_by?: string;
  claimed_at?: string;
  last_heartbeat_at?: string;
  /** Present when reason is locked_by_sales_edit */
  locked_by_name?: string;
}

interface UseWorkClaimReturn {
  /** Current claim ID (null if not claimed by me) */
  claimId: number | null;
  /** Whether this user currently holds the claim */
  isClaimedByMe: boolean;
  /** Attempt to claim the order. Returns claim result. */
  claim: () => Promise<ClaimResult>;
  /** Release the claim (navigating away, giving up). */
  release: () => Promise<void>;
  /** Error from claim/heartbeat operations */
  error: string | null;
}

/**
 * Hook for managing a work claim on an order for a specific stage.
 *
 * Handles:
 * - Claiming via RPC
 * - Automatic heartbeat every 25 seconds while claim is active
 * - Page visibility-aware heartbeat (pause when hidden, immediate on visible)
 * - Release on unmount / navigation away
 * - Re-claiming when returning to page (same user)
 */
export function useWorkClaim(
  orderId: number | null,
  stage: ClaimStage,
): UseWorkClaimReturn {
  const { userId } = useAuth();
  const [claimId, setClaimId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Refs for cleanup
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const claimIdRef = useRef<number | null>(null);
  const userIdRef = useRef<number | null>(null);

  // Keep refs in sync
  useEffect(() => {
    claimIdRef.current = claimId;
  }, [claimId]);
  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  const stopHeartbeat = useCallback(() => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  }, []);

  // ── Send heartbeat ──
  const sendHeartbeat = useCallback(async () => {
    const cid = claimIdRef.current;
    const uid = userIdRef.current;
    if (!cid || !uid) return;

    try {
      const { data, error: rpcError } = await supabase.rpc('heartbeat_claim', {
        p_claim_id: cid,
        p_user_id: uid,
      });
      if (rpcError) {
        console.warn('[useWorkClaim] Heartbeat RPC error:', rpcError.message);
        return;
      }
      const result = data as { success: boolean; reason?: string };
      if (!result.success) {
        // Claim was expired or released externally
        console.warn('[useWorkClaim] Heartbeat failed:', result.reason);
        setClaimId(null);
        stopHeartbeat();
      }
    } catch {
      // Silent fail — network issue, will retry on next interval
    }
  }, [stopHeartbeat]);

  // ── Start/stop heartbeat ──
  const startHeartbeat = useCallback(() => {
    stopHeartbeat();
    heartbeatRef.current = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
  }, [sendHeartbeat, stopHeartbeat]);

  // ── Visibility change handler ──
  useEffect(() => {
    function handleVisibility() {
      if (!claimIdRef.current) return;

      if (document.hidden) {
        // Tab hidden — stop heartbeat to save resources
        stopHeartbeat();
      } else {
        // Tab visible again — send immediate heartbeat and restart interval
        sendHeartbeat();
        startHeartbeat();
      }
    }

    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [sendHeartbeat, startHeartbeat, stopHeartbeat]);

  // ── Claim order ──
  const claim = useCallback(async (): Promise<ClaimResult> => {
    if (!orderId || !userId) {
      return { success: false, reason: 'Missing orderId or userId' };
    }

    setError(null);

    try {
      const { data, error: rpcError } = await supabase.rpc('claim_order', {
        p_order_id: orderId,
        p_stage: stage,
        p_user_id: userId,
      });

      if (rpcError) {
        const msg = rpcError.message || 'Failed to claim order';
        setError(msg);
        return { success: false, reason: msg };
      }

      const result = data as ClaimResult;
      if (result.success && result.claim_id) {
        setClaimId(result.claim_id);
        startHeartbeat();
      } else if (!result.success) {
        setError(result.reason || 'Claim failed');
      }

      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(msg);
      return { success: false, reason: msg };
    }
  }, [orderId, userId, stage, startHeartbeat]);

  // ── Release claim ──
  const release = useCallback(async () => {
    const cid = claimIdRef.current;
    const uid = userIdRef.current;
    if (!cid || !uid) return;

    stopHeartbeat();
    setClaimId(null);

    try {
      await supabase.rpc('release_claim', {
        p_claim_id: cid,
        p_user_id: uid,
      });
    } catch {
      // Best effort — if release fails, heartbeat expiry will handle it
    }
  }, [stopHeartbeat]);

  // ── Cleanup on unmount ──
  useEffect(() => {
    return () => {
      stopHeartbeat();

      // Fire-and-forget release when component unmounts
      const cid = claimIdRef.current;
      const uid = userIdRef.current;
      if (cid && uid) {
        // Fire-and-forget release
        void supabase.rpc('release_claim', {
          p_claim_id: cid,
          p_user_id: uid,
        });
      }
    };
  }, [stopHeartbeat]);

  return {
    claimId,
    isClaimedByMe: claimId !== null,
    claim,
    release,
    error,
  };
}
