import { supabase } from '../supabase/client';
import type {
  ActiveVisit,
  FieldActivityDashboard,
  VisitOutcome,
  WorkdayState,
} from '../../types/visit';

function actorParam(userId: number | null | undefined): { p_actor_user_id?: number } {
  return userId != null ? { p_actor_user_id: userId } : {};
}

export async function fetchTodayWorkday(userId: number | null): Promise<WorkdayState> {
  const { data, error } = await supabase.rpc('get_today_workday', actorParam(userId));
  if (error) throw error;
  return (data ?? { active: false }) as WorkdayState;
}

export async function startWorkday(
  userId: number | null,
): Promise<WorkdayState> {
  // Prefer the clean no-geo signature. If PostgREST still has the temporary
  // lat/lng compatibility overload, retry with explicit null geo args so the
  // call uniquely resolves (PGRST203).
  let { data, error } = await supabase.rpc('start_workday', {
    ...actorParam(userId),
  });
  if (error?.code === 'PGRST203') {
    ({ data, error } = await supabase.rpc('start_workday', {
      p_lat: null,
      p_lng: null,
      ...actorParam(userId),
    }));
  }
  if (error) throw error;
  const payload = data as { success?: boolean; workday?: WorkdayState };
  if (!payload?.success) throw new Error('Could not start workday');
  return { active: true, ...payload.workday };
}

export async function endWorkday(userId: number | null): Promise<WorkdayState> {
  const { data, error } = await supabase.rpc('end_workday', actorParam(userId));
  if (error) throw error;
  const payload = data as { success?: boolean; workday?: WorkdayState };
  if (!payload?.success) throw new Error('No active workday');
  return { active: false, ...payload.workday };
}

export async function fetchActiveVisit(
  userId: number | null,
): Promise<ActiveVisit | null> {
  const { data, error } = await supabase.rpc('get_active_customer_visit', actorParam(userId));
  if (error) throw error;
  const payload = data as { active?: boolean; visit?: ActiveVisit };
  return payload?.active && payload.visit ? payload.visit : null;
}

export interface StartVisitParams {
  userId: number | null;
  customerId: number;
  interactionType?: 'field' | 'phone' | 'walkin';
}

export interface StartVisitResult {
  success: boolean;
  visitId?: string;
  error?: string;
}

export async function startCustomerVisit(params: StartVisitParams): Promise<StartVisitResult> {
  const baseArgs = {
    p_customer_id: params.customerId,
    p_interaction_type: params.interactionType ?? 'field',
    ...actorParam(params.userId),
  };

  // Prefer the clean no-geo signature. Retry with ignored geo args when the
  // temporary compatibility overload still makes PostgREST ambiguous.
  let { data, error } = await supabase.rpc('start_customer_visit', baseArgs);
  if (error?.code === 'PGRST203') {
    ({ data, error } = await supabase.rpc('start_customer_visit', {
      ...baseArgs,
      p_lat: null,
      p_lng: null,
      p_accuracy_m: null,
      p_acknowledge_warn: false,
      p_override_reason: null,
    }));
  }
  if (error) throw error;

  const payload = data as {
    success?: boolean;
    visit_id?: string;
    error?: string;
  };

  if (!payload.success) {
    return {
      success: false,
      error: payload.error,
    };
  }

  return { success: true, visitId: payload.visit_id };
}

export async function endCustomerVisit(params: {
  userId: number | null;
  visitId: string;
  outcome: VisitOutcome;
  notes?: string;
  ordersPlaced?: number;
  paymentCollectedAmount?: number;
  ledgerShared?: boolean;
}): Promise<void> {
  const { data, error } = await supabase.rpc('end_customer_visit', {
    p_visit_id: params.visitId,
    p_outcome: params.outcome,
    p_notes: params.notes ?? null,
    p_orders_placed: params.ordersPlaced ?? 0,
    p_payment_collected_amount: params.paymentCollectedAmount ?? 0,
    p_ledger_shared: params.ledgerShared ?? false,
    ...actorParam(params.userId),
  });
  if (error) throw error;
  const payload = data as { success?: boolean };
  if (!payload?.success) throw new Error('Could not end visit');
}

export async function fetchFieldActivityDashboard(date: string): Promise<FieldActivityDashboard> {
  const { data, error } = await supabase.rpc('get_field_activity_dashboard', { p_date: date });
  if (error) throw error;
  return data as FieldActivityDashboard;
}

export async function fetchCustomerLastVisit(
  customerId: number,
): Promise<{ last_visit_at: string | null; outcome: string | null } | null> {
  const { data, error } = await supabase.rpc('get_customer_last_visit', {
    p_customer_id: customerId,
  });
  if (error) throw error;
  if (!data || typeof data !== 'object') return null;
  return data as { last_visit_at: string | null; outcome: string | null };
}
