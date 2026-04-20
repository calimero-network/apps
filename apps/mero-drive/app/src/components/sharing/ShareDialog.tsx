import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { adminRequest } from '@/api/AdminApi';
import { serializeGroupInvitationPayload } from '@/utils/invitation';
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
  groupId: string;
}

interface GroupInviteResponse {
  invitation: unknown;
  groupAlias?: string;
}

export const ShareDialog: React.FC<ShareDialogProps> = ({
  isOpen,
  onClose,
  groupId,
}) => {
  const [invitationPayload, setInvitationPayload] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generateInvitation = async () => {
    setIsGenerating(true);
    setError(null);

    try {
      const response = await adminRequest<GroupInviteResponse>(
        `/groups/${groupId}/invite`,
        { method: 'POST', body: {} },
      );

      const payload = serializeGroupInvitationPayload({
        invitation: response.invitation,
        groupAlias: response.groupAlias,
      });

      setInvitationPayload(payload);
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
      const shareUrl = `${window.location.origin}/join?invite=${encodeURIComponent(invitationPayload)}`;
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      try {
        await navigator.clipboard.writeText(invitationPayload ?? '');
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
