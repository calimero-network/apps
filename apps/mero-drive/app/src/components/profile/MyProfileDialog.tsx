import React, { useEffect, useState } from 'react';
import { useCalimero } from '@calimero-network/calimero-client';
import { WorkspaceManager } from '@/api/WorkspaceManager';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useGroupPermissions } from '@/hooks/useGroupPermissions';
import { Button } from '@/components/ui/button';
import { X, Loader2, Check, AlertCircle, Crown } from 'lucide-react';

interface MyProfileDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export const MyProfileDialog: React.FC<MyProfileDialogProps> = ({ isOpen, onClose }) => {
  const { app } = useCalimero();
  const { activeGroupId } = useWorkspace();
  const { currentMemberIdentity, isAdmin, members, refresh } = useGroupPermissions();

  const [alias, setAlias] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentMember = members.find(
    (m) => m.identity.trim().toLowerCase() === currentMemberIdentity?.trim().toLowerCase(),
  );

  useEffect(() => {
    if (isOpen) {
      setAlias(currentMember?.alias?.trim() ?? '');
      setError(null);
      setSaveSuccess(false);
    }
  }, [isOpen, currentMember?.alias]);

  if (!isOpen) return null;

  const formatId = (id: string) => {
    if (id.length <= 20) return id;
    return `${id.slice(0, 10)}...${id.slice(-8)}`;
  };

  const handleSave = async () => {
    if (!app || !activeGroupId || !currentMemberIdentity) return;
    const trimmed = alias.trim();
    setIsSaving(true);
    setError(null);
    setSaveSuccess(false);
    try {
      const manager = new WorkspaceManager(app);
      await manager.setMemberAlias(activeGroupId, currentMemberIdentity, trimmed);
      setSaveSuccess(true);
      await refresh();
    } catch (err) {
      console.error('[MyProfileDialog] alias save failed:', err);
      setError('Failed to update alias.');
    } finally {
      setIsSaving(false);
    }
  };

  const hasChanged = alias.trim() !== (currentMember?.alias?.trim() ?? '');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-xl shadow-lg w-full max-w-sm p-6 relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="absolute top-4 right-4 text-muted-foreground hover:text-foreground"
          onClick={onClose}
        >
          <X className="w-4 h-4" />
        </button>

        <h2 className="text-base font-semibold mb-5">My Profile</h2>

        {/* Identity */}
        <div className="mb-4">
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
            Identity
          </label>
          <div className="px-3 py-2 bg-muted/50 rounded-lg text-sm font-mono text-muted-foreground truncate" title={currentMemberIdentity ?? ''}>
            {currentMemberIdentity ? formatId(currentMemberIdentity) : 'Unknown'}
          </div>
        </div>

        {/* Role */}
        <div className="mb-4">
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
            Role
          </label>
          <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
            isAdmin
              ? 'bg-amber-500/15 text-amber-500'
              : 'bg-muted text-muted-foreground'
          }`}>
            {isAdmin && <Crown className="w-3 h-3" />}
            {currentMember?.role ?? 'Member'}
          </span>
        </div>

        {/* Alias */}
        <div className="mb-5">
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
            Display Name (Alias)
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={alias}
              onChange={(e) => {
                setAlias(e.target.value);
                setSaveSuccess(false);
              }}
              onKeyDown={(e) => e.key === 'Enter' && hasChanged && handleSave()}
              placeholder="Enter a display name..."
              className="flex-1 px-3 py-1.5 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30"
              disabled={isSaving}
            />
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!hasChanged || isSaving}
            >
              {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Save'}
            </Button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 text-xs text-destructive mb-2">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
            {error}
          </div>
        )}

        {/* Success */}
        {saveSuccess && !hasChanged && (
          <div className="flex items-center gap-2 text-xs text-emerald-500 mb-2">
            <Check className="w-3.5 h-3.5 flex-shrink-0" />
            Alias updated.
          </div>
        )}
      </div>
    </div>
  );
};

export default MyProfileDialog;
