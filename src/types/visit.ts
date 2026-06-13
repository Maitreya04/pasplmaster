export type FencePhase = 'none' | 'learning' | 'active';
export type GeofenceZone = 'none' | 'soft' | 'warn' | 'hard' | 'accuracy_suspended';
export type VisitOutcome = 'order_placed' | 'payment_collected' | 'follow_up' | 'no_purchase';
export type VisitOverrideReason =
  | 'customer_moved'
  | 'gps_not_working'
  | 'different_branch_godown'
  | 'customer_met_me_here';

export interface GeofenceEvaluation {
  allowed: boolean;
  zone: GeofenceZone;
  distance_m: number | null;
  fence_phase: FencePhase;
  gps_accuracy_exceeded_fence: boolean;
  requires_override: boolean;
  requires_warn_ack: boolean;
}

export interface WorkdayState {
  active: boolean;
  id?: string;
  date?: string;
  started_at?: string;
  ended_at?: string | null;
  visits_count?: number;
  orders_total?: number;
  start_gps_lat?: number | null;
  start_gps_lng?: number | null;
}

export interface ActiveVisit {
  id: string;
  customer_id: number;
  customer_name: string;
  customer_city: string | null;
  started_at: string;
  gps_lat: number | null;
  gps_lng: number | null;
}

export interface NearbyGeofencedCustomer {
  customer_id: number;
  customer_name: string;
  customer_city: string | null;
  distance_m: number;
}

export interface FieldActivityWorkdayRow {
  salesman_user_id: number;
  salesman_name: string;
  started_at: string | null;
  ended_at: string | null;
  visits_count: number | null;
  orders_total: number | null;
  start_gps_lat: number | null;
  start_gps_lng: number | null;
  last_visit_lat: number | null;
  last_visit_lng: number | null;
  last_visit_at: string | null;
}

export interface FieldActivityVisitRow {
  id: string;
  started_at: string;
  ended_at: string | null;
  duration_minutes: number | null;
  outcome: VisitOutcome | null;
  gps_lat: number | null;
  gps_lng: number | null;
  distance_from_fence_m: number | null;
  required_override: boolean;
  salesman_name: string;
  customer_name: string;
  customer_city: string | null;
}

export interface FieldActivityOverrideRow {
  override_reason: VisitOverrideReason;
  distance_at_override_m: number | null;
  created_at: string;
  salesman_name: string;
  customer_name: string;
}

export interface FieldActivityDashboard {
  date: string;
  workdays: FieldActivityWorkdayRow[];
  visits: FieldActivityVisitRow[];
  overrides: FieldActivityOverrideRow[];
}

export interface VisitRoutePoint {
  id: string;
  started_at: string;
  lat: number;
  lng: number;
  customer_name: string;
}
