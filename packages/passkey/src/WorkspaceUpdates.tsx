import "./nodeShield.css";
import "./workspaceReview.css";
import { useCallback, useEffect, useState } from "react";
import { CalimeroError, type CalimeroClient } from "@calimero-network/mero-js";
import { describeError } from "@calimero-apps/connect";

import { readAppUpdate, type AppUpdate, type UpdateApprovers } from "./appUpdate";
import { useShieldStore } from "./nodeShieldStore";
import { startUpgrade, upgradeReturnTo, type StartUpgradeOptions } from "./upgrade";

/** Who approves, for someone who may not: the sentence under the available release. */
export function approversCopy(approvers: UpdateApprovers): string {
  switch (approvers) {
    case "operator":
      return "This cluster's operator installs updates; nobody in the workspace approves them.";
    case "managers":
      return "Only the workspace's owner, or someone who manages its apps, can approve this update. Ask one of them to update it.";
    default:
      return "Only an owner or admin of the workspace's organization can approve this update. Ask one of them to update it.";
  }
}

/** Why the node would not open the approval page, in plain words (`403`, `409 OUTSIDE_DEPLOYMENT`, `409 RELEASE_DEADLINE`). */
export function describeUpdateRefusal(error: unknown, approvers: UpdateApprovers): string {
  if (error instanceof CalimeroError) {
    if (error.status === 403) return approversCopy(approvers);
    if (error.code === "OUTSIDE_DEPLOYMENT") {
      return "This workspace was created from a deployment and moves only to the release the deployment offers. Check again for its current offer.";
    }
    if (error.code === "RELEASE_DEADLINE") return `This update cannot be approved now: ${describeError(error)}`;
  }
  return `Could not start the update: ${describeError(error)}`;
}

/** What was read for `appId` on `client`: the answer, or that the read failed. */
type Read = { client: CalimeroClient; appId: string; update: AppUpdate } | { client: CalimeroClient; appId: string; failed: true };

/** `readAppUpdate` for exactly this instance and client: `null` while reading, so a change of either never shows the last one's answer. */
function useAppUpdate(client: CalimeroClient | null, appId: string): [Read | null, () => void] {
  const [read, setRead] = useState<Read | null>(null);
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (!client) return;
    let live = true;
    readAppUpdate(client, appId).then(
      (update) => live && setRead({ client, appId, update }),
      () => live && setRead({ client, appId, failed: true }),
    );
    return () => {
      live = false;
    };
  }, [client, appId, round]);
  const retry = useCallback(() => {
    setRead(null);
    setRound((n) => n + 1);
  }, []);
  return [read?.client === client && read.appId === appId ? read : null, retry];
}

export interface WorkspaceUpdatesProps {
  /** The workspace's app instance. */
  appId: string;
  /** What the updates cover, in words that follow "for", e.g. "the repository web". */
  subject?: string;
  /** Where the approval page is opened and remembered; for tests. */
  upgrade?: Pick<StartUpgradeOptions, "navigate" | "storage">;
  /** This page's URL, the approval page's way back; `location.href` by default. */
  href?: string;
}

/**
 * A workspace's "Updates" settings: the release its app instance runs, whether
 * a newer one is available (`GET /apps/{app}/update`, core#5192), and, for
 * someone who may approve it (an owner or admin of the workspace's
 * organization), "Review and update", which opens the node's consent page for
 * the upgrade: the person checks what changes there and approves with their
 * passkey. Everyone else sees the same facts read-only, with who approves.
 *
 * The way back from the consent page is the in-app prompt's
 * (`watchUpgrades`, mounted by `usePasskeySession`): it reads the node's
 * decision and loads the instance's new release. Needs a session bound by
 * `usePasskeySession`.
 */
export function WorkspaceUpdates({ appId, subject, upgrade, href }: WorkspaceUpdatesProps) {
  const { sessions } = useShieldStore();
  const client = sessions[sessions.length - 1]?.client ?? null;
  const [read, retry] = useAppUpdate(client, appId);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setOpening(false);
    setError(null);
  }, [read]);

  const approve = (update: AppUpdate) => {
    if (!client || !update.available) return;
    setOpening(true);
    setError(null);
    const back = upgradeReturnTo(href ?? globalThis.location.href);
    startUpgrade(client, appId, update.available.version, back, {
      ...upgrade,
      ...(update.running ? { from: update.running.version } : {}),
    }).catch((e: unknown) => {
      setOpening(false);
      setError(describeUpdateRefusal(e, update.approvers));
    });
  };

  let body: React.ReactNode;
  if (!client) body = <p className="cp-review__muted">Not connected to a node.</p>;
  else if (!read) body = <p role="status" className="cp-review__muted">Checking for updates…</p>;
  else if ("failed" in read) {
    body = (
      <>
        <p className="cp-review__muted">Whether an update is available could not be read.</p>
        <button type="button" className="cp-review__btn" onClick={retry}>
          Try again
        </button>
      </>
    );
  } else {
    const u = read.update;
    body = (
      <>
        <section className="cp-review__sec" aria-label="Releases">
          <dl className="cp-review__kv">
            <div>
              <dt>Running</dt>
              <dd data-testid="updates-running">
                {u.running ? (
                  <span className="cp-review__mono">
                    {u.running.package} v{u.running.version}
                  </span>
                ) : (
                  "A local bundle, not a published release"
                )}
              </dd>
            </div>
            <div>
              <dt>Available</dt>
              <dd data-testid="updates-available">
                {u.available ? (
                  <>
                    <span className="cp-review__mono">
                      {u.available.package} v{u.available.version}
                    </span>
                    <span className="cp-review__sub">
                      {u.available.source === "deployment"
                        ? "Offered by the deployment this workspace was created from."
                        : "The newest release this workspace can move to."}
                    </span>
                  </>
                ) : u.running ? (
                  "None: this is the newest release it can move to."
                ) : (
                  "None: a local bundle has no published releases."
                )}
              </dd>
            </div>
          </dl>
        </section>
        {u.available && u.mayApprove && (
          <section className="cp-review__sec" aria-label="Approve">
            <p className="cp-review__lede">
              Your node opens its own approval page: it shows exactly what changes in version {u.available.version}, and you approve
              with your passkey. The workspace&apos;s data stays as it is; only the code changes.
            </p>
            {error && (
              <div className="cp-review__alert" role="alert" data-testid="updates-error">
                <p>{error}</p>
              </div>
            )}
            <button
              type="button"
              className="cp-review__btn cp-review__btn--primary"
              data-testid="updates-approve"
              disabled={opening}
              onClick={() => approve(u)}
            >
              {opening ? "Opening the approval page…" : "Review and update"}
            </button>
          </section>
        )}
        {u.available && !u.mayApprove && (
          <p className="cp-review__muted" data-testid="updates-readonly">
            {approversCopy(u.approvers)}
          </p>
        )}
        <p>
          <button type="button" className="cp-review__btn" onClick={retry} disabled={opening}>
            Check again
          </button>
        </p>
      </>
    );
  }
  return (
    <div className="cp-review" data-testid="workspace-updates">
      <h2 className="cp-review__title">Updates</h2>
      <p className="cp-review__lede">
        The release this workspace&apos;s app runs{subject ? `, for ${subject}` : ""}, and whether a newer one is available.
      </p>
      {body}
    </div>
  );
}
