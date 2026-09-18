import React, { useCallback, useEffect, useMemo, useState } from 'react';
import styled, { keyframes } from 'styled-components';
import { renderSVG } from 'uqr';
import { C } from '../theme';
import { shareableInvitation } from '../lib/inviteLink';

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
 * So: the HTTPS link is the primary action, copying it closes the dialog, and
 * the other two forms — the desktop deep link and the raw cross-app code — stay
 * behind a disclosure for the cases that genuinely need them. A QR code sits
 * beside the link for handing an invitation to a phone, which is the one case
 * where a copied link is useless.
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
  const [showMore, setShowMore] = useState(false);
  const [notice, setNotice] = useState<{ text: string; bad: boolean } | null>(
    null,
  );

  // `shareableInvitation` THROWS on an empty code, and this dialog is rendered
  // while the mint is still in flight — so guard rather than call it eagerly.
  const share = useMemo(
    () => (code.trim() ? shareableInvitation(code) : null),
    [code],
  );

  // Rendered from the LINK, not the raw code: a phone scanning this should end
  // up in the app, not holding 400 characters it has nowhere to paste.
  const qr = useMemo(
    () => (share ? renderSVG(share.link, { border: 1 }) : null),
    [share],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const copyAndClose = useCallback(async () => {
    if (!share) return;
    try {
      await navigator.clipboard.writeText(share.link);
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
      setShowMore(true);
    }
  }, [share, onClose]);

  const copyQuietly = useCallback(async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setNotice({ text: `${label} copied.`, bad: false });
    } catch {
      setNotice({
        text: 'Could not reach the clipboard — select it and copy.',
        bad: true,
      });
    }
  }, []);

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

        {share && (
          <>
            <Share>
              <LinkBox
                $full={showMore}
                title={share.link}
                data-testid="invite-link"
              >
                {share.link}
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

            <Disclosure
              onClick={() => setShowMore((v) => !v)}
              aria-expanded={showMore}
              data-testid="invite-more"
            >
              {showMore ? 'Fewer options' : 'Other ways to send this'}
            </Disclosure>

            {showMore && (
              <More>
                <MoreLabel>
                  Desktop link
                  <MoreNote>
                    Hands the invitation straight to an installed desktop app.
                    Does not survive being pasted into most chat windows.
                  </MoreNote>
                </MoreLabel>
                <MoreRow>
                  <MoreValue>{share.deepLink}</MoreValue>
                  <SecondaryBtn
                    onClick={() => void copyQuietly(share.deepLink, 'Desktop link')}
                    data-testid="invite-copy-deep"
                  >
                    Copy
                  </SecondaryBtn>
                </MoreRow>

                <MoreLabel>
                  Raw code
                  <MoreNote>
                    The cross-app format mero-chat, mero-blocks and mero-stream
                    also read.
                  </MoreNote>
                </MoreLabel>
                <MoreRow>
                  <MoreValue>{share.code}</MoreValue>
                  <SecondaryBtn
                    onClick={() => void copyQuietly(share.code, 'Code')}
                    data-testid="invite-copy-code"
                  >
                    Copy
                  </SecondaryBtn>
                </MoreRow>
              </More>
            )}
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

const fadeIn = keyframes`from{opacity:0;}to{opacity:1;}`;
const pop = keyframes`from{opacity:0;transform:translateY(10px) scale(0.97);}to{opacity:1;transform:none;}`;

const Overlay = styled.div`
  position: fixed; inset: 0; z-index: 100;
  display: flex; align-items: center; justify-content: center; padding: 20px;
  background: rgba(14,20,15,0.45); backdrop-filter: blur(4px);
  animation: ${fadeIn} 0.18s ease both;
`;

const Dialog = styled.div`
  position: relative; width: 100%; max-width: 460px;
  max-height: calc(100vh - 40px); overflow-y: auto;
  background: ${C.paper}; border: 1px solid ${C.line}; border-radius: 18px;
  padding: 26px 26px 22px; box-shadow: 0 40px 90px -40px rgba(14,20,15,0.5);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  animation: ${pop} 0.22s cubic-bezier(0.22,1,0.36,1) both;
  h3 { font-size: 20px; font-weight: 800; letter-spacing: -0.5px; color: ${C.ink}; margin: 0 0 6px; }
`;

const Close = styled.button`
  position: absolute; top: 14px; right: 14px; width: 30px; height: 30px;
  display: grid; place-items: center; font-size: 20px; line-height: 1;
  color: ${C.mutedSoft}; background: transparent; border: none; border-radius: 8px; cursor: pointer;
  transition: background 0.15s, color 0.15s;
  &:hover { background: ${C.paper2}; color: ${C.ink}; }
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
  color: ${C.ink}; background: ${C.paper2}; border: 1px solid ${C.line}; border-radius: 11px;
  user-select: all;
  ${(p) =>
    p.$full
      ? 'word-break: break-all; white-space: normal;'
      : 'white-space: nowrap; overflow: hidden; text-overflow: ellipsis;'}
`;

const Qr = styled.div`
  flex-shrink: 0; width: 86px; height: 86px; padding: 6px;
  background: #fff; border: 1px solid ${C.line}; border-radius: 11px;
  svg { width: 100%; height: 100%; display: block; }
`;

const PrimaryBtn = styled.button`
  display: inline-flex; align-items: center; justify-content: center; width: 100%;
  padding: 12px 18px; font-size: 13.5px; font-weight: 600; border-radius: 11px; cursor: pointer;
  color: ${C.onAccent}; background: ${C.green}; border: 1px solid #93e60c;
  transition: background 0.18s, box-shadow 0.2s, transform 0.15s;
  &:hover:not(:disabled) { background: ${C.greenHover}; box-shadow: 0 10px 28px rgba(164,255,17,0.4); transform: translateY(-1px); }
  &:disabled { opacity: 0.6; cursor: default; }
`;

const Hint = styled.p`
  margin: 10px 0 0; font-size: 12.5px; line-height: 1.5; color: ${C.mutedSoft}; text-align: center;
`;

const Disclosure = styled.button`
  display: block; width: 100%; margin: 14px 0 0; padding: 6px;
  font-size: 12.5px; font-weight: 600; color: ${C.muted};
  background: transparent; border: none; cursor: pointer;
  &:hover { color: ${C.ink}; }
`;

const More = styled.div`
  margin-top: 8px; padding-top: 14px; border-top: 1px solid ${C.line};
`;

const MoreLabel = styled.label`
  display: block; margin-bottom: 6px; font-size: 12px; font-weight: 600; color: ${C.muted};
`;

const MoreNote = styled.span`
  display: block; margin-top: 3px; font-size: 11.5px; font-weight: 400; line-height: 1.45; color: ${C.mutedSoft};
`;

const MoreRow = styled.div`
  display: flex; align-items: center; gap: 8px; margin-bottom: 16px;
  &:last-child { margin-bottom: 0; }
`;

const MoreValue = styled.code`
  flex: 1; min-width: 0; padding: 8px 10px;
  font-family: ui-monospace, 'SF Mono', Menlo, monospace; font-size: 11px;
  color: ${C.ink}; background: ${C.paper2}; border: 1px solid ${C.line}; border-radius: 9px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; user-select: all;
`;

const SecondaryBtn = styled.button`
  flex-shrink: 0; padding: 8px 14px; font-size: 12.5px; font-weight: 600; border-radius: 9px; cursor: pointer;
  color: ${C.ink}; background: ${C.paper}; border: 1px solid ${C.line};
  &:hover { background: ${C.paper2}; border-color: ${C.green}; }
`;

const Notice = styled.p<{ $bad: boolean }>`
  margin: 12px 0 0; font-size: 12.5px; text-align: center;
  color: ${(p) => (p.$bad ? C.danger : C.muted)};
`;

const ErrorLine = styled.p`margin: 0; font-size: 12.5px; color: ${C.danger};`;
