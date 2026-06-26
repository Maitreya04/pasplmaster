import { createLineDraft } from './usePickEntryDraft';

/** fixMrp must not mutate qty (PRD §4.6). */
function assertFixMrpKeepsQty(): void {
  const draft = createLineDraft({ rootOrderItemId: 1, targetQty: 10, uom: 'set' });
  const inProgress = { mrp: 300, qty: 8, stage: 'qty' as const };
  const afterFix = {
    ...draft,
    inProgress: { ...inProgress, mrp: 450 },
  };

  if (afterFix.inProgress?.qty !== 8) {
    throw new Error(`expected qty 8, got ${afterFix.inProgress?.qty}`);
  }
  if (afterFix.inProgress?.mrp !== 450) {
    throw new Error(`expected mrp 450, got ${afterFix.inProgress?.mrp}`);
  }
}

assertFixMrpKeepsQty();
console.log('usePickEntryDraft contract: ok');
