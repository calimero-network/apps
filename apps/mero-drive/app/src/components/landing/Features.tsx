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
      description: "All operations work offline. Your documents live on your device first, syncing only when you choose."
    },
    {
      icon: <Shield className="w-6 h-6" />,
      title: "End-to-End Encrypted",
      description: "Per-document encryption keys ensure only you and your collaborators can read your content. Zero-knowledge architecture."
    },
    {
      icon: <Wifi className="w-6 h-6" />,
      title: "Peer-to-Peer Sync",
      description: "Sync directly between devices using Calimero protocol. No central server storing your data."
    },
    {
      icon: <Users className="w-6 h-6" />,
      title: "Real-Time Collaboration",
      description: "See others' cursors and changes appear within seconds. Seamless editing even with intermittent connectivity."
    },
    {
      icon: <RefreshCw className="w-6 h-6" />,
      title: "CRDT-Based Merging",
      description: "Conflict-free replicated data types ensure your document always converges, no matter when peers sync."
    },
    {
      icon: <Lock className="w-6 h-6" />,
      title: "Private Keys, Your Control",
      description: "Protocol-bound private keys with user-friendly key management. No compromises on security."
    },
    {
      icon: <HardDrive className="w-6 h-6" />,
      title: "Full Data Ownership",
      description: "Export to .docx or .pdf anytime. Your documents are always accessible, always yours."
    },
    {
      icon: <FileText className="w-6 h-6" />,
      title: "Rich Text Editing",
      description: "Headings, lists, quotes, code blocks, links, and more. Everything you need for professional documents."
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
            Every feature in MeroDocs is designed with security-first thinking, 
            without sacrificing the editing experience you expect.
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
