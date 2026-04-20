import React, { useState } from 'react';
import { X, Users, FolderCog, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AdminMembersSection } from './AdminMembersSection';
import { AdminFoldersSection } from './AdminFoldersSection';
import { AdminDefaultsSection } from './AdminDefaultsSection';

type AdminTab = 'members' | 'folders' | 'settings';

interface AdminPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const TABS: { id: AdminTab; label: string; icon: React.ElementType }[] = [
  { id: 'members', label: 'Members', icon: Users },
  { id: 'folders', label: 'Folders', icon: FolderCog },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export const AdminPanel: React.FC<AdminPanelProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<AdminTab>('members');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-xl shadow-lg w-full max-w-2xl max-h-[80vh] flex flex-col relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-amber-500/10 flex items-center justify-center">
              <Settings className="w-5 h-5 text-amber-500" />
            </div>
            <div>
              <h2 className="text-base font-semibold">Workspace Admin</h2>
              <p className="text-xs text-muted-foreground">Manage members, folders, and defaults</p>
            </div>
          </div>
          <button
            className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
            onClick={onClose}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border px-6 flex-shrink-0">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px',
                  activeTab === tab.id
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border',
                )}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'members' && <AdminMembersSection />}
          {activeTab === 'folders' && <AdminFoldersSection />}
          {activeTab === 'settings' && <AdminDefaultsSection />}
        </div>
      </div>
    </div>
  );
};

export default AdminPanel;
