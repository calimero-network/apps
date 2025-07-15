import React, { useState, ReactNode } from 'react';
import { MobileHeader } from './MobileHeader';
import { Sidebar } from './Sidebar';

interface MobileLayoutProps {
  children: ReactNode;
}

export const MobileLayout: React.FC<MobileLayoutProps> = ({ children }) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);

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
        style={{ paddingTop: 'var(--spacing-mobile-header)' }}
      >
        <div className="p-4 max-w-full mx-auto md:max-w-[1200px] md:p-6">
          {children}
        </div>
      </main>
    </div>
  );
};
