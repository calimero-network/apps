import React, { useCallback, useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import { renderSVG } from 'uqr';
import { C } from '../theme';
import { closeButton, dialogSurface, overlay, primaryPill } from './glass';
import { invitationUrl } from '../lib/inviteLink';

/**
 * An invitation, as a LINK you copy and send.
 *
 * ── What this replaced ──────────────────────────────────────────────────────
 *
 * A read-only textarea holding ~400 characters of base64 and a "Copy invite
 * code" button. The recipient then had to know to press "Join with invitation"
 * and paste it into a second textarea. Nothing about that is a link, so nothing
 * about it behaves like one: it cannot be clicked, it does not open the app, it
 * says nothing about what it is for, and it survives being pasted into a chat
 * window only by luck (base64's `+ / =` are exactly what URL encoders and chat
 * clients mangle).
 *
 * So: the HTTPS link is the one thing on offer, and copying it closes the
 * dialog. There is no desktop deep link or raw code to copy — the recipient
 * opens the link, and nothing in the app takes a pasted one. A QR code of the
 * same link sits beside it for handing an invitation to a phone, which is the
 * one case where a copied link is useless.
 */
export default function InviteModal({
  code,
  scope,
  loading,
  error,
  onClose,
}: {
  /** The minted invite code, or '' while it is still being minted. */
  code: string;
  /** What the invitation grants, in words — e.g. "Finance team · 4 spreadsheets". */
  scope: string;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  // Set when the clipboard is unreachable: the link is shown whole, so it can
  // be selected by hand.
  const [full, setFull] = useState(false);
  const [notice, setNotice] = useState<{ text: string; bad: boolean } | null>(
    null,
  );

  // `invitationUrl` THROWS on an empty code, and this dialog is rendered while
  // the mint is still in flight — so guard rather than call it eagerly.
  const link = useMemo(
    () => (code.trim() ? invitationUrl(code) : null),
    [code],
  );

  // Rendered from the LINK, not the raw code: a phone scanning this should end
  // up in the app.
  const qr = useMemo(
    () => (link ? renderSVG(link, { border: 1 }) : null),
    [link],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const copyAndClose = useCallback(async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      onClose();
    } catch {
      // Clipboard access is denied outside a secure context and in some
      // embedded webviews. Keep the dialog OPEN and reveal the text so it can
      // still be selected by hand — closing it would take away the only copy
      // left, which is the one failure mode worth designing around here.
      setNotice({
        text: 'Could not reach the clipboard — select the link and copy it.',
        bad: true,
      });
      setFull(true);
    }
  }, [link, onClose]);

  return (
    <Overlay onClick={onClose}>
      <Dialog
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="inv-title"
        data-testid="invite-modal"
      >
        <Close onClick={onClose} aria-label="Close">
          ×
        </Close>

        <h3 id="inv-title">Invite to this workspace</h3>
        <Scope data-testid="invite-scope">{scope}</Scope>

        {loading && <Muted>Minting an invitation…</Muted>}
        {error && <ErrorLine>{error}</ErrorLine>}

        {link && (
          <>
            <Share>
              <LinkBox $full={full} title={link} data-testid="invite-link">
                {link}
              </LinkBox>
              {qr && (
                <Qr
                  aria-label="QR code for this invitation link"
                  role="img"
                  dangerouslySetInnerHTML={{ __html: qr }}
                />
              )}
            </Share>

            <PrimaryBtn onClick={() => void copyAndClose()} data-testid="invite-copy">
              Copy link
            </PrimaryBtn>

            <Hint>
              Anyone with this link can open every spreadsheet in the workspace.
              They pick a name for themselves when they join.
            </Hint>
          </>
        )}

        {notice && (
          <Notice $bad={notice.bad} role="status">
            {notice.text}
          </Notice>
        )}
      </Dialog>
    </Overlay>
  );
}

// ── Styled components ────────────────────────────────────────────────────────

const Overlay = styled.div`
  ${overlay}
  z-index: 100;
  display: flex; align-items: center; justify-content: center; padding: 20px;
`;

const Dialog = styled.div`
  ${dialogSurface}
  width: 100%; max-width: 460px;
  max-height: calc(100vh - 40px); overflow-y: auto;
  padding: 30px 28px 24px;
  h3 { font-size: 20px; font-weight: 800; letter-spacing: -0.5px; color: ${C.ink}; margin: 0 0 6px; }
`;

const Close = styled.button`
  ${closeButton}
  position: absolute; top: 16px; right: 16px;
`;

const Scope = styled.p`
  margin: 0 0 18px; font-size: 13.5px; line-height: 1.5; color: ${C.muted};
`;

const Muted = styled.p`margin: 0; font-size: 13px; color: ${C.mutedSoft};`;

const Share = styled.div`
  display: flex; align-items: stretch; gap: 12px; margin-bottom: 12px;
`;

/* One line by default; `$full` is also the "clipboard failed" state, where the
   characters have to be selectable. */
const LinkBox = styled.code<{ $full: boolean }>`
  flex: 1; min-width: 0;
  display: block; padding: 10px 12px;
  font-family: ui-monospace, 'SF Mono', Menlo, monospace; font-size: 11.5px; line-height: 1.5;
  color: ${C.ink}; background: var(--glass-sunken); border: 1px solid var(--glass-line); border-radius: 12px;
  user-select: all;
  ${(p) =>
    p.$full
      ? 'word-break: break-all; white-space: normal;'
      : 'white-space: nowrap; overflow: hidden; text-overflow: ellipsis;'}
`;

const Qr = styled.div`
  flex-shrink: 0; width: 86px; height: 86px; padding: 6px;
  background: #fff; border: 1px solid ${C.line}; border-radius: 12px;
  svg { width: 100%; height: 100%; display: block; }
`;

const PrimaryBtn = styled.button`
  ${primaryPill}
  width: 100%;
`;

const Hint = styled.p`
  margin: 10px 0 0; font-size: 12.5px; line-height: 1.5; color: ${C.mutedSoft}; text-align: center;
`;

const Notice = styled.p<{ $bad: boolean }>`
  margin: 12px 0 0; font-size: 12.5px; text-align: center;
  color: ${(p) => (p.$bad ? C.danger : C.muted)};
`;

const ErrorLine = styled.p`margin: 0; font-size: 12.5px; color: ${C.danger};`;
