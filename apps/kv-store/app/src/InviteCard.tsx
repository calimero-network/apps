import { useState } from "react";
import {
  useContextGroup,
  useCreateNamespaceInvitation,
} from "@calimero-network/mero-react";
import {
  generateInvitationUrl,
  serializeInvitationPayload,
} from "./utils/invitation";

/**
 * Mint a shareable invitation to this context.
 *
 * Deliberately ONE link, HTTPS. The https link already hands off to the desktop
 * launcher on a machine that has it, so offering a second `calimero://` link
 * would ask the user to choose between two things they cannot tell apart —
 * mero-chat-pwa removed its second link for exactly that reason.
 */
export function InviteCard({ contextId }: { contextId: string }) {
  // The namespace is not in the session, but a context knows the group it lives
  // in — and `ContextPicker` creates contexts directly in the namespace, so that
  // group IS the namespace. (Put a context in a subgroup instead and this would
  // hand `createNamespaceInvitation` a subgroup id.)
  const { groupId, loading: groupLoading, error: groupError } = useContextGroup(contextId);
  const { createNamespaceInvitation } = useCreateNamespaceInvitation();

  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const namespaceId = groupId;

  async function mint() {
    if (!namespaceId) return;
    setBusy(true);
    setFailed(null);
    setCopied(false);
    try {
      const res = await createNamespaceInvitation(namespaceId);
      // The recursive variant returns `invitations[]` instead; this app only
      // ever asks for the single-namespace one, so anything else is a surprise
      // worth reporting rather than guessing at.
      const invitation = (res as { invitation?: unknown } | null)?.invitation;
      if (!invitation) {
        throw new Error(
          "the node returned no invitation — expected a single-namespace invitation",
        );
      }
      setLink(
        generateInvitationUrl(
          serializeInvitationPayload({
            invitation: invitation as Parameters<
              typeof serializeInvitationPayload
            >[0]["invitation"],
            namespaceId,
            contextId,
          }),
        ),
      );
    } catch (e) {
      setFailed(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      // Clipboard access can be denied; the link is on screen and selectable,
      // so this is a convenience failing, not the feature failing.
      setCopied(false);
    }
  }

  return (
    <div className="card">
      <h2>Invite someone</h2>
      <p className="empty" style={{ marginBottom: 14 }}>
        One link. Opens the web app, or hands off to Calimero Desktop on a
        machine that has it. Whoever opens it joins this context and converges on
        the same map.
      </p>

      {groupLoading && <p className="empty">Resolving this context&apos;s namespace…</p>}
      {groupError && <pre className="err">{groupError.message}</pre>}

      <div className="row">
        <button onClick={mint} disabled={busy || !namespaceId}>
          {busy ? "Creating…" : link ? "Create another" : "Create invite link"}
        </button>
        {link && (
          <button className="ghost" onClick={copy}>
            {copied ? "Copied" : "Copy"}
          </button>
        )}
      </div>

      {link && (
        <>
          <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{link}</pre>
          {/*
            Said plainly rather than hidden, because it is the difference between
            "this link is broken" and "this app is not deployed yet". The desktop
            resolves a link to an installed app and then reads the bundle's
            `links.frontend`; with that field absent it forgets the link.
          */}
          <p className="empty">
            The link carries the invitation and works when pasted into this app.
            Opening it in a browser or the desktop app additionally needs this
            app&apos;s published bundle to declare a <code>links.frontend</code>{" "}
            origin — see <code>logic/Cargo.toml</code>.
          </p>
        </>
      )}
      {failed && <pre className="err">{failed}</pre>}
    </div>
  );
}
