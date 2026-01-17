import React from 'react';
import { Wifi, WifiOff, ArrowLeft } from 'lucide-react';

interface CalimeroConnectionRequiredProps {
  onOpenSidebar?: () => void;
}

export const CalimeroConnectionRequired: React.FC<
  CalimeroConnectionRequiredProps
> = ({ onOpenSidebar }) => {
  return (
    <div className="flex items-center justify-center min-h-[60vh] py-12">
      <div className="max-w-md w-full mx-4">
        <div
          className="rounded-lg shadow-lg p-8 text-center border"
          style={{
            backgroundColor: 'var(--current-surface)',
            borderColor: 'var(--current-border)',
          }}
        >
          {/* Icon */}
          <div
            className="mx-auto w-16 h-16 mb-6 flex items-center justify-center rounded-full"
            style={{
              backgroundColor: 'var(--color-primary)20',
            }}
          >
            <WifiOff
              className="w-8 h-8"
              style={{ color: 'var(--color-primary)' }}
            />
          </div>

          {/* Title */}
          <h2
            className="text-2xl font-bold mb-4"
            style={{ color: 'var(--current-text)' }}
          >
            Calimero Connection Required
          </h2>

          {/* Description */}
          <p
            className="mb-6 leading-relaxed"
            style={{ color: 'var(--current-text-secondary)' }}
          >
            To access MeroSign, you need to connect to the Calimero network.
            This enables secure document signing and sharing capabilities.
          </p>

          {/* Features list */}
          <div className="text-left mb-8 space-y-3">
            <div className="flex items-center">
              <div
                className="w-2 h-2 rounded-full mr-3"
                style={{ backgroundColor: 'var(--color-primary)' }}
              ></div>
              <span
                className="text-sm"
                style={{ color: 'var(--current-text-secondary)' }}
              >
                Secure document storage
              </span>
            </div>
            <div className="flex items-center">
              <div
                className="w-2 h-2 rounded-full mr-3"
                style={{ backgroundColor: 'var(--color-primary)' }}
              ></div>
              <span
                className="text-sm"
                style={{ color: 'var(--current-text-secondary)' }}
              >
                Digital signature capabilities
              </span>
            </div>
            <div className="flex items-center">
              <div
                className="w-2 h-2 rounded-full mr-3"
                style={{ backgroundColor: 'var(--color-primary)' }}
              ></div>
              <span
                className="text-sm"
                style={{ color: 'var(--current-text-secondary)' }}
              >
                Collaborative workflows
              </span>
            </div>
            <div className="flex items-center">
              <div
                className="w-2 h-2 rounded-full mr-3"
                style={{ backgroundColor: 'var(--color-primary)' }}
              ></div>
              <span
                className="text-sm"
                style={{ color: 'var(--current-text-secondary)' }}
              >
                Decentralized infrastructure
              </span>
            </div>
          </div>

          {/* Action button */}
          <button
            onClick={onOpenSidebar}
            className="inline-flex items-center justify-center w-full px-6 py-3 font-medium rounded-lg transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2"
            style={{
              backgroundColor: 'var(--color-primary)',
              color: 'var(--color-background-dark)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.opacity = '0.9';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.opacity = '1';
            }}
          >
            <ArrowLeft className="w-5 h-5 mr-2" />
            Open Sidebar to Connect
          </button>

          {/* Help text */}
          <div
            className="mt-6 p-4 rounded-lg"
            style={{
              backgroundColor: 'var(--current-border)',
            }}
          >
            <div className="flex items-start">
              <Wifi
                className="w-5 h-5 mt-0.5 mr-3 flex-shrink-0"
                style={{ color: 'var(--color-primary)' }}
              />
              <div className="text-left">
                <p
                  className="text-sm font-medium mb-1"
                  style={{ color: 'var(--current-text)' }}
                >
                  How to connect:
                </p>
                <p
                  className="text-xs"
                  style={{ color: 'var(--current-text-secondary)' }}
                >
                  1. Click the button above to open the sidebar
                  <br />
                  2. Look for the "Connect" button at the bottom
                  <br />
                  3. Follow the connection prompts
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
