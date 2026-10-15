import { describeInviteFailure } from "@calimero-apps/invite";
import type { JoinFromInvitation } from "./useJoinFromInvitation";
import { BoxIcon, LayersIcon, LinkIcon, UserPlusIcon } from "./icons";
import { IconTile, IdField } from "./ui";

/**
 * The invitation prompt, and the hint for when there is none.
 *
 * An invitation reaches this app only by its link being opened, so there is
 * nothing to paste here: idle, this says where invitations come from; with one
 * captured, it shows what joining would add this node to and asks.
 */
export function JoinCard({ join }: { join: JoinFromInvitation }) {
  const { state, parsed } = join;

  return (
    <div className="card">
      <div className="card-head">
        <IconTile>
          <LinkIcon size={18} />
        </IconTile>
        <div className="grow">
          <h2>Join with an invitation</h2>
          {state.stage === "idle" && (
            <div className="meta">
              Open an invitation link someone sent you. It opens this app and
              asks before joining.
            </div>
          )}
        </div>
      </div>

      {state.stage === "awaiting-confirmation" && parsed && (
        <div className="invite-prompt">
          {/*
            The prompt exists because following a link must not act on the
            user's behalf: joining binds their identity to a namespace someone
            else chose and switches their active context. Show WHAT, then ask.
          */}
          <div className="lead">
            <IconTile accent>
              <UserPlusIcon size={18} />
            </IconTile>
            <div>
              <strong>You&apos;ve been invited to a voting group</strong>
              <p className="empty">
                An invitation is waiting. Joining adds this node to:
              </p>
            </div>
          </div>
          <dl className="kv">
            <dt>
              <span className="row" style={{ gap: 6 }}>
                <LayersIcon size={14} /> Namespace
              </span>
            </dt>
            <dd>
              <IdField value={parsed.namespaceId} label="namespace id" />
            </dd>
            <dt>
              <span className="row" style={{ gap: 6 }}>
                <BoxIcon size={14} /> Context
              </span>
            </dt>
            <dd>
              <IdField value={parsed.contextId} label="context id" />
            </dd>
          </dl>
          <div className="row end" style={{ marginTop: 14 }}>
            <button
              className="plain"
              onClick={join.decline}
              data-testid="invite-decline"
            >
              Not now
            </button>
            <button onClick={join.accept} data-testid="invite-accept">
              Join
            </button>
          </div>
        </div>
      )}

      {state.stage === "joining" && (
        <p className="empty" style={{ marginTop: 12 }}>
          Joining the namespace, then the context…
        </p>
      )}

      {(state.stage === "joined" || state.stage === "already-member") && (
        <p className="empty" style={{ marginTop: 12 }}>
          Joined. Opening the group…
        </p>
      )}

      {state.stage === "failed" && (
        <>
          <pre className="err" data-testid="invite-error">
            {describeInviteFailure(state.reason, "namespace") ?? state.message}
          </pre>
          {/*
            The distinction the user actually needs: will trying again help?
            `@calimero-apps/invite` decides it from the node's status, and errs
            toward retryable, because a dropped invitation is unrecoverable and
            a retried one costs a round trip. A retryable one is still in the
            pending intent store, so it really does come back on the next load.
          */}
          <p className="empty" style={{ marginTop: 8 }}>
            {state.retryable
              ? "Kept — it will be offered again the next time the app opens."
              : "This invitation cannot succeed; ask for a new one."}
          </p>
          <div className="row end" style={{ marginTop: 14 }}>
            <button className="plain" onClick={join.dismiss}>
              Dismiss
            </button>
            {state.retryable && (
              <button onClick={join.retry} data-testid="invite-retry">
                Try again
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
