import "./workspaceCreator.css";
import { useMemo, useState } from "react";
import type { CalimeroClient, PasskeyProvider } from "@calimero-network/mero-js";
import {
  CreateWorkspaceDialog,
  MeroProvider,
  useCreateWorkspaceResume,
  type CreatedWorkspace,
  type CreateWorkspaceLabels,
} from "@calimero-network/mero-react";
import type { AppSource, Target } from "@calimero-apps/connect";
import { CHECKING_RELEASE } from "./useResolvedSource";
import { reviewRelease } from "./nodeChecks";
import { describeTarget } from "./session";

export interface WorkspaceCreatorProps {
  client: CalimeroClient;
  target: Target;
  passkey: () => PasskeyProvider;
  open: boolean;
  onClose: () => void;
  /** Where the app's instances come from; its release is what the review shows. */
  source: AppSource;
  /** The newest release is still being read: `source` is not final yet. */
  pending: boolean;
  /** Reviewed in place of a release for a raw dev bundle or a package with no version. */
  appPackage: string;
  /** Called once the workspace exists, from the dialog or from a full-page approval. */
  onCreated: (workspace: CreatedWorkspace) => void;
  labels?: CreateWorkspaceLabels;
}

/** Says why a full-page approval created nothing (declined, or a return that is not this tab's request). */
function ResumeNotice({ onCreated }: Pick<WorkspaceCreatorProps, "onCreated">) {
  const { message } = useCreateWorkspaceResume({ onCreated });
  const [dismissed, setDismissed] = useState<string | null>(null);
  if (!message || dismissed === message) return null;
  return (
    <div role="alert" className="cp-resume-notice">
      {message}{" "}
      <button type="button" onClick={() => setDismissed(message)}>
        Dismiss
      </button>
    </div>
  );
}

/**
 * The shared create-workspace dialog (`@calimero-network/mero-react`) on an
 * app's own session: names, review, and the node's approval for a session
 * bound to the app. Mount it once under sign-in and toggle `open`; it also
 * finishes a workspace approved on a full-page trip to the node.
 */
export function WorkspaceCreator({ client, target, passkey, open, onClose, source, pending, appPackage, onCreated, labels }: WorkspaceCreatorProps) {
  const sessionStore = useMemo(() => ({ load: () => client.session ?? null, save: () => {}, clear: () => {} }), [client]);
  const local = target.kind === "local";
  const label = describeTarget(target);
  const release = pending ? null : (reviewRelease(source) ?? { package: appPackage, version: "unreleased" });
  return (
    <MeroProvider client={client} sessionStore={sessionStore} passkey={passkey()} {...(local ? {} : { cluster: label })}>
      <ResumeNotice onCreated={onCreated} />
      {open && !release ? (
        <p role="status" className="cp-resume-notice">
          {CHECKING_RELEASE}
        </p>
      ) : (
        open && release && <CreateWorkspaceDialog open onClose={onClose} release={release} onCreated={onCreated} labels={labels} />
      )}
    </MeroProvider>
  );
}
