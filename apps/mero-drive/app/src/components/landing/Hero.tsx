import React from 'react';
import { Button } from '@/components/ui/button';
import { LogoWithText } from '@/components/icons/Logo';
import { Shield, Wifi, WifiOff, Users } from 'lucide-react';

interface HeroProps {
  onConnect?: () => void;
}

export const Hero: React.FC<HeroProps> = ({ onConnect }) => {
  return (
    <section className="relative min-h-screen flex flex-col">
      {/* Navigation */}
      <nav className="w-full py-4 px-6 flex items-center justify-between">
        <LogoWithText size={28} />
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm">
            Features
          </Button>
          <Button variant="ghost" size="sm">
            Security
          </Button>
          <Button size="sm" onClick={onConnect}>
            Connect
          </Button>
        </div>
      </nav>

      {/* Hero Content */}
      <div className="flex-1 flex items-center justify-center px-6">
        <div className="max-w-4xl mx-auto text-center">
          {/* Security Badge */}
          <div className="inline-flex items-center gap-2 security-badge mb-8 animate-fade-in">
            <Shield className="w-3.5 h-3.5" />
            <span>End-to-End Encrypted</span>
          </div>

          {/* Main Headline */}
          <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight mb-6 animate-slide-up">
            Your files.
            <br />
            <span className="text-gradient">Your control.</span>
          </h1>

          {/* Subheadline */}
          <p className="text-lg sm:text-xl text-text-secondary max-w-2xl mx-auto mb-10 animate-slide-up" style={{ animationDelay: '0.1s' }}>
            A local-first, encrypted file drive that syncs peer-to-peer.
            No cloud dependencies. Full privacy. Seamless collaboration.
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16 animate-slide-up" style={{ animationDelay: '0.2s' }}>
            <Button size="xl" onClick={onConnect}>
              Get Started
            </Button>
            <Button variant="hero-outline" size="xl">
              Learn More
            </Button>
          </div>

          {/* Feature Pills */}
          <div className="flex flex-wrap items-center justify-center gap-3 animate-slide-up" style={{ animationDelay: '0.3s' }}>
            <FeaturePill icon={<WifiOff className="w-4 h-4" />} text="Works Offline" />
            <FeaturePill icon={<Shield className="w-4 h-4" />} text="Zero-Knowledge Encryption" />
            <FeaturePill icon={<Users className="w-4 h-4" />} text="Real-time Collaboration" />
            <FeaturePill icon={<Wifi className="w-4 h-4" />} text="P2P Sync" />
          </div>
        </div>
      </div>

      {/* Decorative gradient */}
      <div className="absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-primary/5 rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-primary/3 rounded-full blur-3xl" />
        <div className="absolute top-1/3 right-0 w-[300px] h-[300px] bg-secure/5 rounded-full blur-3xl" />
      </div>
    </section>
  );
};

const FeaturePill: React.FC<{ icon: React.ReactNode; text: string }> = ({ icon, text }) => (
  <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-muted/50 border border-border/50 text-sm text-text-secondary">
    <span className="text-primary">{icon}</span>
    {text}
  </div>
);
