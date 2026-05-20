const REASON_MESSAGES: Record<string, string> = {
  line_not_found: 'GRN line not found.',
  job_not_found: 'Receiving job not found.',
  master_labels_only_for_structured_mode:
    'Enter outer box count first (line must be carton mode, not bulk).',
  master_labels_already_printed: 'Outer labels already created for this line.',
  master_labels_count_zero: 'Enter how many outer boxes before printing.',
  nothing_to_print: 'Enter outer box count and pack sizes on at least one line.',
  nothing_to_save: 'Enter inner or piece sticker counts before saving.',
  nothing_saved_to_print: 'Save breakup counts first — nothing waiting at the print desk.',
  popup_blocked: 'Print window blocked — allow pop-ups for this site and try again.',
  no_label_cards: 'No labels to print — save counts and try again.',
  ratio_not_verified: 'Save breakup counts on this line before printing.',
  inner_labels_count_zero: 'Enter inner box sticker count, or piece-only with 0 inner.',
  inner_labels_already_printed: 'Breakup labels already printed — use Reprint.',
  print_master_labels_first: 'Print outer box labels in Phase 1 first.',
  no_breakup_labels_to_print: 'Enter at least one inner or piece sticker count.',
  inner_print_failed: 'Could not create breakup labels.',
};

export function formatReceivingPrintError(reason: string | undefined, phase: 'outer' | 'breakup' = 'outer'): string {
  if (!reason) return phase === 'breakup' ? 'Could not print breakup labels.' : 'Could not print outer labels.';
  return REASON_MESSAGES[reason] ?? reason.replace(/_/g, ' ');
}
