import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { Analytics } from '@vercel/analytics/react';
import { queryClient } from './lib/queryClient';
import { CameraProvider } from './context/CameraContext';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import './index.css';
import App from './App';
import { PwaUpdatePrompt } from './components/PwaUpdatePrompt.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
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
  </StrictMode>,
);
