import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase/client';

/** Matches the 3-minute heartbeat timeout used by claim_order / useClaimableOrders. */
export const PICKING_CLAIM_STALE_MS = 3 * 60 * 1000;

export interface PickingClaimInfo {
  claim_id: number;
  claimed_by_user_id: number;
  claimed_by_name: string;
  claimed_at: string;
  last_heartbeat_at: string;
  is_stale: boolean;
}

export function usePickingClaim(orderId: number | null, enabled = true) {
  return useQuery<PickingClaimInfo | null>({
    queryKey: ['picking-claim', orderId],
    enabled: orderId != null && enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('work_claims')
        .select(
          'id, claimed_by_user_id, claimed_at, last_heartbeat_at, users!work_claims_claimed_by_user_id_fkey(full_name)',
        )
        .eq('order_id', orderId!)
        .eq('stage', 'picking')
        .eq('status', 'active')
        .maybeSingle();

      if (error) throw error;
      if (!data) return null;

      const userRecord = data.users as unknown as { full_name: string } | null;
      const heartbeatAge = Date.now() - new Date(data.last_heartbeat_at).getTime();

      return {
        claim_id: Number(data.id),
        claimed_by_user_id: Number(data.claimed_by_user_id),
        claimed_by_name: userRecord?.full_name ?? 'Unknown',
        claimed_at: data.claimed_at,
        last_heartbeat_at: data.last_heartbeat_at,
        is_stale: heartbeatAge > PICKING_CLAIM_STALE_MS,
      };
    },
    staleTime: 0,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
}
