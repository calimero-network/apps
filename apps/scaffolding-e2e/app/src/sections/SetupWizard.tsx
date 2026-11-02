import { useState } from "react";
import { browserPasskey } from "@calimero-network/mero-js";

import * as api from "../api/kvStore";
import { InviteCard } from "../components/InviteCard";
import { ResultBox } from "../components/ResultBox";
import { FieldHelp } from "../components/FieldHelp";
import { useCall } from "../hooks/useCall";
import { getConnection } from "../lib/calimero";

/**
 * What v1's wizard did with a node's admin API (create a namespace, install the
 * bundle, create a context, invite a second node) is three things on 1.0:
 *
 *   1. the instance — picked or created from the list (`createApp`), in an
 *      organization of its own when it is shared (`createOrg`);
 *   2. a second account — an org invitation link, approved with your passkey;
 *   3. the workspace claim — `ws_init`, as before.
 *
 * Installing is gone: in development `pnpm dev:local scaffolding-e2e` uploads
 * the component and the app creates instances from that bundle; in production
 * instances come from the package.
 */
export function SetupWizard() {
  const conn = getConnection();
  const [wsName, setWsName] = useState("My Workspace");
  const infoCall = useCall();
  const initCall = useCall();
  const whoCall = useCall();

  if (!conn) return null;

  return (
    <div>
      <div className="section-header">
        <h2 className="section-title">Setup</h2>
        <p className="section-desc">
          The open instance, a second account to test with, and the workspace claim. Every write
          goes through the cluster&apos;s log, so a second account sees it at once: there is no
          node to join and nothing to wait for.
        </p>
      </div>

      <div className="method-grid">
        <div className="method-card">
          <div className="method-name">1 · The instance</div>
          <table style={{ fontSize: 12, width: "100%" }}>
            <tbody>
              <tr>
                <td style={{ color: "var(--color-text-muted)", paddingRight: 8 }}>instance</td>
                <td><code>{conn.appId}</code></td>
              </tr>
              <tr>
                <td style={{ color: "var(--color-text-muted)", paddingRight: 8 }}>organization</td>
                <td>{conn.org ? <code>{conn.org}</code> : <em>none (private instance)</em>}</td>
              </tr>
              <tr>
                <td style={{ color: "var(--color-text-muted)", paddingRight: 8 }}>account</td>
                <td><code>{conn.accountId}</code></td>
              </tr>
            </tbody>
          </table>
          <div className="input-row" style={{ marginTop: 10 }}>
            <button className="btn-calimero-outline" disabled={whoCall.loading} onClick={() => whoCall.run(() => api.whoami())}>
              whoami()
            </button>
          </div>
          <p className="method-hint">
            &ldquo;Change instance&rdquo; in the bar above goes back to the list, where you can create
            another. The app&apos;s owner (whoever created the instance) is its first ACL admin,
            owner of the owned cell, shared-cell writer and workspace admin.
          </p>
          <ResultBox result={whoCall.result} />
        </div>

        <InviteCard client={conn.client} org={conn.org} passkey={browserPasskey} after={conn.after} />

        <div className="method-card">
          <div className="method-name">
            3 · ws_init(name) <FieldHelp text="Claims the workspace and makes you its admin. Only a workspace admin may (the instance's owner first), and only once." />
          </div>
          <div className="method-inputs">
            <input className="form-control" aria-label="workspace name" value={wsName} onChange={(e) => setWsName(e.target.value)} />
          </div>
          <div className="input-row">
            <button className="btn-calimero" disabled={initCall.loading || !wsName.trim()} onClick={() => initCall.run(() => api.wsInit(wsName.trim()))}>
              Claim workspace
            </button>
            <button className="btn-calimero-outline" disabled={infoCall.loading} onClick={() => infoCall.run(() => api.wsGetInfo())}>
              ws_get_info()
            </button>
          </div>
          <ResultBox result={initCall.result} />
          <ResultBox result={infoCall.result} />
        </div>
      </div>
    </div>
  );
}
