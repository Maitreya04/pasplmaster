import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from './client';
import type { RealtimeChannel } from '@supabase/supabase-js';

export function subscribeToOrders(
  onChangeCallback: () => void,
): RealtimeChannel {
  return supabase
    .channel('orders-changes')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'orders' },
      onChangeCallback,
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'orders' },
      onChangeCallback,
    )
    .subscribe();
}

export function useOrdersRealtime() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const channel = subscribeToOrders(() => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);
}
