import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase/client';
import { branchDisplayName } from '../lib/auth/phoneAuth';
import type { StockLocationCode } from '../types';

export interface UserActivationRow {
  id: number;
  full_name: string;
  role: string;
  stock_location_code: StockLocationCode | null;
  phone: string | null;
  auth_id: string | null;
  activated_at: string | null;
  invite_code: string | null;
  invite_code_expires_at: string | null;
  is_active: boolean;
}

interface GenerateAllResult {
  success: boolean;
  count?: number;
  users?: Array<{
    user_id: number;
    full_name: string;
    role: string;
    branch: string | null;
    invite_code: string;
  }>;
  error?: string;
}

async function fetchActivationRows(): Promise<UserActivationRow[]> {
  const { data, error } = await supabase.rpc('list_user_activation_status');
  if (error) throw error;
  return (data ?? []) as UserActivationRow[];
}

export function useUserActivationStatus() {
  return useQuery({
    queryKey: ['user-activation-status'],
    queryFn: fetchActivationRows,
    staleTime: 30_000,
  });
}

export function useGenerateInviteCode(actorUserId: number | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (targetUserId: number) => {
      if (!actorUserId) throw new Error('Not signed in');
      const { data, error } = await supabase.rpc('generate_invite_code', {
        p_user_id: targetUserId,
        p_actor_user_id: actorUserId,
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error ?? 'generate_failed');
      return data as { invite_code: string; full_name: string };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['user-activation-status'] });
    },
  });
}

export function useGenerateAllInviteCodes(actorUserId: number | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!actorUserId) throw new Error('Not signed in');
      const { data, error } = await supabase.rpc('generate_all_invite_codes', {
        p_actor_user_id: actorUserId,
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error ?? 'generate_failed');
      return data as GenerateAllResult;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['user-activation-status'] });
    },
  });
}

export function formatInviteWhatsApp(row: UserActivationRow): string {
  const branch = branchDisplayName(row.stock_location_code);
  if (!row.invite_code) {
    return `${row.full_name} (${row.role}, ${branch}): ask admin for invite code`;
  }
  return `${row.full_name} ji, your PASPL activation code is ${row.invite_code} (${row.role}, ${branch}). Open the app → Activate with invite code.`;
}

export function buildInviteCsv(rows: UserActivationRow[]): string {
  const header = 'full_name,role,branch,invite_code,activated,phone';
  const lines = rows.map((row) =>
    [
      JSON.stringify(row.full_name),
      row.role,
      row.stock_location_code ?? '',
      row.invite_code ?? '',
      row.auth_id ? 'yes' : 'no',
      row.phone ?? '',
    ].join(','),
  );
  return [header, ...lines].join('\n');
}
