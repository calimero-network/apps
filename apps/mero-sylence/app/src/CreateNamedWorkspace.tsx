import { useCallback, useMemo, useRef, useState } from "react";
import { describeError } from "@calimero-apps/connect";
import { lastUsedName, setOrgName } from "@calimero-apps/names";
import { MeroProvider, useCreateWorkspace, useCreateWorkspaceResume } from "@calimero-network/mero-react";
import { createWorkspaceInNewOrg } from "./lib/orgs";
import { useSignedIn } from "./sessionContext";
import { Icon } from "./ui";
import "./polish.css";

/**
 * The extension named a workspace (`#native-sign-in&intent=create&name=…`):
 * create it here, with no form, since only this page may ask for the passkey.
 * On Calimero Cloud the session is bound to this page, so the node approves
 * the new organization on its own page: in a small window this page opens
 * (only from a click, so the person presses Create), else by leaving for it
 * and coming back, which `useCreateWorkspaceResume` finishes. Then the window
 * hands the session over and closes, and the extension chooses it.
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
  const [started, setStarted] = useState(false);
  const finished = useRef(false);
  const finish = useCallback(
    ({ orgId, name, selfName }: { orgId: string; name: string; selfName: string }) => {
      if (finished.current) return;
      finished.current = true;
      setFinishing(true);
      void (async () => {
        try {
          await createWorkspaceInNewOrg(client, source, name, orgId, () => passkey());
          // Best effort: a member without a name still works.
          if (selfName) await setOrgName(client, orgId, accountId, selfName).catch(() => undefined);
          onDone();
        } catch (e) {
          finished.current = false;
          setError(describeError(e));
          setFinishing(false);
        } finally {
          after();
        }
      })();
    },
    [client, source, accountId, passkey, after, onDone],
  );
  // Back from the node's own page (a window too narrow for its pop-up): finish what was approved there.
  useCreateWorkspaceResume({ onCreated: finish });
  const flow = useCreateWorkspace({ returnTo: `${window.location.origin}${window.location.pathname}`, onCreated: finish });
  const start = () => {
    setStarted(true);
    setError(null);
    flow.clearError();
    // A click: the browser lets the page open the node's approval window from it.
    flow.create(request.name, request.self || lastUsedName() || "");
  };

  const problem = error ?? flow.error;
  const approving = flow.phase === "approving";
  const redirecting = flow.phase === "redirect";
  return (
    <section className="card handoff" data-testid="extension-create" aria-live="polite">
      <div className="handoff-mark" aria-hidden="true">
        <Icon name="plus" size={22} />
      </div>
      <h1>{started || finishing ? `Creating “${request.name}”` : `Create “${request.name}”`}</h1>
      {problem ? (
        <>
          <p className="err" role="alert">
            {problem}
          </p>
          <div className="row">
            <button type="button" className="btn primary" onClick={start}>
              Try again
            </button>
            <button type="button" className="btn ghost" onClick={onDone}>
              Skip
            </button>
          </div>
        </>
      ) : finishing || flow.phase === "creating" ? (
        <p className="empty">
          <span className="btn-spinner" aria-hidden="true" /> Setting it up. This window closes by itself.
        </p>
      ) : approving || redirecting ? (
        <>
          <p className="empty">
            {redirecting
              ? "Your node opens its own page to ask for your passkey. Check it shows this code."
              : "A window from your node opened. Check it shows this code, then approve there with your passkey."}
          </p>
          <p className="handoff-code" data-testid="consent-code" aria-label="Approval code">
            {flow.code ?? "…"}
          </p>
          <div className="row">
            {redirecting ? (
              <button type="button" className="btn primary" onClick={() => flow.proceed()}>
                Continue to your node
              </button>
            ) : (
              <button type="button" className="btn ghost" onClick={() => flow.reopen()}>
                Open the window again
              </button>
            )}
            <button type="button" className="btn ghost" onClick={() => flow.cancel()}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="empty">You approve it with your passkey. This window closes by itself after.</p>
          <div className="row">
            <button type="button" className="btn primary" data-testid="extension-create-start" disabled={!flow.ready} onClick={start}>
              Create workspace
            </button>
            <button type="button" className="btn ghost" onClick={onDone}>
              Cancel
            </button>
          </div>
        </>
      )}
    </section>
  );
}
