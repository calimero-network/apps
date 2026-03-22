import React, { useState } from 'react';
import { MemberInfo } from '@/api/WorkspaceManager';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useGroupPermissions } from '@/hooks/useGroupPermissions';
import { Users, Crown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MemberDetailPanel } from './MemberDetailPanel';

interface MembersIndicatorProps {
  contextId: string | null;
}

export const MembersIndicator: React.FC<MembersIndicatorProps> = ({ contextId }) => {
  const { activeGroupId } = useWorkspace();
  const { members, currentMemberIdentity, isAdmin, isLoading, refresh } = useGroupPermissions();

  const [selectedMember, setSelectedMember] = useState<MemberInfo | null>(null);

  React.useEffect(() => {
    if (!activeGroupId) return;
    const interval = setInterval(() => {
      void refresh();
    }, 30000);
    return () => clearInterval(interval);
  }, [activeGroupId, refresh]);

  if (!activeGroupId || members.length === 0) {
    return null;
  }

  const formatMemberId = (id: string) => {
    if (id.length <= 12) return id;
    return `${id.slice(0, 6)}...${id.slice(-4)}`;
  };

  const getMemberDisplayName = (member: MemberInfo) => {
    return member.alias?.trim() || formatMemberId(member.identity);
  };

  const getMemberInitial = (member: MemberInfo) => {
    const name = member.alias?.trim();
    if (name) return name.charAt(0).toUpperCase();
    return member.identity.slice(0, 1).toUpperCase();
  };

  const handleMemberClick = (member: MemberInfo) => {
    setSelectedMember(member);
  };

  const handleCapabilitiesSaved = () => {
    void refresh();
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/50 hover:bg-muted transition-colors text-sm">
            <Users className="w-4 h-4 text-muted-foreground" />
            <span className="text-muted-foreground">
              {members.length} {members.length === 1 ? 'member' : 'members'}
            </span>
            <div className="flex -space-x-2">
              {members.slice(0, 3).map((member, index) => (
                <div
                  key={member.identity}
                  className="w-6 h-6 rounded-full bg-primary/20 border-2 border-card flex items-center justify-center text-xs font-medium text-primary"
                  style={{ zIndex: members.length - index }}
                  title={getMemberDisplayName(member)}
                >
                  {getMemberInitial(member)}
                </div>
              ))}
              {members.length > 3 && (
                <div className="w-6 h-6 rounded-full bg-muted border-2 border-card flex items-center justify-center text-xs font-medium text-muted-foreground">
                  +{members.length - 3}
                </div>
              )}
            </div>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <div className="px-3 py-2 border-b border-border">
            <h4 className="font-medium text-sm">Workspace Members</h4>
            <p className="text-xs text-muted-foreground mt-0.5">
              {members.length} {members.length === 1 ? 'person has' : 'people have'} access
            </p>
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {isLoading ? (
              <div className="px-3 py-2 text-sm text-muted-foreground">
                Loading members...
              </div>
            ) : (
              members.map((member) => (
                <button
                  key={member.identity}
                  type="button"
                  className="flex items-center gap-3 px-3 py-2 hover:bg-muted/50 w-full text-left rounded-sm transition-colors"
                  onClick={() => handleMemberClick(member)}
                >
                  <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-sm font-medium text-primary flex-shrink-0">
                    {getMemberInitial(member)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm truncate ${member.alias?.trim() ? '' : 'font-mono'}`}>
                        {getMemberDisplayName(member)}
                      </span>
                      {member.identity === currentMemberIdentity && (
                        <span className="text-xs text-primary flex-shrink-0">(you)</span>
                      )}
                    </div>
                    {member.alias?.trim() && (
                      <p className="text-xs text-muted-foreground font-mono truncate">
                        {formatMemberId(member.identity)}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {member.role === 'Admin' ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-500">
                        <Crown className="w-3.5 h-3.5" />
                        Admin
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">Member</span>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      {selectedMember && (
        <MemberDetailPanel
          member={selectedMember}
          isAdmin={isAdmin}
          isOpen={!!selectedMember}
          onClose={() => setSelectedMember(null)}
          onCapabilitiesSaved={handleCapabilitiesSaved}
        />
      )}
    </>
  );
};

export default MembersIndicator;
