import React, { Suspense, lazy } from 'react';
import { Routes, Route, BrowserRouter } from 'react-router-dom';
import { CalimeroProvider, AppMode } from '@calimero-network/calimero-client';
import { ToastProvider } from '@calimero-network/mero-ui';
import { TooltipProvider } from '@/components/ui/tooltip';
import { WorkspaceProvider } from '@/context/WorkspaceContext';

// Lazy load pages for code splitting
const HomePage = lazy(() => import('./pages/home'));
const Authenticate = lazy(() => import('./pages/login/Authenticate'));
const EditorPage = lazy(() => import('./pages/editor'));
const JoinPage = lazy(() => import('./pages/join'));

// Loading spinner for Suspense fallback
const PageLoader = () => (
  <div className="flex items-center justify-center h-screen bg-background">
    <div className="text-center">
      <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary mx-auto mb-4"></div>
      <p className="text-muted-foreground">Loading...</p>
    </div>
  </div>
);

export default function App() {
  return (
    <CalimeroProvider
      packageName="com.calimero.docs-app8"
      registryUrl="https://apps.calimero.network"
      mode={AppMode.MultiContext}
    >
      <WorkspaceProvider>
        <ToastProvider>
          <TooltipProvider>
            <BrowserRouter basename="/">
              <Suspense fallback={<PageLoader />}>
                <Routes>
                  <Route path="/" element={<Authenticate />} />
                  <Route path="/home" element={<HomePage />} />
                  <Route path="/editor" element={<EditorPage />} />
                  <Route path="/editor/:documentId" element={<EditorPage />} />
                  <Route path="/join" element={<JoinPage />} />
                </Routes>
              </Suspense>
            </BrowserRouter>
          </TooltipProvider>
        </ToastProvider>
      </WorkspaceProvider>
    </CalimeroProvider>
  );
}
