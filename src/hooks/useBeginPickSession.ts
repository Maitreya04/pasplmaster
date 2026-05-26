import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import {
  beginPickSession,
  beginPickSessionErrorMessage,
  BeginPickSessionError,
} from '../lib/picking/beginPickSession';

export interface BeginPickSessionInput {
  orderId: number;
  fromPool?: boolean;
}

export function useBeginPickSession(): {
  beginPick: (input: BeginPickSessionInput) => void;
  isPending: boolean;
} {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { userId } = useAuth();

  const mutation = useMutation({
    mutationFn: async (input: BeginPickSessionInput) => {
      if (!userId) throw new Error('Not signed in');
      return beginPickSession({
        orderId: input.orderId,
        userId,
        fromPool: input.fromPool,
      });
    },
    onSuccess: (_result, input) => {
      queryClient.invalidateQueries({ queryKey: ['claimable-orders'] });
      queryClient.invalidateQueries({ queryKey: ['picker-daily-stats'] });
      queryClient.invalidateQueries({ queryKey: ['order', input.orderId] });
      navigate(`/picking/pick/${input.orderId}`, { replace: true });
    },
    onError: (err) => {
      if (err instanceof BeginPickSessionError && err.code === 'already_claimed') {
        toast.error(beginPickSessionErrorMessage(err));
      } else {
        toast.error(beginPickSessionErrorMessage(err));
      }
      queryClient.invalidateQueries({ queryKey: ['claimable-orders'] });
    },
  });

  const beginPick = useCallback(
    (input: BeginPickSessionInput) => {
      mutation.mutate(input);
    },
    [mutation],
  );

  return { beginPick, isPending: mutation.isPending };
}
