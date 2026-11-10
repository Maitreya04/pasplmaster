import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { requestSessionRecovery, shouldRecoverSessionFromError } from './supabase/authError';

function onAuthError(error: unknown): void {
  if (shouldRecoverSessionFromError(error)) requestSessionRecovery();
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: onAuthError }),
  mutationCache: new MutationCache({ onError: onAuthError }),
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
      retry: (n, error) => !shouldRecoverSessionFromError(error) && n < 2,
      refetchOnWindowFocus: false,
    },
  },
});
