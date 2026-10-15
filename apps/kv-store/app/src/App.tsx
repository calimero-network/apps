import { useState } from "react";
import {
  ConnectButton,
  InvitationDialog,
  clearContextId,
  useMero,
} from "@calimero-network/mero-react";
import { ContextPicker } from "./ContextPicker";
import { InviteCard } from "./InviteCard";
import { KvPanel } from "./KvPanel";
import { useJoinFromInvitation } from "./useJoinFromInvitation";

/** `head…tail`, so two ids can be told apart without the full 44 characters. */
function shortId(id: string) {
  return id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-6)}` : id;
}

export function App() {
  const {
    isAuthenticated,
    isLoading,
    applicationId,
    contextId: storedContextId,
    nodeUrl,
    logout,
  } = useMero();
  // The context an invitation just joined, opened in place. The provider only
  // reads the stored context on mount, and the usual way to switch (store it,
  // reload) would take the invitation dialog down mid-sync; so the joined one
  // wins here until the next load, by which time it is the stored one too.
  const [joinedContextId, setJoinedContextId] = useState<string | null>(null);
  const contextId = joinedContextId ?? storedContextId;
  // Mounted at the root, unconditionally: an invitation captured before login
  // has to be redeemed as soon as the session exists, which means this cannot
  // live inside a branch that only renders once a context is chosen.
  const join = useJoinFromInvitation(setJoinedContextId);
  const invited = join.parsed;

  // Drop the stored context and re-render at the picker. A reload rather than
  // local state, for the same reason `ContextPicker.select` reloads: the
  // provider reads the stored context on mount, so reloading is what makes the
  // provider and the UI agree instead of duplicating that logic here.
  function switchContext() {
    clearContextId();
    window.location.reload();
  }

  return (
    <div className="wrap">
      <header>
        <h1>KV Store</h1>
        <p className="sub">
          The reference Calimero app. An{" "}
          <code>UnorderedMap&lt;String, LwwRegister&lt;String&gt;&gt;</code> in
          a WASM contract, driven from a client generated out of that
          contract&apos;s own ABI.
        </p>
      </header>

      {isLoading ? (
        <div className="card">
          <p className="empty">Connecting…</p>
        </div>
      ) : !isAuthenticated ? (
        <div className="card">
          <h2>Connect a node</h2>
          <p className="empty" style={{ marginBottom: 14 }}>
            The login modal discovers nodes on the usual local ports and accepts
            a URL directly.
          </p>
          <ConnectButton />
        </div>
      ) : !contextId ? (
        <>
          <ContextPicker applicationId={applicationId} />
          {/*
            An invitation reaches this app only by its link being opened, so
            there is nothing to paste: this says where invitations come from,
            and the dialog asks once one has been opened.
          */}
          <div className="card">
            <h2>Join with an invitation</h2>
            <p className="empty">
              Open an invitation link someone sent you. It opens this app and
              asks before joining.
            </p>
          </div>
        </>
      ) : (
        <>
          <div className="card context-bar">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="empty">
                Context <code className="mono">{contextId}</code>
              </span>
              {/*
                The only way back. Selecting a context used to be a ONE-WAY door:
                `setContextId` is written to storage and the app then renders the
                panel forever, so the picker was unreachable without clearing
                site data or logging out. A node routinely holds several
                contexts, and comparing two of them is the normal way to watch
                a CRDT converge.
              */}
              <button className="ghost" onClick={switchContext}>
                Change context
              </button>
            </div>
          </div>
          {/*
            Keyed, so joining a second context starts from an empty read rather
            than counting the previous context's entries as the new one's.
          */}
          <KvPanel key={contextId} contextId={contextId} />
          <InviteCard key={`invite-${contextId}`} contextId={contextId} />
        </>
      )}

      {isAuthenticated && (
        <div className="card">
          <h2>Session</h2>
          <table>
            <tbody>
              <tr>
                <th>node</th>
                <td className="mono">{nodeUrl ?? "—"}</td>
              </tr>
              <tr>
                <th>application</th>
                <td className="mono">{applicationId ?? "—"}</td>
              </tr>
              <tr>
                <th>context</th>
                <td className="mono">{contextId ?? "not selected"}</td>
              </tr>
            </tbody>
          </table>
          {/*
            No inactivity logout anywhere in this app. A session ends when the
            user ends it — being idle overnight is normal use, and it costs
            nothing in exposure since the refresh token already lives in the
            same localStorage as the access token.
          */}
          <div className="row" style={{ marginTop: 14 }}>
            <button className="ghost" onClick={logout}>
              Log out
            </button>
          </div>
        </div>
      )}

      {/*
        Above every branch, so a link that arrives while a context is open is
        asked about too, rather than waiting until the user logs out. It stays
        on "Syncing…" until `KvPanel` has read the joined context's entries.
        The prompt asks with the ids because following a link must not act on
        the user's behalf: joining binds their identity to a namespace someone
        else chose and switches their active context.
      */}
      <InvitationDialog
        redemption={join}
        noun="namespace"
        appName="KV Store"
        detail={
          invited
            ? `Joining adds this node to namespace ${shortId(invited.namespaceId)} and opens its context ${shortId(invited.contextId)}.`
            : undefined
        }
      />
    </div>
  );
}
