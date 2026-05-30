import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase/client';
import {
  indexPendingItemsByItemId,
  isDeskFlagLineAlreadyOnPo,
} from '../lib/billing/deskPoCoverage';
import type { PendingItem } from '../types';

export interface DeskPickerFlagLine {
  orderItemId: number;
  itemName: string;
  flagReason: string | null;
}

type FlaggedOrderItemRow = {
  id: number;
  order_id: number;
  item_id: number;
  item_name: string | null;
  flag_reason: string | null;
  bill_line_no: number | null;
  qty_requested: number;
  qty_shippable: number | null;
  qty_po: number | null;
  qty_approved: number | null;
};

export function useDeskPickerFlags(orderIds: number[]) {
  const sortedKey = useMemo(
    () => [...orderIds].sort((a, b) => a - b).join(','),
    [orderIds],
  );

  return useQuery({
    queryKey: ['desk-picker-flags', sortedKey],
    enabled: orderIds.length > 0,
    queryFn: async (): Promise<Map<number, DeskPickerFlagLine[]>> => {
      const { data, error } = await supabase
        .from('order_items')
        .select(
          'id, order_id, item_id, item_name, flag_reason, bill_line_no, qty_requested, qty_shippable, qty_po, qty_approved',
        )
        .in('order_id', orderIds)
        .eq('state', 'flagged');

      if (error) throw error;

      const rows = (data ?? []) as FlaggedOrderItemRow[];
      const uniqueOrderIds = [...new Set(rows.map((row) => Number(row.order_id)))];

      let pendingByItemId = new Map<number, PendingItem[]>();
      if (uniqueOrderIds.length > 0) {
        const { data: pendingRows, error: pendingError } = await supabase
          .from('pending_items')
          .select('*')
          .in('order_id', uniqueOrderIds)
          .eq('status', 'pending')
          .returns<PendingItem[]>();
        if (pendingError) throw pendingError;
        pendingByItemId = indexPendingItemsByItemId(pendingRows ?? []);
      }

      const grouped = new Map<number, DeskPickerFlagLine[]>();
      const sortedRows = [...rows].sort((a, b) => {
        const keyA = a.bill_line_no ?? a.id;
        const keyB = b.bill_line_no ?? b.id;
        return keyA - keyB;
      });

      for (const row of sortedRows) {
        if (
          isDeskFlagLineAlreadyOnPo(
            row,
            pendingByItemId.get(Number(row.item_id)) ?? [],
          )
        ) {
          continue;
        }

        const orderId = Number(row.order_id);
        const list = grouped.get(orderId) ?? [];
        list.push({
          orderItemId: Number(row.id),
          itemName: row.item_name ?? 'Item',
          flagReason: row.flag_reason ?? null,
        });
        grouped.set(orderId, list);
      }
      return grouped;
    },
    staleTime: 5_000,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  });
}
