/**
 * After pick finalise the billing resolver/finaliser is not assigned yet.
 * Picker takes the bill to the desk; whoever claims resolve/finalise owns it.
 */
export function pickerBillingHandoffLine(hasFlagged: boolean): string {
  if (hasFlagged) {
    return 'Take to billing desk — billing will resolve and notify you';
  }
  return "Take to billing desk — you'll be notified when the bill is ready";
}
