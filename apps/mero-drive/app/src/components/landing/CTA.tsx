import React from 'react';
import { Shield, Zap } from 'lucide-react';
import { CalimeroConnectButton } from '@calimero-network/calimero-client';

export const CTA: React.FC = () => {
  return (
    <section className="py-24 px-6">
      <div className="max-w-4xl mx-auto text-center">
        {/* Main CTA */}
        <div className="relative p-12 rounded-2xl bg-gradient-to-br from-primary/10 via-card to-secure/5 border border-primary/20 overflow-hidden">
          <div className="relative z-10">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium mb-6">
              <Zap className="w-4 h-4" />
              Ready to start
            </div>
            
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">
              Take back control of your documents
            </h2>
            
            <p className="text-text-secondary max-w-xl mx-auto mb-8">
              Start writing with confidence. Your documents stay private, 
              sync seamlessly, and work everywhere — with or without internet.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <CalimeroConnectButton />
              <div className="flex items-center gap-2 text-sm text-text-secondary">
                <Shield className="w-4 h-4 text-secure" />
                No account required
              </div>
            </div>
          </div>

          {/* Background decoration */}
          <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-3xl" />
          <div className="absolute bottom-0 left-0 w-48 h-48 bg-secure/5 rounded-full blur-3xl" />
        </div>

        {/* Trust indicators */}
        <div className="mt-12 flex flex-wrap items-center justify-center gap-8 text-text-tertiary text-sm">
          <span className="flex items-center gap-2">
            <CheckIcon /> Open Source
          </span>
          <span className="flex items-center gap-2">
            <CheckIcon /> No Tracking
          </span>
          <span className="flex items-center gap-2">
            <CheckIcon /> Self-Hostable
          </span>
          <span className="flex items-center gap-2">
            <CheckIcon /> Audit-Friendly
          </span>
        </div>
      </div>
    </section>
  );
};

const CheckIcon: React.FC = () => (
  <svg className="w-4 h-4 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
  </svg>
);
