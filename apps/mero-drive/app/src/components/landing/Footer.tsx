import React from 'react';
import { LogoWithText } from '@/components/icons/Logo';
import { Github, Twitter } from 'lucide-react';

export const Footer: React.FC = () => {
  return (
    <footer className="py-12 px-6 border-t border-border">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-8">
            <LogoWithText size={24} textClassName="text-lg" />
            <nav className="flex items-center gap-6 text-sm text-text-secondary">
              <a href="https://docs.calimero.network" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">Documentation</a>
              <a href="https://calimero.network/privacy" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">Privacy</a>
              <a href="https://calimero.network/security" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">Security</a>
            </nav>
          </div>
          
          <div className="flex items-center gap-4">
            <a 
              href="https://github.com/calimero-network" 
              target="_blank"
              rel="noopener noreferrer"
              className="w-10 h-10 rounded-lg flex items-center justify-center text-text-secondary hover:text-foreground hover:bg-muted transition-colors"
            >
              <Github className="w-5 h-5" />
            </a>
            <a 
              href="https://twitter.com/CalimeroBridge" 
              target="_blank"
              rel="noopener noreferrer"
              className="w-10 h-10 rounded-lg flex items-center justify-center text-text-secondary hover:text-foreground hover:bg-muted transition-colors"
            >
              <Twitter className="w-5 h-5" />
            </a>
          </div>
        </div>
        
        <div className="mt-8 pt-8 border-t border-border/50 text-center text-sm text-text-tertiary">
          <p>© 2026 Mero Drive. Built for privacy. Powered by Calimero.</p>
        </div>
      </div>
    </footer>
  );
};
