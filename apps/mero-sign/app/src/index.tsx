import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { AppMode, CalimeroProvider } from '@calimero-network/calimero-client';

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement,
);

const APPLICATION_ID =
  import.meta.env.VITE_APPLICATION_ID ||
  'AVqkqKhT8aQjG7gV8NWvmCdi7UN2AaaEDTqEcuKQoorF';
const APPLICATION_PATH =
  import.meta.env.VITE_APPLICATION_PATH ||
  'https://calimero-only-peers-dev.s3.amazonaws.com/uploads/92ea7bf307c4d49f89de9aaf4d1f2c9c.wasm';
root.render(
  <React.StrictMode>
    <CalimeroProvider
      clientApplicationId={APPLICATION_ID}
      mode={AppMode.MultiContext}
      applicationPath={APPLICATION_PATH}
    >
      <App />
    </CalimeroProvider>
  </React.StrictMode>,
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
