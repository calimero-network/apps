// Paste-an-invite-link dialog. Sibling to NamespaceCreateDialog —
// launched from NamespaceSwitcher when the user has a link rather
// than wanting to create a new workspace.
//
// Two stages, both rendered inside the same modal shell:
//   1. `input`   — textarea + Continue button. Parses the pasted
//                  text through extractInviteParams + parseInviteUrl.
//                  Errors surface inline below the field.
//   2. `preview` — hands the parsed invite to JoinInviteCard (the
//                  same component the `/join` route uses). On
//                  success, refetches the namespace list and closes.
//
// The Cancel/backdrop/Escape paths just close — no need for the
// gating createWorkspace dialog uses because the actual join request
// is owned by JoinInviteCard, which manages its own loading state.

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  extractInviteParams,
  parseInviteUrl,
  type ParsedInvite,
} from '@/hooks/useNamespaceInvitation';
import { JoinInviteCard } from './JoinInviteCard';

interface Props {
  onClose: () => void;
  onJoined: () => void | Promise<void>;
}

type Stage =
  | { kind: 'input' }
  | { kind: 'preview'; parsed: ParsedInvite };

export function NamespaceJoinDialog({ onClose, onJoined }: Props) {
  const [stage, setStage] = useState<Stage>({ kind: 'input' });
  const [input, setInput] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);

  const onContinue = () => {
    setParseError(null);
    const params = extractInviteParams(input);
    if (!params) {
      setParseError(
        "That doesn't look like an invite link. Paste the full link starting with https://",
      );
      return;
    }
    const parsed = parseInviteUrl(params);
    if ('error' in parsed) {
      setParseError(parsed.error);
      return;
    }
    setStage({ kind: 'preview', parsed });
  };

  const handleJoined = async () => {
    await onJoined();
    onClose();
  };

  const title =
    stage.kind === 'input'
      ? 'Join workspace'
      : `Join ${stage.parsed.kind === 'namespace' ? 'workspace' : 'folder'}`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="join-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div
        className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="join-dialog-title"
          className="text-lg font-semibold mb-3"
        >
          {title}
        </h2>

        {stage.kind === 'input' ? (
          <>
            <p className="mb-3 text-sm text-muted-foreground">
              Paste the invite link a workspace owner shared with you.
            </p>
            <textarea
              className="flex min-h-[88px] w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none break-all"
              placeholder="https://mero-drive.vercel.app/join?kind=namespace&id=…"
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setParseError(null);
              }}
              autoFocus
            />
            {parseError && (
              <p
                role="alert"
                className="mt-2 text-xs text-destructive break-words"
              >
                {parseError}
              </p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={onContinue}
                disabled={!input.trim()}
              >
                Continue
              </Button>
            </div>
          </>
        ) : (
          <JoinInviteCard
            parsed={stage.parsed}
            onJoined={handleJoined}
            secondaryAction={{
              label: 'Back to invite link',
              onClick: () => setStage({ kind: 'input' }),
            }}
          />
        )}
      </div>
    </div>
  );
}
