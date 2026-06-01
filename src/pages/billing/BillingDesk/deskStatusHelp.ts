import type { DeskOrderRow } from '../../../hooks/useBillingDeskOrders';

export const DESK_STATUS_TOOLTIPS: Record<DeskOrderRow['deskStatus'], string> = {
  unassigned: 'Click Assign — pickers appear right on this card.',
  picking: 'Picker is scanning items in the warehouse.',
  checking: 'Pick finished — at the check table or ready to dispatch.',
  no_ack: 'Assigned but picker has not started — Complete, Re-assign, or notify.',
  submitted: 'Sales submitted — bill from the live queue on the left.',
  flagged: 'Picker raised an issue — acknowledge or fix the flagged lines.',
};

export const DESK_TAB_TOOLTIPS = {
  resolve: 'Post-pick flags and billing issues — highest priority',
  assign: 'Assign pickers · re-assign · skip or complete stuck pre-picks',
  picking: 'Active warehouse picks — including in-pick price or stock flags',
  review: 'Pick finished — verify bill before finalising',
  completed: 'Bill saved — billing handoff complete',
} as const;
