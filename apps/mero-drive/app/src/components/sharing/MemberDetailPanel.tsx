import React, { useEffect, useState, useCallback } from 'react';
import { useCalimero } from '@calimero-network/calimero-client';
import { WorkspaceManager, type MemberInfo } from '@/api/WorkspaceManager';
import { useWorkspace } from '@/context/WorkspaceContext';
import {
  decodeMemberCapabilitiesBitmask,
  encodeMemberCapabilitiesBitmask,
  type MemberCapabilityFlags,
} from '@/utils/groupCapabilities';
import { X, Crown, Loader2, Check, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface MemberDetailPanelProps {
  member: MemberInfo;
  isAdmin: boolean;
  isOpen: boolean;
  onClose: () => void;
  onCapabilitiesSaved: () => void;
}

const CAPABILITY_LABELS: { key: keyof MemberCapabilityFlags; label: string; description: string }[] = [
  {
    key: 'canCreateContext',
    label: 'Create folders',
    description: 'Can create new top-level folder contexts',
  },
  {
    key: 'canInviteMembers',
    label: 'Invite members',
    description: 'Can generate workspace invitation links',
  },
  {
    key: 'canJoinOpenContexts',
    label: 'Join open folders',
    description: 'Can access folders with open visibility',
  },
];

export const MemberDetailPanel: React.FC<MemberDetailPanelProps> = ({
  member,
  isAdmin,
  isOpen,
  onClose,
  onCapabilitiesSaved,
}) => {
  const { app } = useCalimero();
  const { activeGroupId } = useWorkspace();

  const [flags, setFlags] = useState<MemberCapabilityFlags | null>(null);
  const [isLoadingCaps, setIsLoadingCaps] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const loadCapabilities = useCallback(async () => {
    if (!app || !activeGroupId) return;
    setIsLoadingCaps(true);
    setError(null);
    try {
      const manager = new WorkspaceManager(app);
      const mask = await manager.getMemberCapabilities(activeGroupId, member.identity);
      setFlags(decodeMemberCapabilitiesBitmask(mask));
      setDirty(false);
    } catch {
      setFlags(null);
      setError('Failed to load member capabilities.');
    } finally {
      setIsLoadingCaps(false);
    }
  }, [app, activeGroupId, member.identity]);

  useEffect(() => {
    if (isOpen) {
      void loadCapabilities();
      setSaveSuccess(false);
    }
  }, [isOpen, loadCapabilities]);

  if (!isOpen) return null;

  const formatMemberId = (id: string) => {
    if (id.length <= 20) return id;
    return `${id.slice(0, 10)}...${id.slice(-8)}`;
  };

  const handleToggle = (key: keyof MemberCapabilityFlags) => {
    if (!flags) return;
    setFlags({ ...flags, [key]: !flags[key] });
    setDirty(true);
    setSaveSuccess(false);
  };

  const handleSave = async () => {
    if (!flags || !app || !activeGroupId) return;
    setIsSaving(true);
    setError(null);
    setSaveSuccess(false);
    try {
      const manager = new WorkspaceManager(app);
      const mask = encodeMemberCapabilitiesBitmask(flags);
      await manager.setMemberCapabilities(activeGroupId, member.identity, mask);
      setDirty(false);
      setSaveSuccess(true);
      onCapabilitiesSaved();
    } catch {
      setError('Failed to save capability changes.');
    } finally {
      setIsSaving(false);
    }
  };

  const isTargetAdmin = member.role === 'Admin';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
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

        {/* Header */}
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center text-sm font-medium text-primary flex-shrink-0">
            {(member.alias?.trim() || member.identity).charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            {member.alias?.trim() && (
              <p className="text-sm font-medium truncate">{member.alias.trim()}</p>
            )}
            <p className="text-xs font-mono text-muted-foreground truncate" title={member.identity}>
              {formatMemberId(member.identity)}
            </p>
          </div>
        </div>

        {/* Role badge */}
        <div className="flex items-center gap-2 mb-4">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Role</span>
          <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
            isTargetAdmin
              ? 'bg-amber-500/15 text-amber-500'
              : 'bg-muted text-muted-foreground'
          }`}>
            {isTargetAdmin && <Crown className="w-3 h-3" />}
            {member.role}
          </span>
        </div>

        {/* Capabilities */}
        <div className="mb-4">
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
            Capabilities
          </h4>

          {isLoadingCaps ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading capabilities...
            </div>
          ) : flags ? (
            <div className="space-y-3">
              {CAPABILITY_LABELS.map(({ key, label, description }) => (
                <div key={key} className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm">{label}</p>
                    <p className="text-xs text-muted-foreground">{description}</p>
                  </div>

                  {isAdmin && !isTargetAdmin ? (
                    <button
                      role="switch"
                      aria-checked={flags[key]}
                      onClick={() => handleToggle(key)}
                      className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
                        flags[key] ? 'bg-primary' : 'bg-muted'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
                          flags[key] ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  ) : (
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${
                      flags[key]
                        ? 'bg-emerald-500/15 text-emerald-500'
                        : 'bg-muted text-muted-foreground'
                    }`}>
                      {flags[key] ? 'Yes' : 'No'}
                    </span>
                  )}
                </div>
              ))}

              {isTargetAdmin && (
                <p className="text-xs text-muted-foreground italic mt-2">
                  Admins have all capabilities by default.
                </p>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Capabilities unavailable.</p>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 text-xs text-destructive mb-3">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
            {error}
          </div>
        )}

        {/* Save success */}
        {saveSuccess && !dirty && (
          <div className="flex items-center gap-2 text-xs text-emerald-500 mb-3">
            <Check className="w-3.5 h-3.5 flex-shrink-0" />
            Capabilities updated.
          </div>
        )}

        {/* Save button (admin editing a non-admin) */}
        {isAdmin && !isTargetAdmin && flags && (
          <Button
            size="sm"
            className="w-full"
            onClick={handleSave}
            disabled={!dirty || isSaving}
          >
            {isSaving ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                Saving...
              </>
            ) : (
              'Save Changes'
            )}
          </Button>
        )}
      </div>
    </div>
  );
};

export default MemberDetailPanel;
