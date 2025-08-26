import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Home, PenTool, X, Copy, Check } from 'lucide-react';
import { useIcpAuth } from '../contexts/IcpAuthContext';
import { CalimeroConnectButton } from '@calimero-network/calimero-client';
import { useDefaultContext } from '../hooks/useDefaultContext';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ isOpen, onClose }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const icpAuth = useIcpAuth();
  const [isCopying, setIsCopying] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(false);
  const { isCreating: isCreatingDefaultContext, error: defaultContextError } =
    useDefaultContext();

  const navItems = [
    { icon: Home, label: 'Dashboard', path: '/' },
    { icon: PenTool, label: 'Signatures', path: '/signatures' },
  ];

  const handleNavigation = (path: string) => {
    navigate(path);
    onClose();
  };

  const handleIcpLogin = async () => {
    setIsLoading(true);
    try {
      await icpAuth.login();
    } catch (error) {
      console.error('ICP Login failed:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleIcpLogout = async () => {
    setIsLoading(true);
    try {
      await icpAuth.logout();
    } catch (error) {
      console.error('ICP Logout failed:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const formatPrincipal = (principal: string) => {
    if (principal.length > 20) {
      return `${principal.slice(0, 8)}...${principal.slice(-8)}`;
    }
    return principal;
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

        {/* Show loading indicator when creating default context */}
        {isCreatingDefaultContext && (
          <div className="px-6 py-2 bg-blue-50 border-l-4 border-blue-400">
            <div className="flex items-center">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-2"></div>
              <span className="text-sm text-blue-700">
                Setting up your workspace...
              </span>
            </div>
          </div>
        )}

        {/* Navigation */}
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

        {/* ICP Auth Button & Calimero Connect Button */}
        <div className="px-6 pb-6 flex flex-col items-center space-y-4 w-full">
          {icpAuth.isAuthenticated && icpAuth.principal ? (
            <div className="flex flex-col items-center space-y-4 w-full">
              {/* ICP Info */}
              <div className="flex flex-col items-center space-y-2 w-full">
                <div
                  className="flex h-8 w-8 items-center justify-center rounded-full mb-1"
                  style={{
                    background:
                      'linear-gradient(135deg, var(--color-primary) 0%, #8ce619 100%)',
                  }}
                >
                  <svg
                    className="h-4 w-4 text-white"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z"
                      clipRule="evenodd"
                    />
                  </svg>
                </div>
                <p
                  className="text-sm font-medium"
                  style={{ color: 'var(--current-text)' }}
                >
                  Connected
                </p>
                <div className="flex items-center space-x-2">
                  <p
                    className="text-xs"
                    style={{ color: 'var(--current-text-secondary)' }}
                    title={icpAuth.principal.toText()}
                  >
                    {formatPrincipal(icpAuth.principal.toText())}
                  </p>
                  <button
                    onClick={async () => {
                      try {
                        setIsCopying(true);
                        await navigator.clipboard.writeText(
                          icpAuth.principal ? icpAuth.principal.toText() : '',
                        );
                        setTimeout(() => setIsCopying(false), 1500);
                      } catch (err) {
                        console.error('Failed to copy principal', err);
                        setIsCopying(false);
                      }
                    }}
                    aria-label="Copy ICP principal"
                    title="Copy full ICP principal"
                    className="inline-flex items-center justify-center p-1 rounded-md"
                    style={{
                      backgroundColor: 'var(--current-surface)',
                      border: '1px solid var(--current-border)',
                      color: 'var(--color-primary)',
                    }}
                  >
                    {isCopying ? (
                      <Check className="w-3 h-3" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                  </button>
                </div>
              </div>
              {/* Disconnect Button */}
              <button
                onClick={handleIcpLogout}
                disabled={isLoading}
                className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium shadow hover:shadow-lg transition-all duration-150 disabled:opacity-50 w-full justify-center"
                style={{
                  background:
                    'linear-gradient(135deg, var(--color-primary) 0%, #8ce619 100%)',
                  color: 'var(--color-background-dark)',
                  border: 'none',
                }}
                aria-label="Disconnect ICP"
                title="Disconnect Internet Identity"
              >
                <svg
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                  />
                </svg>
                <span className="hidden sm:inline">Disconnect</span>
              </button>
            </div>
          ) : (
            <button
              onClick={handleIcpLogin}
              disabled={isLoading}
              className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium shadow hover:shadow-lg transition-all duration-150 disabled:opacity-50 w-full justify-center"
              style={{
                background:
                  'linear-gradient(135deg, var(--color-primary) 0%, #8ce619 100%)',
                color: 'var(--color-background-dark)',
                border: 'none',
              }}
              aria-label="Connect ICP"
              title="Connect with Internet Identity"
            >
              {isLoading ? (
                <div
                  className="h-4 w-4 animate-spin rounded-full border-b-2"
                  style={{ borderColor: 'var(--color-background-dark)' }}
                />
              ) : (
                <svg
                  className="h-4 w-4"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M3 3a1 1 0 000 2v8a2 2 0 002 2h2.586l-1.293 1.293a1 1 0 101.414 1.414L10 15.414l2.293 2.293a1 1 0 001.414-1.414L12.414 15H15a2 2 0 002-2V5a1 1 0 100-2H3zm11.707 4.707a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                    clipRule="evenodd"
                  />
                </svg>
              )}
              <span className="hidden sm:inline">Connect</span>
            </button>
          )}
          {/* Calimero Connect Button centered below */}
          <div className="w-full flex justify-center">
            <CalimeroConnectButton />
          </div>
        </div>
      </div>
    </>
  );
};
