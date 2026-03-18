import React, { useState } from 'react';
import { useCalimero, apiClient } from '@calimero-network/calimero-client';
import { Button } from '@/components/ui/button';
import {
  Share2,
  Copy,
  Check,
  Loader2,
  X,
  Link as LinkIcon,
  Users,
} from 'lucide-react';

interface ShareDialogProps {
  isOpen: boolean;
  onClose: () => void;
  contextId: string;
}

export const ShareDialog: React.FC<ShareDialogProps> = ({
  isOpen,
  onClose,
  contextId,
}) => {
  const { app } = useCalimero();
  const [invitationPayload, setInvitationPayload] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generateInvitation = async () => {
    if (!app) {
      setError('App not connected');
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      // Get the current user's identity (executor/inviter)
      const contexts = await app.fetchContexts();
      console.log('[ShareDialog] Available contexts:', contexts);
      console.log('[ShareDialog] Looking for contextId:', contextId);
      
      const context = contexts.find(c => c.contextId === contextId);
      
      if (!context) {
        throw new Error(`Context not found. Available: ${contexts.map(c => c.contextId).join(', ')}`);
      }

      const inviterId = context.executorId;
      console.log('[ShareDialog] Using inviterId:', inviterId);
      
      // Generate open invitation valid for ~1 day (86400 blocks assuming 1 block/sec)
      const validForBlocks = 86400;
      
      console.log('[ShareDialog] Calling contextInviteByOpenInvitation with:', {
        contextId,
        inviterId,
        validForBlocks
      });
      
      const response = await apiClient.node().contextInviteByOpenInvitation(
        contextId,
        inviterId,
        validForBlocks
      );

      console.log('[ShareDialog] Full response:', JSON.stringify(response, null, 2));

      if (response.error) {
        console.error('[ShareDialog] API error:', response.error);
        throw new Error(response.error.message || 'Failed to generate invitation');
      }

      // Try different response structures
      let invitationData = null;
      
      // Structure 1: response.data contains invitation + inviter_signature (snake_case from API)
      if (response.data?.invitation && response.data?.inviter_signature) {
        invitationData = response.data;
        console.log('[ShareDialog] Found invitation in response.data (snake_case)');
      }
      // Structure 2: response.data.data (nested ContextInviteByOpenInvitationResponse)
      else if (response.data?.data?.invitation) {
        invitationData = response.data.data;
        console.log('[ShareDialog] Found invitation in response.data.data');
      }
      // Structure 3: camelCase variant
      else if (response.data?.invitation && response.data?.inviterSignature) {
        invitationData = response.data;
        console.log('[ShareDialog] Found invitation in response.data (camelCase)');
      }

      if (invitationData) {
        // Serialize the invitation to a shareable string
        const payload = JSON.stringify(invitationData);
        console.log('[ShareDialog] Invitation payload:', payload.substring(0, 200) + '...');
        const base64Payload = btoa(payload);
        setInvitationPayload(base64Payload);
      } else {
        console.error('[ShareDialog] Could not find invitation data in response. Keys:', Object.keys(response.data || {}));
        throw new Error('No invitation data received. Check console for details.');
      }
    } catch (err) {
      console.error('[ShareDialog] Failed to generate invitation:', err);
      setError(err instanceof Error ? err.message : 'Failed to generate invitation');
    } finally {
      setIsGenerating(false);
    }
  };

  const copyToClipboard = async () => {
    if (!invitationPayload) return;

    try {
      // Create a shareable URL with the invitation payload
      const shareUrl = `${window.location.origin}/join?invite=${encodeURIComponent(invitationPayload)}`;
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
      // Fallback: copy just the payload
      try {
        await navigator.clipboard.writeText(invitationPayload);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        setError('Failed to copy to clipboard');
      }
    }
  };

  const copyPayloadOnly = async () => {
    if (!invitationPayload) return;

    try {
      await navigator.clipboard.writeText(invitationPayload);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Failed to copy to clipboard');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Dialog */}
      <div className="relative bg-card border border-border rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Share2 className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Share Workspace</h2>
              <p className="text-sm text-muted-foreground">
                Invite others to collaborate
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-muted transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {!invitationPayload ? (
            <>
              <div className="text-center py-4">
                <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
                  <Users className="w-8 h-8 text-muted-foreground" />
                </div>
                <p className="text-sm text-muted-foreground mb-4">
                  Generate an invitation link to share your document workspace.
                  Anyone with the link can join and collaborate on documents.
                </p>
              </div>

              {error && (
                <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                  {error}
                </div>
              )}

              <Button
                onClick={generateInvitation}
                disabled={isGenerating}
                className="w-full gap-2"
                size="lg"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <LinkIcon className="w-4 h-4" />
                    Generate Invitation Link
                  </>
                )}
              </Button>
            </>
          ) : (
            <>
              <div className="space-y-3">
                <label className="text-sm font-medium">Invitation Link</label>
                <div className="flex gap-2">
                  <div className="flex-1 p-3 bg-muted rounded-lg text-sm font-mono break-all max-h-24 overflow-y-auto">
                    {`${window.location.origin}/join?invite=...`}
                  </div>
                  <Button
                    onClick={copyToClipboard}
                    variant="outline"
                    size="icon"
                    className="flex-shrink-0"
                  >
                    {copied ? (
                      <Check className="w-4 h-4 text-green-500" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </Button>
                </div>
              </div>

              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-200 text-sm">
                <strong>Note:</strong> This invitation expires in 24 hours. Anyone
                with this link can join your workspace.
              </div>

              <div className="flex gap-2">
                <Button
                  onClick={copyToClipboard}
                  className="flex-1 gap-2"
                >
                  {copied ? (
                    <>
                      <Check className="w-4 h-4" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4" />
                      Copy Link
                    </>
                  )}
                </Button>
                <Button
                  onClick={() => {
                    setInvitationPayload(null);
                    setError(null);
                  }}
                  variant="outline"
                >
                  New Link
                </Button>
              </div>

              {/* Advanced: Copy raw payload */}
              <details className="text-sm">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                  Advanced: Copy raw invitation payload
                </summary>
                <div className="mt-2 space-y-2">
                  <div className="p-2 bg-muted rounded text-xs font-mono break-all max-h-20 overflow-y-auto">
                    {invitationPayload}
                  </div>
                  <Button
                    onClick={copyPayloadOnly}
                    variant="ghost"
                    size="sm"
                    className="w-full"
                  >
                    Copy Payload
                  </Button>
                </div>
              </details>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ShareDialog;
