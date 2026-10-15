import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  InviteStatusBanner,
  useInviteRedemption,
  type InviteRedeemer,
  type ParsedInvitation,
} from "@calimero-apps/invite";
import {
  getContextIdentities,
  joinContextById,
  joinNamespace,
  listNamespaces,
} from "../api/adminApi";
import { setContextId, setContextIdentity } from "../lib/mero";
import { readInviteToken, type InvitePayload } from "../lib/invite";

/** How long to keep trying the context once the namespace is joined. */
const CONTEXT_JOIN_MS = 90_000;
const CONTEXT_RETRY_MS = 3_000;

type ContextJoin =
  | { stage: "idle" }
  | { stage: "joining"; contextId: string }
  | { stage: "joined"; contextId: string }
  | { stage: "failed"; contextId: string; message: string };

const redeemer: InviteRedeemer = {
  join: (namespaceId, invitation) =>
    joinNamespace(namespaceId, invitation as object),
  memberships: async () => (await listNamespaces()).map((n) => n.namespaceId),
};

const box: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "10px 14px",
  borderRadius: 8,
  fontSize: 13,
  background: "var(--color-bg-card)",
  border: "1px solid var(--color-border)",
};

const linkButton: CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  color: "inherit",
  textDecoration: "underline",
  cursor: "pointer",
  fontSize: 12,
};

/**
 * Node B's whole join: an invitation link was opened, so ask, then join the
 * namespace and the context inside it.
 *
 * The link reaches the app through the shared capture (primed in main.tsx):
 * `?invitation=…` on a page load, or a `deep-link` event from a running
 * desktop. Mounted in the signed-in layout, above every section, so it shows
 * whichever section is open; before sign-in the invitation is buffered.
 *
 * It asks first — joining gives Node A's namespace a peer on this node — and
 * then does what the wizard's joiner steps used to make you do by hand: join
 * the namespace with the signed invitation, then join and activate the context
 * the link names. The context join is retried: right after the namespace join
 * the node may not hold the context's membership yet.
 */
export function InvitationPrompt({
  onContextJoined,
}: {
  onContextJoined: (contextId: string) => void;
}) {
  const payloadRef = useRef<InvitePayload | null>(null);
  const onContextJoinedRef = useRef(onContextJoined);
  onContextJoinedRef.current = onContextJoined;
  const [context, setContext] = useState<ContextJoin>({ stage: "idle" });
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const parse = useCallback((token: string): ParsedInvitation | null => {
    const payload = readInviteToken(token);
    payloadRef.current = payload;
    return payload
      ? { namespaceId: payload.namespaceId, invitation: payload.invitation }
      : null;
  }, []);

  const joinContext = useCallback(async (contextId: string) => {
    setContext({ stage: "joining", contextId });
    const deadline = Date.now() + CONTEXT_JOIN_MS;
    let last = "";
    while (alive.current) {
      try {
        await joinContextById(contextId);
        const identities = await getContextIdentities(contextId);
        setContextId(contextId);
        if (identities[0]) setContextIdentity(identities[0]);
        if (!alive.current) return;
        setContext({ stage: "joined", contextId });
        onContextJoinedRef.current(contextId);
        return;
      } catch (e) {
        last = e instanceof Error ? e.message : String(e);
      }
      if (Date.now() > deadline) break;
      await new Promise((resolve) => setTimeout(resolve, CONTEXT_RETRY_MS));
    }
    if (alive.current)
      setContext({
        stage: "failed",
        contextId,
        message: last || "The context could not be joined.",
      });
  }, []);

  const onJoined = useCallback(
    (namespaceId: string) => {
      const payload = payloadRef.current;
      if (payload?.namespaceId === namespaceId && payload.contextId)
        void joinContext(payload.contextId);
    },
    [joinContext],
  );

  const { state, accept, decline, retry, dismiss } = useInviteRedemption({
    parse,
    redeemer,
    onJoined,
  });

  const close = useCallback(() => {
    setContext({ stage: "idle" });
    dismiss();
  }, [dismiss]);

  if (context.stage !== "idle") {
    const short = `${context.contextId.slice(0, 16)}…`;
    return (
      <div style={{ margin: "12px 16px 0" }}>
        {context.stage === "failed" ? (
          <div
            data-testid="invite-error"
            role="alert"
            style={{
              ...box,
              color: "var(--color-error)",
              borderColor: "var(--color-error)",
            }}
          >
            <span style={{ flex: 1 }}>
              Joined the namespace, but not context <code>{short}</code>:{" "}
              {context.message}
            </span>
            <button
              type="button"
              style={linkButton}
              onClick={() => void joinContext(context.contextId)}
            >
              Try again
            </button>
            <button type="button" style={linkButton} onClick={close}>
              Dismiss
            </button>
          </div>
        ) : (
          <div
            data-testid="invite-context"
            data-stage={context.stage}
            role="status"
            style={box}
          >
            <span style={{ flex: 1 }}>
              {context.stage === "joining" ? (
                <>
                  Joined the namespace. Joining context <code>{short}</code>…
                </>
              ) : (
                <>
                  Joined the namespace and context <code>{short}</code> —
                  active. State syncs from Node A.
                </>
              )}
            </span>
            {context.stage === "joined" && (
              <button type="button" style={linkButton} onClick={close}>
                Dismiss
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  if (state.stage === "idle") return null;
  return (
    <div style={{ margin: "12px 16px 0" }}>
      <InviteStatusBanner
        state={state}
        noun="namespace"
        onAccept={accept}
        onDecline={decline}
        onRetry={retry}
        onDismiss={dismiss}
        style={{ background: "var(--color-bg-card)" }}
      />
    </div>
  );
}
