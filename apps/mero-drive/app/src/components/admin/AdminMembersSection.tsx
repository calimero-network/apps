import React, { useState, useCallback, useEffect } from 'react';
import { useCalimero } from '@calimero-network/calimero-client';
import { WorkspaceManager, type MemberInfo } from '@/api/WorkspaceManager';
import { useWorkspace } from '@/context/WorkspaceContext';
import {
  decodeMemberCapabilitiesBitmask,
  encodeMemberCapabilitiesBitmask,
  type MemberCapabilityFlags,
} from '@/utils/groupCapabilities';
import { Button } from '@/components/ui/button';
import {
  Crown,
  Loader2,
  Check,
  AlertCircle,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';

const CAPABILITY_LABELS: { key: keyof MemberCapabilityFlags; label: string; description: string }[] = [
  { key: 'canCreateContext', label: 'Create folders', description: 'Can create new top-level folder contexts' },
  { key: 'canInviteMembers', label: 'Invite members', description: 'Can generate workspace invitation links' },
  { key: 'canJoinOpenContexts', label: 'Join open folders', description: 'Can access folders with open visibility' },
];

interface MemberRowState {
  flags: MemberCapabilityFlags | null;
  isLoadingCaps: boolean;
  isSaving: boolean;
  saveSuccess: boolean;
  error: string | null;
  dirty: boolean;
}

export const AdminMembersSection: React.FC = () => {
  const { app } = useCalimero();
  const { activeGroupId } = useWorkspace();

  const [members, setMembers] = useState<MemberInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [expandedMember, setExpandedMember] = useState<string | null>(null);
  const [rowStates, setRowStates] = useState<Record<string, MemberRowState>>({});

  const loadMembers = useCallback(async () => {
    if (!app || !activeGroupId) return;
    setIsLoading(true);
    try {
      const manager = new WorkspaceManager(app);
      const { members: list } = await manager.getWorkspaceMembers(activeGroupId);
      setMembers(list);
    } catch {
      // Non-blocking
    } finally {
      setIsLoading(false);
    }
  }, [app, activeGroupId]);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  const loadMemberCapabilities = useCallback(async (identity: string) => {
    if (!app || !activeGroupId) return;

    setRowStates((prev) => ({
      ...prev,
      [identity]: {
        ...prev[identity],
        isLoadingCaps: true,
        error: null,
        flags: null,
        dirty: false,
        saveSuccess: false,
        isSaving: false,
      },
    }));

    try {
      const manager = new WorkspaceManager(app);
      const mask = await manager.getMemberCapabilities(activeGroupId, identity);
      const flags = decodeMemberCapabilitiesBitmask(mask);
      setRowStates((prev) => ({
        ...prev,
        [identity]: { ...prev[identity], flags, isLoadingCaps: false },
      }));
    } catch {
      setRowStates((prev) => ({
        ...prev,
        [identity]: {
          ...prev[identity],
          flags: null,
          isLoadingCaps: false,
          error: 'Failed to load capabilities.',
        },
      }));
    }
  }, [app, activeGroupId]);

  const handleExpandMember = (identity: string) => {
    if (expandedMember === identity) {
      setExpandedMember(null);
      return;
    }
    setExpandedMember(identity);
    if (!rowStates[identity]?.flags) {
      void loadMemberCapabilities(identity);
    }
  };

  const handleToggle = (identity: string, key: keyof MemberCapabilityFlags) => {
    setRowStates((prev) => {
      const current = prev[identity];
      if (!current?.flags) return prev;
      return {
        ...prev,
        [identity]: {
          ...current,
          flags: { ...current.flags, [key]: !current.flags[key] },
          dirty: true,
          saveSuccess: false,
        },
      };
    });
  };

  const handleSave = async (identity: string) => {
    const state = rowStates[identity];
    if (!state?.flags || !app || !activeGroupId) return;

    setRowStates((prev) => ({
      ...prev,
      [identity]: { ...prev[identity], isSaving: true, error: null, saveSuccess: false },
    }));

    try {
      const manager = new WorkspaceManager(app);
      const mask = encodeMemberCapabilitiesBitmask(state.flags);
      await manager.setMemberCapabilities(activeGroupId, identity, mask);
      setRowStates((prev) => ({
        ...prev,
        [identity]: { ...prev[identity], isSaving: false, dirty: false, saveSuccess: true },
      }));
    } catch {
      setRowStates((prev) => ({
        ...prev,
        [identity]: { ...prev[identity], isSaving: false, error: 'Failed to save capabilities.' },
      }));
    }
  };

  const formatId = (id: string) => {
    if (id.length <= 16) return id;
    return `${id.slice(0, 8)}...${id.slice(-6)}`;
  };

  const getMemberDisplayName = (member: MemberInfo) => {
    return member.alias?.trim() || formatId(member.identity);
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading members...
      </div>
    );
  }

  if (members.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-8">
        No members found.
      </p>
    );
  }

  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground mb-3">
        {members.length} {members.length === 1 ? 'member' : 'members'} in this workspace. Expand a member to view or edit capabilities.
      </p>
      {members.map((member) => {
        const isExpanded = expandedMember === member.identity;
        const isAdmin = member.role === 'Admin';
        const state = rowStates[member.identity];

        return (
          <div key={member.identity} className="border border-border rounded-lg overflow-hidden">
            {/* Row header */}
            <button
              type="button"
              className="flex items-center gap-3 px-4 py-3 w-full text-left hover:bg-muted/30 transition-colors"
              onClick={() => handleExpandMember(member.identity)}
            >
              <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-sm font-medium text-primary flex-shrink-0">
                {(member.alias?.trim() || member.identity).charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <span className={`text-sm ${member.alias?.trim() ? '' : 'font-mono'}`}>
                  {getMemberDisplayName(member)}
                </span>
                {member.alias?.trim() && (
                  <p className="text-xs text-muted-foreground font-mono truncate">
                    {formatId(member.identity)}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {isAdmin ? (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-500">
                    <Crown className="w-3.5 h-3.5" />
                    Admin
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">Member</span>
                )}
                {isExpanded ? (
                  <ChevronDown className="w-4 h-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                )}
              </div>
            </button>

            {/* Expanded detail */}
            {isExpanded && (
              <div className="px-4 pb-4 pt-1 border-t border-border bg-muted/10">
                {state?.isLoadingCaps ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-3">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading capabilities...
                  </div>
                ) : state?.flags ? (
                  <div className="space-y-3 pt-2">
                    <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Capabilities
                    </h4>
                    {CAPABILITY_LABELS.map(({ key, label, description }) => (
                      <div key={key} className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm">{label}</p>
                          <p className="text-xs text-muted-foreground">{description}</p>
                        </div>
                        {!isAdmin ? (
                          <button
                            role="switch"
                            aria-checked={state.flags![key]}
                            onClick={() => handleToggle(member.identity, key)}
                            className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
                              state.flags![key] ? 'bg-primary' : 'bg-muted'
                            }`}
                          >
                            <span
                              className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
                                state.flags![key] ? 'translate-x-4' : 'translate-x-0'
                              }`}
                            />
                          </button>
                        ) : (
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-500 flex-shrink-0">
                            Yes
                          </span>
                        )}
                      </div>
                    ))}

                    {isAdmin && (
                      <p className="text-xs text-muted-foreground italic">
                        Admins have all capabilities by default.
                      </p>
                    )}

                    {state.error && (
                      <div className="flex items-center gap-2 text-xs text-destructive">
                        <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                        {state.error}
                      </div>
                    )}

                    {state.saveSuccess && !state.dirty && (
                      <div className="flex items-center gap-2 text-xs text-emerald-500">
                        <Check className="w-3.5 h-3.5 flex-shrink-0" />
                        Capabilities updated.
                      </div>
                    )}

                    {!isAdmin && (
                      <Button
                        size="sm"
                        onClick={() => handleSave(member.identity)}
                        disabled={!state.dirty || state.isSaving}
                        className="w-full mt-1"
                      >
                        {state.isSaving ? (
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
                ) : state?.error ? (
                  <div className="flex items-center gap-2 text-xs text-destructive py-3">
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                    {state.error}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground py-3">Capabilities unavailable.</p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default AdminMembersSection;
