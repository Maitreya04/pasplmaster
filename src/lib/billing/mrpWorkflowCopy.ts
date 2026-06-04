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
export const MRP_SHEET_CONFIRM_ON_LABEL = (amount: number) =>
  `Confirm ₹${amount} on label`;

export const MRP_BADGE_BILLING_CONFIRMED = 'Billing confirmed';
export const MRP_BADGE_SEEN_ON_LABEL = 'Seen on label';
export const MRP_BADGE_LATEST_STOCK = 'Latest stock';
export const MRP_BADGE_SUGGESTED = 'Suggested';

export const PICKER_MRP_CONFIRMED = (mrp: number) => `Label ₹${mrp} confirmed`;
export const PICKER_MRP_VS_SUGGESTED = (label: number, suggested: number) =>
  `Label ₹${label} · suggested ₹${suggested}`;
export const PICKER_MRP_BILLING_REVIEW = 'Label differs — billing will review when you pick';
export const PICKER_MRP_MISMATCH_BADGE = 'Label differs from suggestion';
export const PICKER_MRP_TAP_TO_CONFIRM = 'Tap to confirm label price';
export const PICKER_MRP_VS_QUOTED_HINT = (label: number, quoted: number) =>
  `Label ₹${label} ≠ quoted ₹${quoted} — billing will review when you pick`;
export const PICKER_MRP_VS_BILL = (label: number, bill: number) =>
  `Label ₹${label} · bill ₹${bill}`;
export const PICKER_MRP_BILL_REVIEW = (label: number, bill: number) =>
  `Label ₹${label} ≠ bill ₹${bill} — billing will review`;
export const PICKER_MRP_LABEL_ON_PRODUCT = (mrp: number) => `On label · ₹${mrp}`;
export const PICKER_MRP_STOCK_SUGGESTS = (mrp: number) => `Shelf ₹${mrp}`;
export const PICKER_MRP_BILL_RATE_CHIP = (bill: number) => `Bill ₹${bill}`;
export const PICKER_MRP_STOCK_CHIP = (stock: number) => `Stock ₹${stock}`;
export const PICKER_MRP_SPLIT_PICKED_AT = (qty: number, label: number, goal: number) =>
  `${qty} of ${goal} pcs @ label ₹${label}`;

export const PICKER_MRP_SPLIT_BANNER_TITLE = (mrpCount: number) =>
  `${mrpCount} MRPs in stock · pick batch by batch`;
export const PICKER_MRP_SPLIT_BANNER_HINT =
  'Pick one MRP batch at a time. Billing will get separate lines.';
export const PICKER_MRP_SPLIT_CHOOSER_HEADING = (qty: number) =>
  `Picking ${qty} pcs · how many label prices?`;
export const PICKER_MRP_SPLIT_CHOOSER_AUTO_STOCK = (prices: string) =>
  `Stock: ${prices}`;
export const PICKER_MRP_SPLIT_CHOOSER_MANUAL_STOCK = (price: string) =>
  `Stock shows ${price} — split if labels differ`;
export const PICKER_MRP_SPLIT_CHOOSER_SPLIT_LABEL = 'Split by label MRP';
export const PICKER_MRP_SPLIT_CHOOSER_SPLIT_HINT =
  'Pick one price batch at a time · enter manually if needed';
export const PICKER_MRP_SPLIT_CHOOSER_SINGLE_HINT =
  'One MRP on every piece — normal pick';
export const PICKER_MRP_SPLIT_PROGRESS_IDLE =
  'Tap the dock below to choose MRP for batch 1';
export const MRP_SHEET_SUBHEADING_BATCH_MANUAL =
  'Type the price on this batch. Repeat for each different label on the shelf.';
export const MRP_SHEET_BATCH_STEP = (n: number) => `Batch ${n}`;

export const FLAG_SHEET_PRICE_HINT =
  'Wrong price on the label? Tap MRP on label on the pick card — not this flag.';

export const BILLING_ACCEPT_LABEL = 'Bill at label';
export const BILLING_ACCEPT_ALL_LABEL = 'Bill all at label';
export const BILLING_KEEP_QUOTED = 'Keep quoted';
export const BILLING_PRICE_SUMMARY = (label: number, quoted: number) =>
  `Label ₹${label.toLocaleString('en-IN')} · bill rate ₹${quoted.toLocaleString('en-IN')}`;
export const BILLING_LABEL_CHIP = (mrp: number) =>
  `Label ₹${Math.round(mrp).toLocaleString('en-IN')}`;

export const BILLING_PICK_MRP_LABEL = 'Label at pick';
export const BILLING_PICK_MRP_BILL_RATE = 'Bill rate';
export const BILLING_PICK_MRP_STOCK_SUGGESTED = 'Stock suggested';
export const BILLING_PICK_MRP_PICKER_FLAG = 'Picker flagged label ≠ stock';
export const BILLING_PICK_MRP_MIX = 'Pick mix';
export const BILLING_PICK_MRP_LABEL_VS_BILL = (label: number, bill: number) =>
  `Label ${formatRoundedRs(label)} · bill ${formatRoundedRs(bill)}`;
export const BILLING_PICK_MRP_LABEL_VS_STOCK = (label: number, stock: number) =>
  `Label ${formatRoundedRs(label)} · stock ${formatRoundedRs(stock)}`;

export function formatRoundedRs(value: number): string {
  return `₹${Math.round(value).toLocaleString('en-IN')}`;
}
