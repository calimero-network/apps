import React, { useEffect, useMemo, useState } from "react";
import styled, { keyframes } from "styled-components";
import { tokens as t } from "../theme";
import { generateInvitationUrl } from "../utils/invitation";

interface InviteModalProps {
  /** Mints an invitation and returns the JSON payload the link carries. */
  onInvite: () => Promise<string>;
  onClose: () => void;
}

export default function InviteModal({ onInvite, onClose }: InviteModalProps) {
  const [payload, setPayload] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // The one thing to share. Opened, never pasted: the links page hands it to
  // the app (or a running desktop), which asks the invitee before joining.
  const webUrl = useMemo(
    () => (payload ? generateInvitationUrl(payload) : ""),
    [payload],
  );

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);
    try {
      // Already JSON: `useWorkspace.invite` builds the shared payload (which is
      // what carries the workspace NAME to the joiner) and serialises it. The
      // old `JSON.stringify(await onInvite())` double-encoded nothing useful —
      // it wrapped the raw admin response, whose shape no other mero app reads.
      setPayload(await onInvite());
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create invitation.",
      );
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!webUrl) return;
    try {
      await navigator.clipboard.writeText(webUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked — the link stays selectable in the field */
    }
  };

  return (
    <Overlay onClick={onClose}>
      <Dialog
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="inv-title"
      >
        <Close onClick={onClose} aria-label="Close">
          ×
        </Close>

        <IconBadge aria-hidden>
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke={t.color.accentText}
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M19 8v6M22 11h-6" />
          </svg>
        </IconBadge>

        <h3 id="inv-title">Invite to workspace</h3>
        <p className="sub">
          Generate an invite link and share it with anyone you want to join this
          workspace.
        </p>

        {!payload ? (
          <PrimaryBtn
            data-testid="generate-invite-btn"
            style={{ width: "100%", marginTop: 22 }}
            onClick={handleGenerate}
            disabled={loading}
          >
            {loading ? <Spin /> : "Generate invite link"}
          </PrimaryBtn>
        ) : (
          <>
            <Field>
              <label>Invite link</label>
              <textarea
                data-testid="invite-code-output"
                readOnly
                value={webUrl}
                rows={3}
                onFocus={(e) => e.currentTarget.select()}
              />
            </Field>
            <PrimaryBtn
              data-testid="copy-invite-btn"
              style={{ width: "100%" }}
              onClick={() => void handleCopy()}
            >
              {copied ? "Copied ✓" : "Copy invite link"}
            </PrimaryBtn>
            <p className="hint">
              Whoever opens the link is asked to join this workspace.
            </p>
          </>
        )}

        {error && <ErrorLine>{error}</ErrorLine>}
      </Dialog>
    </Overlay>
  );
}

const fadeIn = keyframes`from{opacity:0;}to{opacity:1;}`;
const pop = keyframes`from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:none;}`;
const spin = keyframes`to{transform:rotate(360deg);}`;

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: ${t.color.scrim};
  /* The overlay is fixed itself and holds only its dialog, so this blur
     cannot trap anything. */
  -webkit-backdrop-filter: blur(6px);
  backdrop-filter: blur(6px);
  animation: ${fadeIn} 0.15s ease both;
`;
const Dialog = styled.div`
  position: relative;
  width: 100%;
  max-width: 440px;
  background: ${t.color.panel};
  border: 1px solid ${t.color.edge};
  border-radius: ${t.radiusModal};
  padding: 30px 28px 26px;
  box-shadow: ${t.shadowFloat};
  max-height: calc(100dvh - 40px);
  overflow-y: auto;
  font-family: ${t.font.sans};
  color: ${t.color.text};
  animation: ${pop} 0.18s ease both;
  h3 {
    font-size: 20px;
    font-weight: 700;
    letter-spacing: -0.03em;
    margin: 0 0 8px;
    padding-right: 28px;
  }
  .sub {
    font-size: 13px;
    line-height: 1.55;
    color: ${t.color.text2};
    margin: 0;
  }
  .hint {
    margin: 10px 0 0;
    font-size: 12px;
    color: ${t.color.text3};
    text-align: center;
  }
`;
const Close = styled.button`
  position: absolute;
  top: 16px;
  right: 16px;
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  font-size: 20px;
  line-height: 1;
  color: ${t.color.text3};
  background: transparent;
  border: none;
  border-radius: 999px;
  cursor: pointer;
  &:hover {
    background: ${t.color.hover};
    color: ${t.color.text};
  }
`;
const IconBadge = styled.div`
  width: 44px;
  height: 44px;
  margin-bottom: 16px;
  display: grid;
  place-items: center;
  border-radius: 10px;
  background: ${t.color.accentDim};
  border: 1px solid ${t.color.accentBorder};
`;
const Field = styled.div`
  margin: 22px 0 12px;
  label {
    display: block;
    font-size: 12px;
    font-weight: 600;
    color: ${t.color.text2};
    margin-bottom: 7px;
  }
  textarea {
    width: 100%;
    resize: vertical;
    min-height: 84px;
    font-family: ${t.font.mono};
    font-size: 12px;
    line-height: 1.5;
    color: ${t.color.text};
    background: ${t.color.raised};
    border: 1px solid ${t.color.border};
    border-radius: ${t.radius};
    padding: 10px 12px;
    outline: none;
    word-break: break-all;
    &:focus {
      border-color: ${t.color.accentBorder};
    }
  }
`;
const PrimaryBtn = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 10px 18px;
  font-size: 13px;
  font-weight: 600;
  border-radius: ${t.radiusPill};
  cursor: pointer;
  color: ${t.color.onAccent};
  background: ${t.color.accent};
  border: 1px solid transparent;
  transition: background 0.15s;
  &:hover:not(:disabled) {
    background: ${t.color.accentHover};
  }
  &:disabled {
    opacity: 0.6;
    cursor: default;
  }
`;
const ErrorLine = styled.p`
  margin: 12px 0 0;
  font-size: 12.5px;
  color: ${t.color.urgent};
`;
const Spin = styled.span`
  width: 15px;
  height: 15px;
  border: 2px solid color-mix(in srgb, ${t.color.onAccent} 30%, transparent);
  border-top-color: ${t.color.onAccent};
  border-radius: 50%;
  animation: ${spin} 0.6s linear infinite;
`;
