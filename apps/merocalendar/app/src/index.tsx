import React from 'react';
import ReactDOM from 'react-dom/client';

import App from './App';
import './index.module.scss';
import { Provider as StoreProvider } from 'react-redux';
import { store } from './store/store';
import { ModalProvider } from './providers/ModalProvider';
import { PopupProvider } from './providers/PopupProvider';

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement,
);
root.render(
  <React.StrictMode>
    <StoreProvider store={store}>
      <ModalProvider>
        <PopupProvider>
          <App />
        </PopupProvider>
      </ModalProvider>
    </StoreProvider>
  </React.StrictMode>,
);
