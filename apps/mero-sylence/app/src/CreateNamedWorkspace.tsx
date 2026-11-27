import { useEffect, useMemo, useRef, useState } from "react";
import { describeError } from "@calimero-apps/connect";
import { lastUsedName, setOrgName } from "@calimero-apps/names";
import { MeroProvider, useCreateWorkspace } from "@calimero-network/mero-react";
import { createWorkspaceInNewOrg } from "./lib/orgs";
import { useSignedIn } from "./sessionContext";
import { Icon } from "./ui";
import "./polish.css";

/**
 * The extension named a workspace (`#native-sign-in&intent=create&name=…`):
 * create it here, with no form, since only this page may ask for the passkey.
 * The person sees one line and the passkey prompt; then the window hands the
 * session over and closes, and the extension chooses the new workspace.
 */
export function CreateNamedWorkspace({ request, onDone }: { request: { name: string; self: string }; onDone: () => void }) {
  const { client, passkey } = useSignedIn();
  // The provider reads the session this page already holds (as mero-react's own dialogs do).
  const sessionStore = useMemo(() => ({ load: () => client.session ?? null, save: () => undefined, clear: () => undefined }), [client]);
  return (
    <MeroProvider client={client} sessionStore={sessionStore} passkey={passkey()}>
      <Creating request={request} onDone={onDone} />
    </MeroProvider>
  );
}

function Creating({ request, onDone }: { request: { name: string; self: string }; onDone: () => void }) {
  const { client, source, accountId, passkey, after } = useSignedIn();
  const [error, setError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const started = useRef(false);
  const flow = useCreateWorkspace({
    returnTo: `${window.location.origin}${window.location.pathname}`,
    onCreated: ({ orgId, name, selfName }) => {
      setFinishing(true);
      void (async () => {
        try {
          await createWorkspaceInNewOrg(client, source, name, orgId, () => passkey());
          // Best effort: a member without a name still works.
          if (selfName) await setOrgName(client, orgId, accountId, selfName).catch(() => undefined);
          onDone();
        } catch (e) {
          setError(describeError(e));
          setFinishing(false);
        } finally {
          after();
        }
      })();
    },
  });
  const { ready, create } = flow;
  useEffect(() => {
    if (!ready || started.current) return;
    started.current = true;
    create(request.name, request.self || lastUsedName() || "");
  }, [ready, create, request]);

  const problem = error ?? flow.error;
  const step =
    finishing || flow.phase === "creating"
      ? "Setting it up…"
      : flow.phase === "approving" || flow.phase === "redirect"
        ? "Approve with your passkey"
        : "Getting ready…";
  return (
    <section className="card handoff" data-testid="extension-create" aria-live="polite">
      <div className="handoff-mark" aria-hidden="true">
        <Icon name="plus" size={22} />
      </div>
      <h1>Creating “{request.name}”</h1>
      {problem ? (
        <>
          <p className="err" role="alert">
            {problem}
          </p>
          <div className="row">
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                setError(null);
                flow.clearError();
                create(request.name, request.self || lastUsedName() || "");
              }}
            >
              Try again
            </button>
            <button type="button" className="btn ghost" onClick={onDone}>
              Skip
            </button>
          </div>
        </>
      ) : (
        <p className="empty">
          <span className="btn-spinner" aria-hidden="true" /> {step}. This window closes by itself.
        </p>
      )}
    </section>
  );
}
