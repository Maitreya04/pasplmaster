import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase/client';
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
  current_fy_target_lakhs?: number | null;
}

interface RpcResult {
  success: boolean;
  error?: string;
  user_id?: number;
  full_name?: string;
  requires_auth_cleanup?: boolean;
  requires_auth_sync?: boolean;
  auth_id?: string;
}

export interface CreateUserInput {
  fullName: string;
  role: Exclude<UserRole, 'admin'>;
  branch: StockLocationCode;
  stationLabel?: string;
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
        p_generate_invite_code: false,
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
