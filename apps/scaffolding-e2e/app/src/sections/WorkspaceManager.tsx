import { useCallback, useState } from "react";
import type { AppInfo } from "@calimero-network/mero-js";
import { describeError, listAppInfos } from "@calimero-apps/connect";

import * as api from "../api/kvStore";
import { ResultBox } from "../components/ResultBox";
import { FieldHelp } from "../components/FieldHelp";
import { SyncBar } from "../components/SyncBar";
import { useAutoRefresh } from "../hooks/useAutoRefresh";
import { useCall } from "../hooks/useCall";
import { getConnection } from "../lib/calimero";

/**
 * The workspace directory: an app-level registry ABOVE the organization.
 *
 * The org says who reaches the app (owner, admins, members, guests); it does
 * not know that instance X is "#general" or that account Y may moderate this
 * workspace. That is app state, kept by the `ws_*` methods, and it is what this
 * page drives. v1's page also created namespaces, subgroups and contexts
 * through a node's admin API; on 1.0 an instance is created from the instance
 * list and a second account is invited from Setup, so what is left here is the
 * directory itself, the org as the node reports it, and the ping.
 */
export function WorkspaceManager() {
  const conn = getConnection();
  const [info, setInfo] = useState<api.WorkspaceInfo | null>(null);
  const [channels, setChannels] = useState<api.ChannelRecord[]>([]);
  const [groups, setGroups] = useState<api.WsGroupRecord[]>([]);
  const [instances, setInstances] = useState<AppInfo[] | null>(null);
  const [instancesError, setInstancesError] = useState<string | null>(null);

  const [chId, setChId] = useState("");
  const [chName, setChName] = useState("general");
  const [chTopic, setChTopic] = useState("");
  const [grId, setGrId] = useState("");
  const [grName, setGrName] = useState("Engineering");
  const [grDesc, setGrDesc] = useState("");
  const [pingTarget, setPingTarget] = useState("");

  const registerChannel = useCall();
  const unregisterChannel = useCall();
  const registerGroup = useCall();
  const unregisterGroup = useCall();
  const ping = useCall();
  const pong = useCall();
  const pingCount = useCall();
  const org = useCall();

  const poll = useCallback(async () => {
    const i = await api.wsGetInfo();
    setInfo(i.error ? null : (i.result?.output ?? null));
    const c = await api.wsListChannels();
    if (c.result?.output) setChannels(c.result.output);
    const g = await api.wsListGroups();
    if (g.result?.output) setGroups(g.result.output);
  }, []);
  const { pulse, sinceLabel } = useAutoRefresh(poll, 4000);

  async function loadInstances() {
    if (!conn) return;
    try {
      setInstances(await listAppInfos(conn.client));
      setInstancesError(null);
    } catch (e) {
      setInstancesError(describeError(e));
    } finally {
      conn.after();
    }
  }

  if (!conn) return null;

  return (
    <div>
      <div className="section-header">
        <h2 className="section-title">Workspace Manager</h2>
        <p className="section-desc">
          Channels (other app instances), groups and the ping, all kept by the contract&apos;s{" "}
          <code>ws_*</code> methods. Claim the workspace first in Setup; member roles are on the
          Workspace Members page.
        </p>
      </div>

      <div className="method-card" style={{ marginBottom: 16 }}>
        <SyncBar pulse={pulse} sinceLabel={sinceLabel} onRefresh={poll} />
        {info ? (
          <div style={{ fontSize: 13 }}>
            <strong>{info.name}</strong> · admin <code>{info.admin.slice(0, 16)}…</code> ·{" "}
            {info.channel_count} channels · {info.group_count} groups · {info.member_count} members
          </div>
        ) : (
          <p className="method-hint">The workspace is not claimed yet: run ws_init in Setup.</p>
        )}
      </div>

      <div className="method-grid">
        <div className="method-card">
          <div className="method-name">
            ws_register_channel(context_id, name, topic){" "}
            <FieldHelp text="A channel is another instance of this app, by its id. A member that is not read-only may register one; it is theirs to update or remove (and any workspace admin's to remove)." />
          </div>
          <div className="method-inputs">
            <input className="form-control" placeholder="instance id" aria-label="channel instance id" value={chId} onChange={(e) => setChId(e.target.value)} />
            <input className="form-control" placeholder="name" aria-label="channel name" value={chName} onChange={(e) => setChName(e.target.value)} />
            <input className="form-control" placeholder="topic" aria-label="channel topic" value={chTopic} onChange={(e) => setChTopic(e.target.value)} />
          </div>
          <div className="input-row">
            <button className="btn-calimero" disabled={registerChannel.loading || !chId.trim()} onClick={() => registerChannel.run(async () => { const r = await api.wsRegisterChannel(chId.trim(), chName, chTopic); void poll(); return r; })}>
              Register
            </button>
            <button className="btn-calimero-outline" onClick={() => setChId(conn.appId)}>
              This instance
            </button>
          </div>
          <ResultBox result={registerChannel.result} />
        </div>

        <div className="method-card">
          <div className="method-name">ws_register_group(group_id, name, description)</div>
          <div className="method-inputs">
            <input className="form-control" placeholder="group id" aria-label="group id" value={grId} onChange={(e) => setGrId(e.target.value)} />
            <input className="form-control" placeholder="name" aria-label="group name" value={grName} onChange={(e) => setGrName(e.target.value)} />
            <input className="form-control" placeholder="description" aria-label="group description" value={grDesc} onChange={(e) => setGrDesc(e.target.value)} />
          </div>
          <button className="btn-calimero" disabled={registerGroup.loading || !grId.trim()} onClick={() => registerGroup.run(async () => { const r = await api.wsRegisterGroup(grId.trim(), grName, grDesc); void poll(); return r; })}>
            Register
          </button>
          <ResultBox result={registerGroup.result} />
        </div>
      </div>

      <div className="method-card" style={{ marginTop: 16 }}>
        <div className="method-name">ws_list_channels() · ws_unregister_channel(context_id)</div>
        {channels.length === 0 ? (
          <p className="method-hint">No channels registered.</p>
        ) : (
          <table style={{ width: "100%", fontSize: 12 }}>
            <tbody>
              {channels.map((c) => (
                <tr key={c.context_id}>
                  <td><strong>#{c.name}</strong> <span className="method-hint">{c.topic}</span></td>
                  <td><code>{c.context_id.slice(0, 20)}</code></td>
                  <td className="method-hint">by {c.created_by.slice(0, 12)}…</td>
                  <td style={{ textAlign: "right" }}>
                    <button className="btn-calimero-outline" style={{ fontSize: 11, padding: "2px 8px" }} onClick={() => setPingTarget(c.context_id)}>
                      Ping target
                    </button>{" "}
                    <button className="btn-calimero-outline" style={{ fontSize: 11, padding: "2px 8px" }} onClick={() => unregisterChannel.run(async () => { const r = await api.wsUnregisterChannel(c.context_id); void poll(); return r; })}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <ResultBox result={unregisterChannel.result} />
      </div>

      <div className="method-card" style={{ marginTop: 16 }}>
        <div className="method-name">ws_list_groups() · ws_unregister_group(group_id)</div>
        {groups.length === 0 ? (
          <p className="method-hint">No groups registered.</p>
        ) : (
          <table style={{ width: "100%", fontSize: 12 }}>
            <tbody>
              {groups.map((g) => (
                <tr key={g.group_id}>
                  <td><strong>{g.name}</strong> <span className="method-hint">{g.description}</span></td>
                  <td><code>{g.group_id}</code></td>
                  <td className="method-hint">by {g.created_by.slice(0, 12)}…</td>
                  <td style={{ textAlign: "right" }}>
                    <button className="btn-calimero-outline" style={{ fontSize: 11, padding: "2px 8px" }} onClick={() => unregisterGroup.run(async () => { const r = await api.wsUnregisterGroup(g.group_id); void poll(); return r; })}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <ResultBox result={unregisterGroup.result} />
      </div>

      <div className="method-grid" style={{ marginTop: 16 }}>
        <div className="method-card">
          <div className="method-name">
            ws_ping_channel(target_context_id){" "}
            <FieldHelp text="v1 queued an xcall to the target's ws_pong. Core 1.0.0-rc.7 components cannot send one: the ping is recorded (ChannelPinged) and nothing is delivered, so the target's ws_ping_count stays where it is." />
          </div>
          <div className="method-inputs">
            <input className="form-control" placeholder="target instance id" aria-label="ping target" value={pingTarget} onChange={(e) => setPingTarget(e.target.value)} />
          </div>
          <div className="input-row">
            <button className="btn-calimero" disabled={ping.loading || !pingTarget.trim()} onClick={() => ping.run(() => api.wsPingChannel(pingTarget.trim()))}>
              Ping
            </button>
            <button className="btn-calimero-outline" disabled={pingCount.loading} onClick={() => pingCount.run(() => api.wsPingCount())}>
              ws_ping_count()
            </button>
          </div>
          <ResultBox result={ping.result} />
          <ResultBox result={pingCount.result} />
        </div>

        <div className="method-card">
          <div className="method-name">
            ws_pong(from_context){" "}
            <FieldHelp text="Accepts another app as its caller only (allow(app = &quot;*&quot;)). Called directly by an account it answers Invalid — which is what this button shows." />
          </div>
          <button className="btn-calimero-outline" disabled={pong.loading} onClick={() => pong.run(() => api.wsPong(conn.appId))}>
            Call ws_pong directly (refused)
          </button>
          <ResultBox result={pong.result} />
        </div>

        <div className="method-card">
          <div className="method-name">Organization and instances</div>
          <p className="method-hint">
            Who reaches this instance is its organization&apos;s business: invite from Setup. The
            instances your account reaches are the channel candidates.
          </p>
          <div className="input-row">
            <button className="btn-calimero-outline" disabled={!conn.org || org.loading} onClick={() => org.run(async () => { try { return { result: { output: await conn.client.orgs.get({ org: conn.org as string }) } }; } finally { conn.after(); } })}>
              getOrg()
            </button>
            <button className="btn-calimero-outline" onClick={() => void loadInstances()}>
              listApps()
            </button>
          </div>
          <ResultBox result={org.result} />
          {instancesError && <pre className="result-box error">{instancesError}</pre>}
          {instances && (
            <table style={{ width: "100%", fontSize: 12 }}>
              <tbody>
                {instances.map((a) => (
                  <tr key={a.appId}>
                    <td>{a.name}</td>
                    <td><code>{a.appId.slice(0, 16)}…</code></td>
                    <td style={{ textAlign: "right" }}>
                      <button className="btn-calimero-outline" style={{ fontSize: 11, padding: "2px 8px" }} onClick={() => { setChId(a.appId); setChName(a.name); }}>
                        Use as channel
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
