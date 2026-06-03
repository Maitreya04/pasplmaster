import type { DeskOrderRow } from '../../../hooks/useBillingDeskOrders';

export const DESK_STATUS_TOOLTIPS: Record<DeskOrderRow['deskStatus'], string> = {
  unassigned: 'Click Assign — pickers appear right on this card.',
  picking: 'Picker is scanning items in the warehouse.',
  checking: 'Pick finished — at the check table or ready to dispatch.',
  no_ack: 'Assigned but picker has not started — monitor, re-assign, or complete only if needed.',
  submitted: 'Sales submitted — bill from the live queue on the left.',
  flagged: 'Picker raised an issue — acknowledge or fix the flagged lines.',
};

export const DESK_TAB_TOOLTIPS = {
  assign: 'Approved orders with no picker yet',
  picking: 'Assigned orders — waiting to start or picking now',
  resolve: 'Pick finished — verify, resolve flags, and finalise',
  completed: 'Bill saved — billing handoff complete',
} as const;
