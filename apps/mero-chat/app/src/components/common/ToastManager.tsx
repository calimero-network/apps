import React, { useState, useCallback, useEffect } from 'react';
import { CustomToast } from './CustomToast';
import styled from 'styled-components';

export interface ToastNotification {
  id: string;
  title: string;
  message: string;
  type: 'channel' | 'dm' | 'mention';
  duration?: number;
}

interface ToastManagerProps {
  toasts: ToastNotification[];
  onRemoveToast: (id: string) => void;
}

const ToastWrapper = styled.div<{ $index: number; $totalToasts: number }>`
  position: fixed;
  top: ${props => 80 + props.$index * 90}px;
  right: 20px;
  z-index: ${props => 10000 - props.$index};
  transform: scale(1);
  opacity: 1;
  pointer-events: auto;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
`;

export const ToastManager: React.FC<ToastManagerProps> = ({ toasts, onRemoveToast }) => {
  // Keep track of the last 4 toasts
  const [displayedToasts, setDisplayedToasts] = useState<string[]>([]);
  
  // Update displayed toasts when the toasts array changes
  useEffect(() => {
    // When we have more than 4 toasts and there's a new one
    if (toasts.length > 4) {
      // Keep only the last 4 toasts
      const last4Toasts = toasts.slice(-4);
      const last4Ids = last4Toasts.map(t => t.id);
      setDisplayedToasts(last4Ids);
      
      // Remove the oldest toast that's beyond the 4th position
      const toastToRemove = toasts[0];
      if (toastToRemove) {
        // Small delay to allow smooth transition
        const timer = setTimeout(() => {
          onRemoveToast(toastToRemove.id);
        }, 100);
        return () => clearTimeout(timer);
      }
    } else {
      // If we have 4 or fewer toasts, show all of them
      setDisplayedToasts(toasts.map(t => t.id));
    }
  }, [toasts, onRemoveToast]);
  
  // Filter toasts to only show the displayed ones
  const visibleToasts = toasts.filter(t => displayedToasts.includes(t.id));
  
  return (
    <>
      {visibleToasts.map((toast, index) => (
        <ToastWrapper
          key={toast.id}
          $index={index}
          $totalToasts={visibleToasts.length}
        >
          <CustomToast
            title={toast.title}
            message={toast.message}
            type={toast.type}
            duration={toast.duration}
            onClose={() => onRemoveToast(toast.id)}
          />
        </ToastWrapper>
      ))}
    </>
  );
};

// Hook for managing toasts
export const useToastManager = () => {
  const [toasts, setToasts] = useState<ToastNotification[]>([]);

  const addToast = useCallback((toast: Omit<ToastNotification, 'id'>) => {
    const id = Math.random().toString(36).substr(2, 9);
    const newToast: ToastNotification = { ...toast, id };
    
    setToasts(prev => [...prev, newToast]);
    
    return id;
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(toast => toast.id !== id));
  }, []);

  const clearAllToasts = useCallback(() => {
    setToasts([]);
  }, []);

  return {
    toasts,
    addToast,
    removeToast,
    clearAllToasts,
  };
};
