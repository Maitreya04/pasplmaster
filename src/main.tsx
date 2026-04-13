import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { Analytics } from '@vercel/analytics/react';
import { queryClient } from './lib/queryClient';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { registerPushServiceWorker } from './lib/push';
import { initializeItemScanIndex } from './stores/itemScanIndex';
import './index.css';
import App from './App';

void registerPushServiceWorker().catch(() => undefined);
void initializeItemScanIndex().catch(() => undefined);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <ToastProvider>
            <App />
            <Analytics />
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
