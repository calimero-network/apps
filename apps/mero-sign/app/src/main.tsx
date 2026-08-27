import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { AppMode, CalimeroProvider } from '@calimero-network/calimero-client';
import { APPLICATION_ID, APPLICATION_PATH } from './constants/config';

// Disable StrictMode in production to avoid double-rendering
// which can cause 429 errors from CalimeroProvider's auth checks
const AppWrapper = import.meta.env.DEV ? StrictMode : React.Fragment;

createRoot(document.getElementById('root')!).render(
  <AppWrapper>
    <CalimeroProvider
      clientApplicationId={APPLICATION_ID}
      mode={AppMode.MultiContext}
      applicationPath={APPLICATION_PATH}
    >
      <App />
    </CalimeroProvider>
  </AppWrapper>,
);


