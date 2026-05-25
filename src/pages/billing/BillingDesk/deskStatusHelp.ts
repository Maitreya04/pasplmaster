import type { DeskOrderRow } from '../../../hooks/useBillingDeskOrders';

export const DESK_STATUS_TOOLTIPS: Record<DeskOrderRow['deskStatus'], string> = {
  unassigned: 'Click Assign — pickers appear right on this card.',
  picking: 'Picker is scanning items in the warehouse.',
  checking: 'Pick finished — at the check table or ready to dispatch.',
  no_ack: 'Assigned but picker has not started — Re-assign on this card.',
  submitted: 'Sales submitted — bill from the live queue on the left.',
  flagged: 'Picker raised an issue — resolve in the flags strip above.',
};

export const DESK_TAB_TOOLTIPS = {
  all: 'All post-bill orders for today',
  picking: 'Assign pickers · edit bills · track in-progress picks',
  stale: 'Stuck picks — re-assign, notify, or mark complete',
  completed: 'Pick finished — check table or dispatch',
} as const;
