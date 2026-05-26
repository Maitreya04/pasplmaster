import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient';
import { warmPickQueueRoute, readStoredPickerSession } from './lib/picking/warmPickQueue';
import { CameraProvider } from './context/CameraContext';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import './index.css';
import App from './App';
import { PwaUpdatePrompt } from './components/PwaUpdatePrompt.tsx';

// Lazy load non-critical: Analytics loads after app is interactive
const Analytics = lazy(() =>
  import('@vercel/analytics/react').then((m) => ({ default: m.Analytics })),
);

// Returning pickers: warm queue route + data before React mounts so /picking opens on cache.
const pickerSession = readStoredPickerSession();
if (pickerSession.isPicker) {
  warmPickQueueRoute(pickerSession.userId);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <CameraProvider>
              <ToastProvider>
                <PwaUpdatePrompt />
                <App />
                <Suspense fallback={null}>
                  <Analytics />
                </Suspense>
              </ToastProvider>
            </CameraProvider>
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </AppErrorBoundary>
  </StrictMode>,
);
