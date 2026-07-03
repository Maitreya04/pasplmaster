import { useCallback, useMemo, useReducer } from 'react';
import type { ConfirmedPriceGroup, LineDraft, PriceGroupDraft } from '../../../types';

function newGroupId(): string {
  return crypto.randomUUID();
}

export type PickEntryModalPhase = 'idle' | 'mrp' | 'qty' | 'gap' | 'price_fix';

type DraftAction =
  | { type: 'reset'; draft: LineDraft }
  | { type: 'start_pick' }
  | { type: 'resume_pick'; mrp: number; qty: number }
  | { type: 'set_mrp'; value: number | null }
  | { type: 'advance_to_qty' }
  | { type: 'set_qty'; value: number | null }
  | { type: 'fix_mrp'; value: number | null }
  | { type: 'set_note'; text: string }
  | { type: 'commit_group'; orderItemId: number }
  | { type: 'begin_edit'; groupId: string }
  | { type: 'cancel_edit'; restored: ConfirmedPriceGroup | null }
  | { type: 'clear_in_progress' }
  | { type: 'pop_last_group' };

function sumConfirmed(groups: ConfirmedPriceGroup[]): number {
  return groups.reduce((sum, g) => sum + g.qty, 0);
}

function draftReducer(state: LineDraft, action: DraftAction): LineDraft {
  switch (action.type) {
    case 'reset':
      return action.draft;
    case 'start_pick':
      return {
        ...state,
        inProgress: { mrp: null, qty: null, stage: 'mrp' },
        editingGroupId: null,
        noteText: '',
      };
    case 'resume_pick':
      return {
        ...state,
        inProgress: { mrp: action.mrp, qty: action.qty, stage: 'qty' },
        editingGroupId: null,
        noteText: '',
      };
    case 'set_mrp':
      if (!state.inProgress) return state;
      return {
        ...state,
        inProgress: { ...state.inProgress, mrp: action.value },
      };
    case 'advance_to_qty':
      if (!state.inProgress || state.inProgress.mrp == null || state.inProgress.mrp <= 0) {
        return state;
      }
      return {
        ...state,
        inProgress: { ...state.inProgress, stage: 'qty' },
      };
    case 'set_qty':
      if (!state.inProgress) return state;
      return {
        ...state,
        inProgress: { ...state.inProgress, qty: action.value },
      };
    case 'fix_mrp':
      if (!state.inProgress) return state;
      return {
        ...state,
        inProgress: { ...state.inProgress, mrp: action.value },
      };
    case 'set_note':
      return { ...state, noteText: action.text };
    case 'commit_group': {
      const ip = state.inProgress;
      if (!ip || ip.mrp == null || ip.qty == null || ip.qty <= 0) return state;

      const loggedBefore = sumConfirmed(state.confirmedGroups);
      const isOverTarget = loggedBefore + ip.qty > state.targetQty;

      const group: ConfirmedPriceGroup = {
        id: state.editingGroupId ?? newGroupId(),
        orderItemId: action.orderItemId,
        mrp: ip.mrp,
        qty: ip.qty,
        isOverTarget,
        pickerNote: isOverTarget ? state.noteText.trim() || null : null,
      };

      const withoutEdit =
        state.editingGroupId != null
          ? state.confirmedGroups.filter((g) => g.id !== state.editingGroupId)
          : state.confirmedGroups;

      return {
        ...state,
        confirmedGroups: [...withoutEdit, group],
        inProgress: null,
        editingGroupId: null,
        noteText: '',
      };
    }
    case 'begin_edit': {
      const group = state.confirmedGroups.find((g) => g.id === action.groupId);
      if (!group) return state;
      const remainingGroups = state.confirmedGroups.filter((g) => g.id !== action.groupId);
      const inProgress: PriceGroupDraft = {
        mrp: group.mrp,
        qty: group.qty,
        stage: 'qty',
      };
      return {
        ...state,
        confirmedGroups: remainingGroups,
        inProgress,
        editingGroupId: action.groupId,
        noteText: group.pickerNote ?? '',
      };
    }
    case 'cancel_edit': {
      if (!state.editingGroupId || !action.restored) {
        return { ...state, inProgress: null, editingGroupId: null, noteText: '' };
      }
      return {
        ...state,
        confirmedGroups: [...state.confirmedGroups, action.restored],
        inProgress: null,
        editingGroupId: null,
        noteText: '',
      };
    }
    case 'clear_in_progress':
      return { ...state, inProgress: null, editingGroupId: null, noteText: '' };
    case 'pop_last_group': {
      if (state.confirmedGroups.length === 0) return state;
      return {
        ...state,
        confirmedGroups: state.confirmedGroups.slice(0, -1),
      };
    }
    default:
      return state;
  }
}

export function createLineDraft(options: {
  rootOrderItemId: number;
  targetQty: number;
  uom: string;
  confirmedGroups?: ConfirmedPriceGroup[];
}): LineDraft {
  return {
    rootOrderItemId: options.rootOrderItemId,
    targetQty: options.targetQty,
    uom: options.uom,
    confirmedGroups: options.confirmedGroups ?? [],
    inProgress: null,
    editingGroupId: null,
    noteText: '',
  };
}

export function usePickEntryDraft(initial: LineDraft) {
  const [draft, dispatch] = useReducer(draftReducer, initial);

  const reset = useCallback((next: LineDraft) => {
    dispatch({ type: 'reset', draft: next });
  }, []);

  const startPick = useCallback(() => dispatch({ type: 'start_pick' }), []);

  const resumePick = useCallback((mrp: number, qty: number) => {
    dispatch({ type: 'resume_pick', mrp, qty });
  }, []);

  const setMrp = useCallback((value: number | null) => {
    dispatch({ type: 'set_mrp', value });
  }, []);

  const advanceToQty = useCallback(() => dispatch({ type: 'advance_to_qty' }), []);

  const setQty = useCallback((value: number | null) => {
    dispatch({ type: 'set_qty', value });
  }, []);

  const fixMrp = useCallback((value: number | null) => {
    dispatch({ type: 'fix_mrp', value });
  }, []);

  const setNote = useCallback((text: string) => {
    dispatch({ type: 'set_note', text });
  }, []);

  const commitGroup = useCallback((orderItemId: number) => {
    dispatch({ type: 'commit_group', orderItemId });
  }, []);

  const beginEdit = useCallback((groupId: string) => {
    dispatch({ type: 'begin_edit', groupId });
  }, []);

  const cancelEdit = useCallback((restored: ConfirmedPriceGroup | null) => {
    dispatch({ type: 'cancel_edit', restored });
  }, []);

  const clearInProgress = useCallback(() => {
    dispatch({ type: 'clear_in_progress' });
  }, []);

  const popLastGroup = useCallback(() => {
    dispatch({ type: 'pop_last_group' });
  }, []);

  const totalLogged = useMemo(() => sumConfirmed(draft.confirmedGroups), [draft.confirmedGroups]);

  const remaining = useMemo(() => {
    return Math.max(0, draft.targetQty - totalLogged);
  }, [draft.targetQty, totalLogged]);

  const remainingAfterInProgress = useMemo(() => {
    const ipQty =
      draft.inProgress?.stage === 'qty' && draft.inProgress.qty != null
        ? draft.inProgress.qty
        : 0;
    return Math.max(0, draft.targetQty - totalLogged - ipQty);
  }, [draft.inProgress, draft.targetQty, totalLogged]);

  const isComplete = totalLogged >= draft.targetQty;

  const isOverTarget = useMemo(() => {
    const ipQty = draft.inProgress?.qty ?? 0;
    return totalLogged + ipQty > draft.targetQty;
  }, [draft.inProgress?.qty, draft.targetQty, totalLogged]);

  const modalPhase: PickEntryModalPhase = useMemo(() => {
    if (!draft.inProgress) {
      if (totalLogged > 0 && totalLogged < draft.targetQty) return 'idle';
      return 'idle';
    }
    if (draft.inProgress.stage === 'mrp') return 'mrp';
    const afterCommitRemaining = draft.targetQty - totalLogged;
    if (
      draft.inProgress.stage === 'qty' &&
      draft.inProgress.qty != null &&
      draft.inProgress.qty > 0 &&
      afterCommitRemaining - draft.inProgress.qty > 0 &&
      draft.editingGroupId == null
    ) {
      // gap shown after commit, not while typing
    }
    return 'qty';
  }, [draft.editingGroupId, draft.inProgress, draft.targetQty, totalLogged]);

  return useMemo(
    () => ({
      draft,
      reset,
      startPick,
      resumePick,
      setMrp,
      advanceToQty,
      setQty,
      fixMrp,
      setNote,
      commitGroup,
      beginEdit,
      cancelEdit,
      clearInProgress,
      popLastGroup,
      totalLogged,
      remaining,
      remainingAfterInProgress,
      isComplete,
      isOverTarget,
      modalPhase,
    }),
    [
      draft,
      reset,
      startPick,
      resumePick,
      setMrp,
      advanceToQty,
      setQty,
      fixMrp,
      setNote,
      commitGroup,
      beginEdit,
      cancelEdit,
      clearInProgress,
      popLastGroup,
      totalLogged,
      remaining,
      remainingAfterInProgress,
      isComplete,
      isOverTarget,
      modalPhase,
    ],
  );
}

export type UsePickEntryDraftReturn = ReturnType<typeof usePickEntryDraft>;
