import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { Analytics } from '@vercel/analytics/react';
import { queryClient } from './lib/queryClient';
import { warmPickQueueRoute, readStoredPickerSession } from './lib/picking/warmPickQueue';
import { CameraProvider } from './context/CameraContext';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import './index.css';
import App from './App';
import { PwaUpdatePrompt } from './components/PwaUpdatePrompt.tsx';

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
                <Analytics />
              </ToastProvider>
            </CameraProvider>
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </AppErrorBoundary>
  </StrictMode>,
);
