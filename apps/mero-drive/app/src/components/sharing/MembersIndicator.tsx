import React, { useState, useEffect } from 'react';
import { useCalimero, apiClient } from '@calimero-network/calimero-client';
import { Users, Crown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface MembersIndicatorProps {
  contextId: string | null;
}

export const MembersIndicator: React.FC<MembersIndicatorProps> = ({ contextId }) => {
  const { app } = useCalimero();
  const [members, setMembers] = useState<string[]>([]);
  const [currentUser, setCurrentUser] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const fetchMembers = async () => {
      if (!contextId || !app) return;

      setIsLoading(true);
      try {
        // Fetch context identities (members)
        const response = await apiClient.node().getContextUsers(contextId);
        
        if (response.data?.identities) {
          setMembers(response.data.identities);
        }

        // Get current user's identity
        const contexts = await app.fetchContexts();
        const context = contexts.find(c => c.contextId === contextId);
        if (context) {
          setCurrentUser(context.executorId);
        }
      } catch (error) {
        console.error('Failed to fetch members:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchMembers();
    
    // Poll for member updates every 30 seconds
    const interval = setInterval(fetchMembers, 30000);
    return () => clearInterval(interval);
  }, [contextId, app]);

  if (!contextId || members.length === 0) {
    return null;
  }

  const formatMemberId = (id: string) => {
    if (id.length <= 12) return id;
    return `${id.slice(0, 6)}...${id.slice(-4)}`;
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/50 hover:bg-muted transition-colors text-sm">
          <Users className="w-4 h-4 text-muted-foreground" />
          <span className="text-muted-foreground">
            {members.length} {members.length === 1 ? 'member' : 'members'}
          </span>
          {/* Member avatars */}
          <div className="flex -space-x-2">
            {members.slice(0, 3).map((member, index) => (
              <div
                key={member}
                className="w-6 h-6 rounded-full bg-primary/20 border-2 border-card flex items-center justify-center text-xs font-medium text-primary"
                style={{ zIndex: members.length - index }}
                title={member}
              >
                {member.slice(0, 1).toUpperCase()}
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
      <DropdownMenuContent align="end" className="w-64">
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
              <div
                key={member}
                className="flex items-center gap-3 px-3 py-2 hover:bg-muted/50"
              >
                <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-sm font-medium text-primary">
                  {member.slice(0, 1).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-mono truncate">
                      {formatMemberId(member)}
                    </span>
                    {member === currentUser && (
                      <span className="text-xs text-primary">(you)</span>
                    )}
                  </div>
                </div>
                {/* Show crown for first member (likely the creator) */}
                {members.indexOf(member) === 0 && (
                  <Crown className="w-4 h-4 text-amber-500" title="Creator" />
                )}
              </div>
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default MembersIndicator;
