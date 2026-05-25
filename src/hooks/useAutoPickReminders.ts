import { useEffect, useRef } from 'react';
import type { PickLineProgress } from '../lib/cartSupply';
import {
  createPickReminderSnapshot,
  evaluatePickReminder,
  type PickReminderProgressSnapshot,
} from '../lib/billing/pickReminderEligibility';
import { PICK_REMINDER, type PickReminderKind } from '../lib/billing/pickReminderConfig';
import { sendPickCompleteReminder } from '../lib/pickerPush';
import { shouldNotifyPickers } from '../lib/billing/fulfillmentPath';
import type { PickerLoadInfo } from './usePickerLoad';
import type { DeskOrderRow } from './useBillingDeskOrders';

function findPickerByName(
  pickers: PickerLoadInfo[],
  name: string | null,
): PickerLoadInfo | undefined {
  if (!name?.trim()) return undefined;
  const normalized = name.trim().toLowerCase();
  return pickers.find((p) => p.name.trim().toLowerCase() === normalized);
}

/**
 * While the billing desk is open, auto-ping assigned pickers when:
 * - all pick lines are done but the order is still in picking, or
 * - partial progress has stalled for a configured interval.
 *
 * Deduping is handled server-side via notification_events.
 */
export function useAutoPickReminders(
  orders: DeskOrderRow[],
  pickProgressMap: Map<number, PickLineProgress> | undefined,
  pickers: PickerLoadInfo[],
  enabled = true,
): void {
  const snapshotsRef = useRef<Map<number, PickReminderProgressSnapshot>>(new Map());
  const inFlightRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (!enabled) return;

    const runCheck = () => {
      const nowMs = Date.now();
      const snapshots = snapshotsRef.current;

      for (const order of orders) {
        if (order.workflow_status !== 'picking') {
          snapshots.delete(order.id);
          continue;
        }
        if (!shouldNotifyPickers(order.fulfillment_path ?? 'warehouse_pick')) continue;

        const progress = pickProgressMap?.get(order.id);
        const snapshot = createPickReminderSnapshot(
          progress,
          snapshots.get(order.id),
          nowMs,
        );
        if (!snapshot) {
          snapshots.delete(order.id);
          continue;
        }
        snapshots.set(order.id, snapshot);

        const kind = evaluatePickReminder({
          workflowStatus: order.workflow_status,
          pickerName: order.picker_name,
          snapshot,
          nowMs,
        });
        if (!kind || inFlightRef.current.has(order.id)) continue;

        const picker = findPickerByName(pickers, order.picker_name);
        if (!picker) continue;

        inFlightRef.current.add(order.id);
        void sendPickCompleteReminder({
          eventType: 'pick_complete_reminder',
          kind,
          orderId: order.id,
          orderNumber: order.order_number,
          customerName: order.customer_name,
          priority: order.priority,
          targetUserId: picker.userId,
          linesDone: snapshot.done,
          linesTotal: progress?.total ?? snapshot.done,
          linesRemaining: snapshot.remaining,
        })
          .catch((err) => {
            console.warn('Auto pick reminder failed', order.id, err);
          })
          .finally(() => {
            inFlightRef.current.delete(order.id);
          });
      }
    };

    runCheck();
    const timer = window.setInterval(runCheck, PICK_REMINDER.checkIntervalMs);
    return () => window.clearInterval(timer);
  }, [enabled, orders, pickProgressMap, pickers]);
}

export type { PickReminderKind };
