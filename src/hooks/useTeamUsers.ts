import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase/client';
import type { AppUser, UserRole } from '../types';

/**
 * Fetch active team members from the users table.
 * Optionally filter by role.
 */
export function useTeamUsers(role?: UserRole) {
  return useQuery<AppUser[]>({
    queryKey: ['users', role ?? 'all'],
    queryFn: async () => {
      let q = supabase
        .from('users')
        .select('*')
        .eq('is_active', true);
      if (role) q = q.eq('role', role);
      const { data, error } = await q.order('full_name');
      if (error) throw error;
      return data as AppUser[];
    },
    staleTime: 5 * 60 * 1000, // 5 minutes — user list rarely changes
  });
}
