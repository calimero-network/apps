import React from 'react';
import { Menu, Sun, Moon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';

interface MobileHeaderProps {
  onMenuToggle: () => void;
}

export const MobileHeader: React.FC<MobileHeaderProps> = ({ onMenuToggle }) => {
  const { mode, toggleTheme } = useTheme();
  const navigate = useNavigate();

  return (
    <header
      className="fixed top-0 left-0 right-0 z-[100] border-b backdrop-blur-sm flex items-center justify-between px-4"
      style={{
        height: 'var(--spacing-mobile-header)',
        backgroundColor: 'var(--current-surface)',
        borderColor: 'var(--current-border)',
        boxShadow: 'var(--shadow-card)',
      }}
    >
      <div className="flex items-center gap-4">
        <button
          onClick={onMenuToggle}
          className="bg-transparent border-none p-2 rounded-lg cursor-pointer flex items-center justify-center min-w-[44px] min-h-[44px] transition-all duration-200 hover:bg-opacity-10 active:scale-95"
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
          <Menu size={24} />
        </button>

        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/')}
            className="bg-transparent border-none p-0 cursor-pointer transition-all duration-200 hover:opacity-80 active:scale-95"
            style={{ color: 'var(--current-text)' }}
          >
            <div
              className="text-lg font-semibold"
              style={{ color: 'var(--current-text)' }}
            >
              MeroDocs
            </div>
          </button>
        </div>
      </div>

      <div className="flex items-center">
        <button
          onClick={toggleTheme}
          className="bg-transparent border-none p-2 rounded-lg cursor-pointer flex items-center justify-center min-w-[44px] min-h-[44px] transition-all duration-200 hover:bg-opacity-10 active:scale-95"
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
          {mode === 'light' ? <Moon size={20} /> : <Sun size={20} />}
        </button>
      </div>
    </header>
  );
};
