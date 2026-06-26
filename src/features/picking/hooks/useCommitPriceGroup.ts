import { useCallback, useState } from 'react';
import {
  commitPickMrpSegment,
  undoPickMrpSegment,
  type SplitMrpSegmentResult,
} from '../../../lib/picking/splitMrpSegment';
import { buildPriceGroupScanResult, type PriceGroupMrpContext } from '../lib/buildPriceGroupScanResult';
import type { OrderItem } from '../../../types';

export type CommitPriceGroupInput = {
  orderId: number;
  claimId: number | null;
  userId: number;
  orderItem: OrderItem;
  rootOrderItemId: number;
  segmentQty: number;
  confirmedMrp: number;
  isFirstSegment: boolean;
  totalLogged: number;
  targetQty: number;
  pickerName: string | null;
  pickerNote?: string | null;
  isOverTarget?: boolean;
  mrpContext?: PriceGroupMrpContext;
};

export type CommitPriceGroupResult = SplitMrpSegmentResult;

export function useCommitPriceGroup() {
  const [pendingCount, setPendingCount] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);

  const commit = useCallback(async (input: CommitPriceGroupInput): Promise<CommitPriceGroupResult> => {
    setPendingCount((n) => n + 1);
    setLastError(null);

    try {
      const scanResult = buildPriceGroupScanResult({
        orderItem: input.orderItem,
        mrp: input.confirmedMrp,
        qty: input.segmentQty,
        totalLogged: input.totalLogged,
        targetQty: input.targetQty,
        pickerName: input.pickerName,
        pickerUserId: input.userId,
        pickerNote: input.pickerNote,
        isOverTarget: input.isOverTarget,
        mrpContext: input.mrpContext,
      });

      const result = await commitPickMrpSegment({
        orderId: input.orderId,
        claimId: input.claimId,
        userId: input.userId,
        rootOrderItemId: input.rootOrderItemId,
        segmentQty: input.segmentQty,
        confirmedMrp: input.confirmedMrp,
        scanResult,
        isFirstSegment: input.isFirstSegment,
      });

      if (!result.success) {
        setLastError(result.error ?? 'commit_failed');
      }

      return result;
    } finally {
      setPendingCount((n) => Math.max(0, n - 1));
    }
  }, []);

  const undo = useCallback(
    async (options: {
      orderId: number;
      claimId: number | null;
      userId: number;
      rootOrderItemId: number;
      segmentOrderItemId: number;
      restoreQty?: number | null;
    }) => {
      setPendingCount((n) => n + 1);
      setLastError(null);

      try {
        const result = await undoPickMrpSegment(options);
        if (!result.success) {
          setLastError(result.error ?? 'undo_failed');
        }
        return result;
      } finally {
        setPendingCount((n) => Math.max(0, n - 1));
      }
    },
    [],
  );

  const syncStatus =
    pendingCount > 0
      ? ('saving' as const)
      : lastError
        ? ('error' as const)
        : ('saved' as const);

  return { commit, undo, syncStatus, pendingCount, lastError };
}

export type UseCommitPriceGroupReturn = ReturnType<typeof useCommitPriceGroup>;
