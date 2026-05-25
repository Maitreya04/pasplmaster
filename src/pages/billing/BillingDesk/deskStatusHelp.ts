import type { DeskOrderRow } from '../../../hooks/useBillingDeskOrders';

export const DESK_STATUS_TOOLTIPS: Record<DeskOrderRow['deskStatus'], string> = {
  unassigned: 'Billed and waiting — assign a picker from this row.',
  picking: 'Picker is scanning items in the warehouse.',
  checking: 'Pick finished — at the check table or ready to dispatch.',
  no_ack: 'Assigned but picker has not started — try Notify or Re-assign.',
  submitted: 'Sales submitted — bill from the live queue on the left.',
  flagged: 'Picker raised an issue — resolve in the flags strip above.',
};

export const DESK_TAB_TOOLTIPS = {
  all: 'All post-bill orders for today',
  picking: 'Approved, picking, or waiting for picker ack',
  stale: 'Assigned but no heartbeat — may need a nudge',
} as const;
