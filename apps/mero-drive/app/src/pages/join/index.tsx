import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useCalimero } from '@calimero-network/calimero-client';
import { adminRequest } from '@/api/AdminApi';
import { WorkspaceManager } from '@/api/WorkspaceManager';
import { setGroupMemberIdentity } from '@/constants/config';
import { parseGroupInvitationPayload, GroupInvitationPayload } from '@/utils/invitation';
import { Button } from '@/components/ui/button';
import { LogoWithText } from '@/components/icons/Logo';
import {
  Users,
  Loader2,
  Check,
  AlertCircle,
  HardDrive,
  ArrowRight,
  Shield,
} from 'lucide-react';

const JoinPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { app, isAuthenticated } = useCalimero();

  const [status, setStatus] = useState<'idle' | 'parsing' | 'joining' | 'success' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [parsedPayload, setParsedPayload] = useState<GroupInvitationPayload | null>(null);
  const [manualPayload, setManualPayload] = useState('');

  useEffect(() => {
    const inviteParam = searchParams.get('invite');
    if (inviteParam) {
      handleParseInvitation(inviteParam);
    }
  }, [searchParams]);

  const handleParseInvitation = (payload: string) => {
    setStatus('parsing');
    setError(null);

    try {
      const parsed = parseGroupInvitationPayload(payload);
      setParsedPayload(parsed);
      setStatus('idle');
    } catch (err) {
      console.error('Failed to parse invitation:', err);
      setError('Invalid invitation link. Please check the link and try again.');
      setStatus('error');
    }
  };

  const handleJoin = async () => {
    if (!parsedPayload) {
      setError('No valid invitation to join');
      return;
    }

    if (!isAuthenticated) {
      sessionStorage.setItem('pendingInvitation', JSON.stringify(parsedPayload));
      navigate('/?returnTo=/join');
      return;
    }

    setStatus('joining');
    setError(null);

    try {
      const joinResult = await adminRequest<{ groupId?: string; memberIdentity?: string }>('/groups/join', {
        method: 'POST',
        body: {
          invitation: parsedPayload.invitation,
          groupAlias: parsedPayload.groupAlias,
        },
      });

      // Auto-join the General context so the new member has immediate access
      const groupId = joinResult?.groupId;
      if (groupId && joinResult?.memberIdentity) {
        setGroupMemberIdentity(groupId, joinResult.memberIdentity);
      }
      if (groupId) {
        try {
          const manager = new WorkspaceManager(app ?? null);
          const generalContextId = await manager.resolveGeneralContextId(groupId);
          if (generalContextId) {
            await manager.joinContextViaGroup(groupId, generalContextId);
          }
        } catch {
          // Non-blocking: the user can still navigate to home
        }
      }

      setStatus('success');
      sessionStorage.removeItem('pendingInvitation');

      setTimeout(() => {
        navigate('/home');
      }, 2000);
    } catch (err) {
      console.error('Failed to join workspace:', err);
      setError(err instanceof Error ? err.message : 'Failed to join workspace');
      setStatus('error');
    }
  };

  const handleManualJoin = () => {
    if (manualPayload.trim()) {
      handleParseInvitation(manualPayload.trim());
    }
  };

  useEffect(() => {
    if (isAuthenticated && !parsedPayload) {
      const pending = sessionStorage.getItem('pendingInvitation');
      if (pending) {
        try {
          const parsed = JSON.parse(pending) as GroupInvitationPayload;
          setParsedPayload(parsed);
        } catch {
          sessionStorage.removeItem('pendingInvitation');
        }
      }
    }
  }, [isAuthenticated, parsedPayload]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="p-4 border-b border-border">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <LogoWithText size={28} />
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Shield className="w-4 h-4 text-primary" />
            End-to-End Encrypted
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <div className="bg-card border border-border rounded-xl shadow-elevated overflow-hidden">
            {/* Card Header */}
            <div className="p-6 border-b border-border text-center">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                {status === 'success' ? (
                  <Check className="w-8 h-8 text-green-500" />
                ) : status === 'error' ? (
                  <AlertCircle className="w-8 h-8 text-destructive" />
                ) : (
                  <Users className="w-8 h-8 text-primary" />
                )}
              </div>
              <h1 className="text-xl font-semibold mb-2">
                {status === 'success'
                  ? 'Successfully Joined!'
                  : status === 'error'
                  ? 'Unable to Join'
                  : 'Join Workspace'}
              </h1>
              <p className="text-sm text-muted-foreground">
                {status === 'success'
                  ? 'You now have access to the shared workspace.'
                  : status === 'error'
                  ? error || 'Something went wrong'
                  : parsedPayload
                  ? 'You\'ve been invited to a shared workspace.'
                  : 'Enter an invitation to join a shared workspace.'}
              </p>
            </div>

            {/* Card Body */}
            <div className="p-6 space-y-4">
              {status === 'success' ? (
                <div className="text-center space-y-4">
                  <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                    <HardDrive className="w-4 h-4" />
                    <span>Redirecting to your files...</span>
                  </div>
                  <Button onClick={() => navigate('/home')} className="w-full gap-2">
                    Go to Files
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                </div>
              ) : parsedPayload ? (
                <div className="space-y-4">
                  {parsedPayload.groupAlias && (
                    <div className="p-4 bg-muted/50 rounded-lg">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Workspace</span>
                        <span className="font-medium">{parsedPayload.groupAlias}</span>
                      </div>
                    </div>
                  )}

                  {error && (
                    <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                      {error}
                    </div>
                  )}

                  {!isAuthenticated ? (
                    <div className="space-y-3">
                      <p className="text-sm text-muted-foreground text-center">
                        You need to sign in before joining the workspace.
                      </p>
                      <Button
                        onClick={() => {
                          sessionStorage.setItem('pendingInvitation', JSON.stringify(parsedPayload));
                          navigate('/');
                        }}
                        className="w-full gap-2"
                        size="lg"
                      >
                        Sign In to Join
                        <ArrowRight className="w-4 h-4" />
                      </Button>
                    </div>
                  ) : (
                    <Button
                      onClick={handleJoin}
                      disabled={status === 'joining'}
                      className="w-full gap-2"
                      size="lg"
                    >
                      {status === 'joining' ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Joining...
                        </>
                      ) : (
                        <>
                          <Users className="w-4 h-4" />
                          Join Workspace
                        </>
                      )}
                    </Button>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Manual Payload Entry */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium">
                      Invitation Code
                    </label>
                    <textarea
                      value={manualPayload}
                      onChange={(e) => setManualPayload(e.target.value)}
                      placeholder="Paste your invitation code here..."
                      className="w-full p-3 bg-muted border border-border rounded-lg text-sm font-mono resize-none h-24 focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>

                  {error && (
                    <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                      {error}
                    </div>
                  )}

                  <Button
                    onClick={handleManualJoin}
                    disabled={!manualPayload.trim() || status === 'parsing'}
                    className="w-full gap-2"
                    size="lg"
                  >
                    {status === 'parsing' ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Validating...
                      </>
                    ) : (
                      <>
                        <ArrowRight className="w-4 h-4" />
                        Continue
                      </>
                    )}
                  </Button>

                  <p className="text-xs text-muted-foreground text-center">
                    Don't have an invitation? Ask a workspace member to share
                    an invitation link with you.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default JoinPage;
