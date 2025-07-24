import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Home, PenTool, LogOut, X } from 'lucide-react';
import { clientLogout } from '@calimero-network/calimero-client';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ isOpen, onClose }) => {
  const navigate = useNavigate();
  const location = useLocation();

  const navItems = [
    { icon: Home, label: 'Dashboard', path: '/' },
    { icon: PenTool, label: 'Signatures', path: '/signatures' },
  ];

  const handleNavigation = (path: string) => {
    navigate(path);
    onClose();
  };

  const handleLogout = () => {
    if (localStorage.getItem('agreementContextID')) {
      localStorage.removeItem('agreementContextID');
    }
    if (localStorage.getItem('agreementContextUserID')) {
      localStorage.removeItem('agreementContextUserID');
    }
    navigate('/');
    clientLogout();
    onClose();
  };

  return (
    <>
      {/* Overlay */}
      <div
        className={`fixed inset-0 bg-black bg-opacity-50 z-[998] transition-all duration-300 ${
          isOpen ? 'opacity-100 visible' : 'opacity-0 invisible'
        }`}
        onClick={onClose}
      />

      {/* Sidebar */}
      <div
        className={`fixed top-0 left-0 h-screen z-[999] flex flex-col overflow-y-auto transition-transform duration-300 md:w-[280px] w-[280px] ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        style={{
          width: 'var(--spacing-sidebar-width)',
          backgroundColor: 'var(--current-surface)',
          borderRight: '1px solid var(--current-border)',
          boxShadow: 'var(--shadow-sidebar)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between p-4 border-b"
          style={{ borderColor: 'var(--current-border)' }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-lg"
              style={{
                background:
                  'linear-gradient(135deg, var(--color-primary) 0%, #8ce619 100%)',
                color: 'var(--color-background-dark)',
              }}
            >
              M
            </div>
            <div
              className="text-lg font-semibold"
              style={{ color: 'var(--current-text)' }}
            >
              MeroDocs
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg cursor-pointer flex items-center justify-center min-w-[44px] min-h-[44px] transition-colors duration-200"
            style={{
              color: 'var(--current-text)',
              backgroundColor: 'transparent',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--current-border)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 py-4">
          <nav className="mb-8">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path;

              return (
                <button
                  key={item.path}
                  onClick={() => handleNavigation(item.path)}
                  className={`w-full flex items-center gap-4 px-6 py-3 text-left cursor-pointer transition-all duration-200 min-h-[44px] border-l-3 ${
                    isActive
                      ? 'border-l-[var(--color-primary)]'
                      : 'border-l-transparent'
                  }`}
                  style={{
                    backgroundColor: isActive
                      ? 'var(--color-primary)20'
                      : 'transparent',
                    color: isActive
                      ? 'var(--color-primary)'
                      : 'var(--current-text-secondary)',
                    fontWeight: isActive ? '500' : '400',
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.backgroundColor =
                        'var(--current-border)';
                      e.currentTarget.style.color = 'var(--current-text)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.backgroundColor = 'transparent';
                      e.currentTarget.style.color =
                        'var(--current-text-secondary)';
                    }
                  }}
                >
                  <Icon size={20} />
                  {item.label}
                </button>
              );
            })}
          </nav>
        </div>

        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-4 px-6 py-3 text-left cursor-pointer transition-all duration-200 min-h-[44px]"
          style={{
            color: 'var(--current-text-secondary)',
            backgroundColor: 'transparent',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'var(--current-border)';
            e.currentTarget.style.color = 'var(--current-text)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
            e.currentTarget.style.color = 'var(--current-text-secondary)';
          }}
        >
          <LogOut size={20} />
          Logout
        </button>
      </div>
    </>
  );
};
