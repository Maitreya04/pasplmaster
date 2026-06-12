import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase/client';
import { branchDisplayName } from '../lib/auth/phoneAuth';
import {
  adminUserManagementErrorMessage,
  callAdminUserAuth,
} from '../lib/admin/userManagement';
import type { StockLocationCode, UserRole } from '../types';

export interface UserActivationRow {
  id: number;
  full_name: string;
  role: string;
  stock_location_code: StockLocationCode | null;
  station_label: string | null;
  phone: string | null;
  auth_id: string | null;
  activated_at: string | null;
  invite_code: string | null;
  invite_code_expires_at: string | null;
  is_active: boolean;
}

interface RpcResult {
  success: boolean;
  error?: string;
  user_id?: number;
  full_name?: string;
  invite_code?: string;
  requires_auth_cleanup?: boolean;
  requires_auth_sync?: boolean;
  auth_id?: string;
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

export interface CreateUserInput {
  fullName: string;
  role: Exclude<UserRole, 'admin'>;
  branch: StockLocationCode;
  stationLabel?: string;
  generateInviteCode?: boolean;
}

export interface UpdateUserInput {
  userId: number;
  fullName: string;
  role: Exclude<UserRole, 'admin'>;
  branch: StockLocationCode;
  stationLabel?: string;
}

function getSupabaseConfig() {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!supabaseUrl || !anonKey) {
    throw new Error('Supabase is not configured');
  }
  return { supabaseUrl, anonKey };
}

async function fetchActivationRows(): Promise<UserActivationRow[]> {
  const { data, error } = await supabase.rpc('list_user_activation_status');
  if (error) throw error;
  return (data ?? []) as UserActivationRow[];
}

async function runRpc<T extends RpcResult>(
  fn: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  if (!data?.success) {
    throw new Error(adminUserManagementErrorMessage(data?.error));
  }
  return data as T;
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

export function useCreateUser(actorUserId: number | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateUserInput) => {
      if (!actorUserId) throw new Error('Not signed in');
      return runRpc<RpcResult>('admin_create_user', {
        p_actor_user_id: actorUserId,
        p_full_name: input.fullName.trim(),
        p_role: input.role,
        p_branch: input.branch,
        p_station_label: input.stationLabel?.trim() || null,
        p_generate_invite_code: input.generateInviteCode ?? false,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['user-activation-status'] });
    },
  });
}

export function useUpdateUser(actorUserId: number | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateUserInput) => {
      if (!actorUserId) throw new Error('Not signed in');

      const result = await runRpc<RpcResult>('admin_update_user', {
        p_actor_user_id: actorUserId,
        p_user_id: input.userId,
        p_full_name: input.fullName.trim(),
        p_role: input.role,
        p_branch: input.branch,
        p_station_label: input.stationLabel?.trim() || '',
      });

      return result;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['user-activation-status'] });
    },
  });
}

export function useDeactivateUser(actorUserId: number | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (targetUserId: number) => {
      if (!actorUserId) throw new Error('Not signed in');
      const result = await runRpc<RpcResult>('admin_deactivate_user', {
        p_actor_user_id: actorUserId,
        p_user_id: targetUserId,
      });

      if (result.requires_auth_cleanup && result.auth_id) {
        const { supabaseUrl, anonKey } = getSupabaseConfig();
        const authResult = await callAdminUserAuth({
          supabaseUrl,
          anonKey,
          action: 'delete_auth_user',
          actorUserId,
          userId: targetUserId,
          authId: result.auth_id,
        });
        if (authResult.error) {
          throw new Error(adminUserManagementErrorMessage(authResult.error));
        }
      }

      return result;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['user-activation-status'] });
    },
  });
}

export function useRevokeUserAccess(actorUserId: number | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (targetUserId: number) => {
      if (!actorUserId) throw new Error('Not signed in');
      const result = await runRpc<RpcResult>('admin_revoke_user_access', {
        p_actor_user_id: actorUserId,
        p_user_id: targetUserId,
      });

      if (result.auth_id) {
        const { supabaseUrl, anonKey } = getSupabaseConfig();
        const authResult = await callAdminUserAuth({
          supabaseUrl,
          anonKey,
          action: 'delete_auth_user',
          actorUserId,
          userId: targetUserId,
          authId: result.auth_id,
        });
        if (authResult.error) {
          throw new Error(adminUserManagementErrorMessage(authResult.error));
        }
      }

      return result;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['user-activation-status'] });
    },
  });
}

export function useReactivateUser(actorUserId: number | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (targetUserId: number) => {
      if (!actorUserId) throw new Error('Not signed in');
      return runRpc<RpcResult>('admin_reactivate_user', {
        p_actor_user_id: actorUserId,
        p_user_id: targetUserId,
      });
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
  const header = 'full_name,role,branch,status,invite_code,phone,station_label';
  const lines = rows.map((row) =>
    [
      JSON.stringify(row.full_name),
      row.role,
      row.stock_location_code ?? '',
      row.is_active ? (row.auth_id ? 'activated' : 'pending') : 'deactivated',
      row.invite_code ?? '',
      row.phone ?? '',
      row.station_label ?? '',
    ].join(','),
  );
  return [header, ...lines].join('\n');
}
