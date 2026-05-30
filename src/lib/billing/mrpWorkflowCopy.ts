/** Shared picker + billing copy for label MRP workflow. Keep wording consistent app-wide. */

export const MRP_SHEET_TITLE = 'MRP on label';
export const MRP_METRIC_LABEL = 'MRP on label';

export const MRP_SHEET_HEADING = 'What price is printed on the label?';
export const MRP_SHEET_SUBHEADING_MULTI =
  'Tap the amount that matches the physical label.';
export const MRP_SHEET_SUBHEADING_SINGLE =
  'Confirm the amount printed on the label.';
export const MRP_SHEET_SUBHEADING_BATCH = 'Tap the MRP on the batch you are picking now.';
export const MRP_SHEET_EMPTY =
  'No stock record for this SKU — enter the price printed on the label.';
export const MRP_SHEET_CUSTOM_TITLE = 'Enter price from label';
export const MRP_SHEET_CUSTOM_HINT =
  'Use this only if the label shows a different amount than the list.';
export const MRP_SHEET_CUSTOM_CONFIRM = (amount: number) =>
  `Use ₹${amount} from label`;

export const MRP_BADGE_BILLING_CONFIRMED = 'Billing confirmed';
export const MRP_BADGE_SEEN_ON_LABEL = 'Seen on label';
export const MRP_BADGE_LATEST_STOCK = 'Latest stock';
export const MRP_BADGE_SUGGESTED = 'Suggested';

export const PICKER_MRP_CONFIRMED = (mrp: number) => `Label ₹${mrp} confirmed`;
export const PICKER_MRP_VS_SUGGESTED = (label: number, suggested: number) =>
  `Label ₹${label} · suggested ₹${suggested}`;
export const PICKER_MRP_VS_QUOTED_HINT = (label: number, quoted: number) =>
  `Label ₹${label} ≠ quoted ₹${quoted} — billing will review when you pick`;
export const PICKER_MRP_TAP_TO_CONFIRM = 'Tap to confirm label price';

export const PICKER_MRP_SPLIT_BANNER_TITLE = (mrpCount: number) =>
  `${mrpCount} MRPs in stock · pick batch by batch`;
export const PICKER_MRP_SPLIT_BANNER_HINT =
  'Pick one MRP batch at a time. Billing will get separate lines.';
export const PICKER_MRP_SPLIT_METRIC_HINT = 'Split by MRP — start first batch below';
export const PICKER_MRP_SPLIT_PROGRESS_IDLE =
  'Choose the first MRP batch to start splitting this line.';

export const FLAG_SHEET_PRICE_HINT =
  'Wrong price on the label? Tap MRP on label on the pick card — not this flag.';

export const BILLING_ACCEPT_LABEL = 'Bill at label';
export const BILLING_ACCEPT_ALL_LABEL = 'Bill all at label';
export const BILLING_KEEP_QUOTED = 'Keep quoted';
export const BILLING_PRICE_SUMMARY = (label: number, quoted: number) =>
  `Label ₹${label.toLocaleString('en-IN')} · quoted ₹${quoted.toLocaleString('en-IN')}`;
export const BILLING_LABEL_CHIP = (mrp: number) =>
  `Label ₹${Math.round(mrp).toLocaleString('en-IN')}`;

export function formatRoundedRs(value: number): string {
  return `₹${Math.round(value).toLocaleString('en-IN')}`;
}
