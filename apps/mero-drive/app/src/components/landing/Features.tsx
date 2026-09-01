import React from 'react';
import { 
  Shield, 
  Wifi, 
  WifiOff, 
  Users, 
  Lock, 
  RefreshCw, 
  HardDrive,
  FileText
} from 'lucide-react';

interface FeatureCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  delay?: number;
}

const FeatureCard: React.FC<FeatureCardProps> = ({ icon, title, description, delay = 0 }) => (
  <div 
    className="group p-6 rounded-xl bg-card border border-border/50 hover:border-primary/30 hover:shadow-elevated transition-all duration-300 animate-slide-up"
    style={{ animationDelay: `${delay}s` }}
  >
    <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
      <span className="text-primary">{icon}</span>
    </div>
    <h3 className="text-lg font-semibold mb-2">{title}</h3>
    <p className="text-text-secondary text-sm leading-relaxed">{description}</p>
  </div>
);

export const Features: React.FC = () => {
  const features = [
    {
      icon: <WifiOff className="w-6 h-6" />,
      title: "Local-First",
      description: "All operations work offline. Your files live on your device first, syncing only when you choose."
    },
    {
      icon: <Shield className="w-6 h-6" />,
      title: "End-to-End Encrypted",
      description: "Per-file encryption ensures only you and your collaborators can access your content. Zero-knowledge architecture."
    },
    {
      icon: <Wifi className="w-6 h-6" />,
      title: "Peer-to-Peer Sync",
      description: "Sync directly between devices using Calimero protocol. No central server storing your data."
    },
    {
      icon: <Users className="w-6 h-6" />,
      title: "Workspace Collaboration",
      description: "Invite collaborators to shared workspaces. Upload, organize, and access files together securely."
    },
    {
      icon: <RefreshCw className="w-6 h-6" />,
      title: "CRDT-Based Merging",
      description: "Conflict-free replicated data types ensure your data always converges, no matter when peers sync."
    },
    {
      icon: <Lock className="w-6 h-6" />,
      title: "Private Keys, Your Control",
      description: "Protocol-bound private keys with user-friendly key management. No compromises on security."
    },
    {
      icon: <HardDrive className="w-6 h-6" />,
      title: "Full Data Ownership",
      description: "Download your files anytime. Your data is always accessible, always yours."
    },
    {
      icon: <FileText className="w-6 h-6" />,
      title: "Folder Organization",
      description: "Create folders across workspaces and contexts. Organize files the way that works for you."
    },
  ];

  return (
    <section className="py-24 px-6">
      <div className="max-w-6xl mx-auto">
        {/* Section Header */}
        <div className="text-center mb-16">
          <span className="text-primary font-medium text-sm uppercase tracking-wider mb-4 block">
            Features
          </span>
          <h2 className="text-3xl sm:text-4xl font-bold mb-4">
            Built for Privacy.<br />Designed for Productivity.
          </h2>
          <p className="text-text-secondary max-w-2xl mx-auto">
            Every feature in Mero Drive is designed with security-first thinking,
            without sacrificing the experience you expect.
          </p>
        </div>

        {/* Feature Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {features.map((feature, index) => (
            <FeatureCard
              key={feature.title}
              {...feature}
              delay={index * 0.05}
            />
          ))}
        </div>
      </div>
    </section>
  );
};
