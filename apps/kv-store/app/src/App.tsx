import { ConnectButton, useMero } from "@calimero-network/mero-react";
import { ContextPicker } from "./ContextPicker";
import { KvPanel } from "./KvPanel";

export function App() {
  const { isAuthenticated, isLoading, applicationId, contextId, nodeUrl, logout } = useMero();

  return (
    <div className="wrap">
      <header>
        <h1>KV Store</h1>
        <p className="sub">
          The reference Calimero app. An <code>UnorderedMap&lt;String,
          LwwRegister&lt;String&gt;&gt;</code> in a WASM contract, driven from a
          client generated out of that contract&apos;s own ABI.
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
        <ContextPicker applicationId={applicationId} />
      ) : (
        <KvPanel contextId={contextId} />
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
    </div>
  );
}
