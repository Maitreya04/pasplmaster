import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase/client';

export interface FinancialYearRow {
  id: number;
  label: string;
  starts_on: string;
  ends_on: string;
  history_fyear_key: string;
  is_active: boolean;
  is_locked: boolean;
}

export interface SalesTargetRow {
  product_group: string;
  annual_target_lakhs: number;
  category: string | null;
  financial_year_label: string;
  updated_at: string | null;
}

export interface EditableSalesTargetRow {
  product_group: string;
  annual_target_lakhs: number;
  category?: string | null;
}

async function fetchFinancialYears(): Promise<FinancialYearRow[]> {
  const { data, error } = await supabase
    .from('financial_years')
    .select('id, label, starts_on, ends_on, history_fyear_key, is_active, is_locked')
    .order('starts_on', { ascending: false });
  if (error) throw error;
  return (data ?? []) as FinancialYearRow[];
}

async function fetchTargets(userId: number, financialYearLabel: string): Promise<SalesTargetRow[]> {
  const { data, error } = await supabase.rpc('admin_get_sales_targets_for_user', {
    p_user_id: userId,
    p_financial_year_label: financialYearLabel,
  });
  if (error) throw error;
  return (data ?? []) as SalesTargetRow[];
}

export function useFinancialYears() {
  return useQuery({
    queryKey: ['financial-years'],
    queryFn: fetchFinancialYears,
    staleTime: 60_000,
  });
}

export function useUserSalesTargets(userId: number | null, financialYearLabel: string | null) {
  return useQuery({
    queryKey: ['admin-sales-targets', userId, financialYearLabel],
    queryFn: () => fetchTargets(userId as number, financialYearLabel as string),
    enabled: userId != null && Boolean(financialYearLabel),
    staleTime: 30_000,
  });
}

export function useSaveUserSalesTargets() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      userName: string;
      financialYearLabel: string;
      rows: EditableSalesTargetRow[];
    }) => {
      const cleaned = input.rows
        .map((row) => ({
          salesperson_name: input.userName,
          product_group: row.product_group.trim(),
          annual_target_lakhs: Number(row.annual_target_lakhs || 0),
          category: row.category?.trim() || null,
        }))
        .filter((row) => row.product_group && row.annual_target_lakhs > 0);

      const { data, error } = await supabase.rpc('admin_upsert_sales_targets', {
        p_financial_year_label: input.financialYearLabel,
        p_rows: cleaned,
        p_file_name: 'manual-user-management',
      });
      if (error) throw error;
      if (!data?.success) {
        throw new Error(String(data?.error ?? 'Could not save targets'));
      }
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-sales-targets'] });
      void queryClient.invalidateQueries({ queryKey: ['user-activation-status'] });
      void queryClient.invalidateQueries({ queryKey: ['sales-dashboard'] });
    },
  });
}

export function useCopyPreviousYearTargets() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      userId: number;
      fromFinancialYearLabel: string;
      toFinancialYearLabel: string;
    }) => {
      const { data, error } = await supabase.rpc('admin_copy_sales_targets_previous_year', {
        p_user_id: input.userId,
        p_from_financial_year_label: input.fromFinancialYearLabel,
        p_to_financial_year_label: input.toFinancialYearLabel,
      });
      if (error) throw error;
      if (!data?.success) {
        throw new Error(String(data?.error ?? 'Could not copy targets'));
      }
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-sales-targets'] });
      void queryClient.invalidateQueries({ queryKey: ['user-activation-status'] });
      void queryClient.invalidateQueries({ queryKey: ['sales-dashboard'] });
    },
  });
}
