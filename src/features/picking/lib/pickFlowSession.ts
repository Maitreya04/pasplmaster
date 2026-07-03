import type { LineCompletionStatus } from './hydrateLineDraft';
import type { LineDraft } from '../../../types';

const STORAGE_PREFIX = 'paspl.pick.flow.v1';
const LAB_STORAGE_PREFIX = 'paspl.pick.flow.lab.v1';

export type PickFlowSessionSnapshot = {
  lineIndex: number;
  completedLines: Record<number, LineCompletionStatus>;
  lineDrafts?: Record<number, LineDraft>;
};

function storageKey(orderId: number, scope: 'production' | 'lab'): string {
  const prefix = scope === 'lab' ? LAB_STORAGE_PREFIX : STORAGE_PREFIX;
  return `${prefix}:${orderId}`;
}

export function readPickFlowSession(
  orderId: number | null,
  scope: 'production' | 'lab' = 'production',
): PickFlowSessionSnapshot | null {
  if (!orderId || typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(storageKey(orderId, scope));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PickFlowSessionSnapshot;
    if (typeof parsed.lineIndex !== 'number') return null;
    if (!parsed.completedLines || typeof parsed.completedLines !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writePickFlowSession(
  orderId: number | null,
  snapshot: PickFlowSessionSnapshot,
  scope: 'production' | 'lab' = 'production',
): void {
  if (!orderId || typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(storageKey(orderId, scope), JSON.stringify(snapshot));
  } catch {
    // best-effort
  }
}

export function clearPickFlowSession(
  orderId: number | null,
  scope: 'production' | 'lab' = 'production',
): void {
  if (!orderId || typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(storageKey(orderId, scope));
  } catch {
    // best-effort
  }
}
