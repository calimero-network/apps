import React, { useState, ReactNode } from 'react';
import { MobileHeader } from './MobileHeader';
import { Sidebar } from './Sidebar';

interface MobileLayoutProps {
  children: ReactNode;
  sidebarOpen?: boolean;
  onSidebarToggle?: (open: boolean) => void;
}

export const MobileLayout: React.FC<MobileLayoutProps> = ({
  children,
  sidebarOpen: externalSidebarOpen,
  onSidebarToggle,
}) => {
  const [internalSidebarOpen, setInternalSidebarOpen] = useState(false);

  const sidebarOpen =
    externalSidebarOpen !== undefined
      ? externalSidebarOpen
      : internalSidebarOpen;
  const setSidebarOpen = onSidebarToggle || setInternalSidebarOpen;

  const handleMenuToggle = () => {
    setSidebarOpen(!sidebarOpen);
  };

  const handleSidebarClose = () => {
    setSidebarOpen(false);
  };

  return (
    <div className="min-h-screen bg-current text-current font-sans">
      <MobileHeader onMenuToggle={handleMenuToggle} />
      <Sidebar isOpen={sidebarOpen} onClose={handleSidebarClose} />

      <main
        className="relative min-h-[calc(100vh-60px)]"
        style={{ paddingTop: '32px' }}
      >
        <div className="p-4 max-w-full mx-auto md:max-w-[1200px] md:p-6">
          {children}
        </div>
      </main>
    </div>
  );
};
