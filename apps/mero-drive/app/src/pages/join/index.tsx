import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useCalimero, apiClient, SignedOpenInvitation } from '@calimero-network/calimero-client';
import { Button } from '@/components/ui/button';
import { LogoWithText } from '@/components/icons/Logo';
import {
  Users,
  Loader2,
  Check,
  AlertCircle,
  FileText,
  ArrowRight,
  Shield,
} from 'lucide-react';

const JoinPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { app, isAuthenticated } = useCalimero();

  const [status, setStatus] = useState<'idle' | 'parsing' | 'joining' | 'success' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [invitation, setInvitation] = useState<SignedOpenInvitation | null>(null);
  const [manualPayload, setManualPayload] = useState('');

  // Parse invitation from URL on mount
  useEffect(() => {
    const inviteParam = searchParams.get('invite');
    if (inviteParam) {
      parseInvitation(inviteParam);
    }
  }, [searchParams]);

  const parseInvitation = (payload: string) => {
    setStatus('parsing');
    setError(null);

    try {
      // Decode base64 payload
      const decoded = atob(payload);
      const parsed = JSON.parse(decoded);

      console.log('[JoinPage] Parsed invitation:', parsed);

      // Validate the invitation structure - handle both snake_case and camelCase
      const hasInvitation = parsed.invitation;
      const hasSignature = parsed.inviter_signature || parsed.inviterSignature;
      
      if (!hasInvitation || !hasSignature) {
        throw new Error('Invalid invitation format');
      }

      // Check for required fields in invitation (handle both cases)
      const contextId = parsed.invitation.context_id || parsed.invitation.contextId;
      const inviterIdentity = parsed.invitation.inviter_identity || parsed.invitation.inviterIdentity;
      
      if (!contextId || !inviterIdentity) {
        throw new Error('Invitation missing required fields');
      }

      setInvitation(parsed as SignedOpenInvitation);
      setStatus('idle');
    } catch (err) {
      console.error('Failed to parse invitation:', err);
      setError('Invalid invitation link. Please check the link and try again.');
      setStatus('error');
    }
  };

  const handleJoin = async () => {
    if (!invitation) {
      setError('No valid invitation to join');
      return;
    }

    if (!isAuthenticated) {
      // Store invitation and redirect to login
      sessionStorage.setItem('pendingInvitation', JSON.stringify(invitation));
      navigate('/?returnTo=/join');
      return;
    }

    if (!app) {
      setError('App not connected. Please try again.');
      return;
    }

    setStatus('joining');
    setError(null);

    try {
      // Get or create the user's identity
      const identityResponse = await apiClient.node().createNewIdentity();
      
      if (identityResponse.error) {
        throw new Error(identityResponse.error.message || 'Failed to create identity');
      }

      const newMemberPublicKey = identityResponse.data?.publicKey;
      
      if (!newMemberPublicKey) {
        throw new Error('Failed to get member public key');
      }

      // Join the context using the open invitation
      const joinResponse = await apiClient.node().joinContextByOpenInvitation(
        invitation,
        newMemberPublicKey
      );

      if (joinResponse.error) {
        throw new Error(joinResponse.error.message || 'Failed to join workspace');
      }

      setStatus('success');

      // Clear any stored invitation
      sessionStorage.removeItem('pendingInvitation');

      // Redirect to home after a brief delay
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
      parseInvitation(manualPayload.trim());
    }
  };

  // Check for pending invitation from login redirect
  useEffect(() => {
    if (isAuthenticated && !invitation) {
      const pending = sessionStorage.getItem('pendingInvitation');
      if (pending) {
        try {
          const parsed = JSON.parse(pending) as SignedOpenInvitation;
          setInvitation(parsed);
        } catch {
          sessionStorage.removeItem('pendingInvitation');
        }
      }
    }
  }, [isAuthenticated, invitation]);

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
                  ? 'You now have access to the shared documents.'
                  : status === 'error'
                  ? error || 'Something went wrong'
                  : invitation
                  ? 'You\'ve been invited to collaborate on documents.'
                  : 'Enter an invitation to join a shared workspace.'}
              </p>
            </div>

            {/* Card Body */}
            <div className="p-6 space-y-4">
              {status === 'success' ? (
                <div className="text-center space-y-4">
                  <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                    <FileText className="w-4 h-4" />
                    <span>Redirecting to your documents...</span>
                  </div>
                  <Button onClick={() => navigate('/home')} className="w-full gap-2">
                    Go to Documents
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                </div>
              ) : invitation ? (
                <div className="space-y-4">
                  {/* Invitation Details */}
                  <div className="p-4 bg-muted/50 rounded-lg space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Context ID</span>
                      <span className="font-mono text-xs truncate max-w-[200px]">
                        {(() => {
                          const ctx = (invitation.invitation as any).context_id || (invitation.invitation as any).contextId;
                          return Array.isArray(ctx) ? '[bytes]' : ctx;
                        })()}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">From</span>
                      <span className="font-mono text-xs truncate max-w-[200px]">
                        {(() => {
                          const inv = (invitation.invitation as any).inviter_identity || (invitation.invitation as any).inviterIdentity;
                          if (Array.isArray(inv)) return '[identity]';
                          if (typeof inv === 'string' && inv.length > 16) {
                            return `${inv.slice(0, 8)}...${inv.slice(-8)}`;
                          }
                          return inv;
                        })()}
                      </span>
                    </div>
                  </div>

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
                          sessionStorage.setItem('pendingInvitation', JSON.stringify(invitation));
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
