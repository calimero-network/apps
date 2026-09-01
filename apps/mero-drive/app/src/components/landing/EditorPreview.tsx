import React from 'react';
import { 
  Bold, 
  Italic, 
  Underline, 
  List, 
  ListOrdered, 
  Quote, 
  Code, 
  Link,
  Heading1,
  Heading2,
  Shield,
  Users
} from 'lucide-react';
import { Button } from '@/components/ui/button';

export const EditorPreview: React.FC = () => {
  return (
    <section className="py-24 px-6 surface-sunken">
      <div className="max-w-6xl mx-auto">
        {/* Section Header */}
        <div className="text-center mb-12">
          <span className="text-primary font-medium text-sm uppercase tracking-wider mb-4 block">
            The Editor
          </span>
          <h2 className="text-3xl sm:text-4xl font-bold mb-4">
            Powerful. Familiar. Private.
          </h2>
          <p className="text-text-secondary max-w-2xl mx-auto">
            A full-featured document editor that feels like home, 
            with security indicators you can trust.
          </p>
        </div>

        {/* Editor Mockup */}
        <div className="relative max-w-4xl mx-auto animate-scale-in">
          <div className="rounded-xl border border-border bg-card shadow-elevated overflow-hidden">
            {/* Editor Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
              <div className="flex items-center gap-3">
                <div className="flex gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-destructive/80" />
                  <div className="w-3 h-3 rounded-full bg-warning" />
                  <div className="w-3 h-3 rounded-full bg-success" />
                </div>
                <span className="text-sm font-medium text-text-secondary">Project Proposal.mero</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5 security-badge">
                  <Shield className="w-3 h-3" />
                  <span>Encrypted</span>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-text-secondary">
                  <div className="sync-indicator synced" />
                  <span>Synced</span>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-text-tertiary">
                  <Users className="w-3.5 h-3.5" />
                  <span>2 online</span>
                </div>
              </div>
            </div>

            {/* Toolbar */}
            <div className="flex items-center gap-1 px-4 py-2 border-b border-border/50 bg-background">
              <ToolbarGroup>
                <Button variant="toolbar" size="icon">
                  <Heading1 className="w-4 h-4" />
                </Button>
                <Button variant="toolbar" size="icon">
                  <Heading2 className="w-4 h-4" />
                </Button>
              </ToolbarGroup>
              <ToolbarDivider />
              <ToolbarGroup>
                <Button variant="toolbar-active" size="icon">
                  <Bold className="w-4 h-4" />
                </Button>
                <Button variant="toolbar" size="icon">
                  <Italic className="w-4 h-4" />
                </Button>
                <Button variant="toolbar" size="icon">
                  <Underline className="w-4 h-4" />
                </Button>
              </ToolbarGroup>
              <ToolbarDivider />
              <ToolbarGroup>
                <Button variant="toolbar" size="icon">
                  <List className="w-4 h-4" />
                </Button>
                <Button variant="toolbar" size="icon">
                  <ListOrdered className="w-4 h-4" />
                </Button>
              </ToolbarGroup>
              <ToolbarDivider />
              <ToolbarGroup>
                <Button variant="toolbar" size="icon">
                  <Quote className="w-4 h-4" />
                </Button>
                <Button variant="toolbar" size="icon">
                  <Code className="w-4 h-4" />
                </Button>
                <Button variant="toolbar" size="icon">
                  <Link className="w-4 h-4" />
                </Button>
              </ToolbarGroup>
            </div>

            {/* Editor Content */}
            <div className="p-8 min-h-[400px] editor-content">
              <h1 className="text-3xl font-bold mb-4">Project Proposal: Decentralized Infrastructure</h1>
              <p className="mb-4 leading-relaxed text-foreground/90">
                This document outlines our approach to building <strong>resilient, 
                privacy-first</strong> infrastructure that operates independently 
                of centralized cloud providers.
              </p>
              <h2 className="text-2xl font-semibold mb-3 mt-8">Key Objectives</h2>
              <ul className="list-disc list-inside mb-4 space-y-1">
                <li>Eliminate single points of failure</li>
                <li>Ensure data sovereignty for all users</li>
                <li>Maintain performance parity with cloud solutions</li>
              </ul>
              <blockquote className="border-l-4 border-primary/40 pl-4 my-4 italic text-muted-foreground">
                "Privacy is not about having something to hide. It's about 
                having something to protect."
              </blockquote>
              <p className="mb-4 leading-relaxed text-foreground/90">
                Our implementation uses <code className="px-1.5 py-0.5 rounded bg-muted text-sm">CRDT-based</code> synchronization 
                to ensure conflict-free document merging across all connected peers.
              </p>

              {/* Fake cursor */}
              <div className="relative inline-block">
                <span className="absolute -top-6 left-0 px-1.5 py-0.5 rounded text-xs font-medium bg-blue-500 text-white whitespace-nowrap">
                  Alex
                </span>
                <div className="w-0.5 h-5 bg-blue-500 animate-pulse" />
              </div>
            </div>
          </div>

          {/* Decorative elements */}
          <div className="absolute -bottom-4 -right-4 w-32 h-32 bg-primary/10 rounded-full blur-2xl -z-10" />
          <div className="absolute -top-4 -left-4 w-24 h-24 bg-secure/10 rounded-full blur-2xl -z-10" />
        </div>
      </div>
    </section>
  );
};

const ToolbarGroup: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex items-center gap-0.5">{children}</div>
);

const ToolbarDivider: React.FC = () => (
  <div className="w-px h-6 bg-border mx-2" />
);
