import React, { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { useToastManager } from '../components/common/ToastManager';
import type { ToastNotification } from '../components/common/ToastManager';

interface ToastContextValue {
  toasts: ToastNotification[];
  addToast: (toast: Omit<ToastNotification, 'id'>) => string;
  removeToast: (id: string) => void;
  clearAllToasts: () => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

interface ToastProviderProps {
  children: ReactNode;
}

export function ToastProvider({ children }: ToastProviderProps) {
  const toastManager = useToastManager();

  return (
    <ToastContext.Provider value={toastManager}>
      {children}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (context === undefined) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}
