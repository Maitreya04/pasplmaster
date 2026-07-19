export type VisitOutcome = 'order_placed' | 'payment_collected' | 'follow_up' | 'no_purchase';

export interface WorkdayState {
  active: boolean;
  id?: string;
  date?: string;
  started_at?: string;
  ended_at?: string | null;
  visits_count?: number;
  orders_total?: number;
}

export interface ActiveVisit {
  id: string;
  customer_id: number;
  customer_name: string;
  customer_city: string | null;
  started_at: string;
}

export interface FieldActivityWorkdayRow {
  salesman_user_id: number;
  salesman_name: string;
  started_at: string | null;
  ended_at: string | null;
  visits_count: number | null;
  orders_total: number | null;
  last_visit_at: string | null;
}

export interface FieldActivityVisitRow {
  id: string;
  started_at: string;
  ended_at: string | null;
  duration_minutes: number | null;
  outcome: VisitOutcome | null;
  notes: string | null;
  interaction_type: 'field' | 'phone' | 'walkin';
  salesman_name: string;
  customer_name: string;
  customer_city: string | null;
}

export interface FieldActivityDashboard {
  date: string;
  workdays: FieldActivityWorkdayRow[];
  visits: FieldActivityVisitRow[];
}
