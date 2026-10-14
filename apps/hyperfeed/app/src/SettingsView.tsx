import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { AgentMode, NotificationMode } from "./backend";
import { messageOf, type Feed, type PushState } from "./useFeed";
import { Badge, NewFeedButton, type NewFeed } from "./FeedView";
import { DEFAULT_APPS, appLook } from "./apps";
import { GUARD_LABELS, TYPE_LABELS } from "./format";
import type { Folder, LensView, ReachLine, RuleProposalView, RuleView } from "./generated/HyperfeedClient";
import type { Preview, PreviewRow } from "./preview";
import { currentEndpoint, deviceName, inputOf, pushSupported, subscribe, unsubscribe } from "./push";
import { AGENT_LIVE_MS } from "./theme";
import { DEFAULT_LANGUAGE, LANGUAGES, languageOf, languageRule } from "./language";
import { assignedAgent, CODE_APP, defaultLabel, privateAgents } from "./assignments";

const AGENT_OPTIONS: { id: AgentMode; label: string }[] = [
  { id: "act", label: "Act" },
  { id: "ask", label: "Ask first" },
  { id: "read", label: "Read only" },
  { id: "off", label: "Off" },
];

const NOTIFICATION_OPTIONS: { id: NotificationMode; label: string }[] = [
  { id: "push", label: "Feed + push" },
  { id: "feed", label: "Feed" },
  { id: "mute", label: "Mute" },
];

/** The parts of Settings, each its own page under `/settings/<id>`. */
export type SettingsSection = "controls" | "rules" | "agents" | "lenses" | "alerts";

const SECTIONS: { id: SettingsSection; label: string; hint: string }[] = [
  { id: "controls", label: "Controls", hint: "What your agent may do, and what always asks you" },
  { id: "rules", label: "Rules", hint: "The language your agent answers in, and the lines it keeps to on every turn" },
  { id: "agents", label: "Agents", hint: "Who works for this feed, and what each can reach" },
  { id: "lenses", label: "Lenses", hint: "What your feed reads from each app" },
  { id: "alerts", label: "Alerts", hint: "Push to your phone" },
];

/** `/settings/<id>` names a section; anything else is Controls. */
export function settingsSection(id: string | undefined): SettingsSection {
  return SECTIONS.some((s) => s.id === id) ? (id as SettingsSection) : "controls";
}

/**
 * Settings, one section at a time: Controls (per-app permissions, pause,
 * guards), Rules (the language your agent answers in, your standing rules and
 * the ones it suggests), Agents (who reports in, what each can reach, how to
 * connect one), Lenses (what the feed reads from each app) and Alerts (phone
 * push). A section a feed cannot have, such as Alerts on a feed made before
 * push, is not listed.
 */
export function SettingsView({
  feed,
  contextId,
  preview,
  newFeed,
  section,
  base = "",
}: {
  feed: Feed;
  contextId: string | null;
  preview?: Preview;
  newFeed?: NewFeed;
  section: SettingsSection;
  /** Where the app is mounted: "" on your node, "/demo" in the demo. */
  base?: string;
}) {
  const { settings } = feed;
  const sections = SECTIONS.filter((s) => s.id !== "alerts" || Boolean(feed.loadPush));
  const current = sections.some((s) => s.id === section) ? section : "controls";

  return (
    <div className="settings">
      <nav className="settings-nav" aria-label="Settings">
        {sections.map((s) => {
          const count =
            s.id === "lenses"
              ? feed.lenses.filter((l) => l.status === "proposed").length
              : s.id === "rules"
                ? (settings?.rule_proposals?.length ?? 0)
                : 0;
          return (
            <Link
              key={s.id}
              to={`${base}/settings/${s.id}`}
              className={s.id === current ? "on" : ""}
              aria-current={s.id === current ? "page" : undefined}
              title={s.hint}
            >
              <span>{s.label}</span>
              {count > 0 && (
                <span className="count" aria-label={`${count} waiting for you`}>
                  {count}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
      <div className="settings-body">
        {feed.error && (
          <div className="error" role="alert">
            <span>{feed.error}</span>
            <button type="button" className="ghost small" onClick={feed.dismissError}>
              Dismiss
            </button>
          </div>
        )}
        {!settings ? (
          <div className="empty">Loading your settings…</div>
        ) : current === "controls" ? (
          <ControlsSection feed={feed} />
        ) : current === "rules" ? (
          <RulesSection feed={feed} />
        ) : current === "agents" ? (
          <AgentsSection feed={feed} contextId={contextId} />
        ) : current === "lenses" ? (
          <LensesSection feed={feed} preview={preview} newFeed={newFeed} />
        ) : (
          <PhoneAlerts feed={feed} />
        )}
      </div>
    </div>
  );
}

/**
 * What a control was just set to, shown until the contract's answer is read
 * back. Without it a checkbox snaps back to its old state for the length of
 * the round trip, which reads as the click not having worked.
 */
function usePending() {
  const [pending, setPending] = useState<Record<string, string | boolean>>({});
  const write = async (key: string, value: string | boolean, call: () => Promise<void>) => {
    setPending((p) => ({ ...p, [key]: value }));
    try {
      await call();
    } finally {
      setPending((p) => {
        const next = { ...p };
        delete next[key];
        return next;
      });
    }
  };
  return { pending, write };
}

/** Per-app permissions and notifications, pause, and the guards. */
function ControlsSection({ feed }: { feed: Feed }) {
  const { settings, page } = feed;
  const { pending, write } = usePending();

  // Every app with a policy, every app in the feed, and the usual ones.
  const apps = useMemo(() => {
    const keys = new Set(DEFAULT_APPS);
    for (const p of settings?.policies ?? []) keys.add(p.app);
    for (const a of page?.apps ?? []) keys.add(a.app);
    return [...keys];
  }, [settings, page]);

  if (!settings) return null;

  const policyOf = (app: string) => {
    const stored = settings.policies.find((p) => p.app === app) ?? { app, agent: "ask", notifications: "feed" };
    return {
      agent: String(pending[`agent:${app}`] ?? stored.agent) as AgentMode,
      notifications: String(pending[`notifications:${app}`] ?? stored.notifications) as NotificationMode,
    };
  };

  return (
    <div className="controls">
      <section className="panel wide" aria-labelledby="h-apps">
        <h2 id="h-apps">What your agent may do, app by app</h2>
        <p className="muted">
          "Act" lets the agent sign warrants in that app without asking. An app you never set asks first. Muting
          hides an app's notifications; they are still recorded, so unmuting brings them back.
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">App</th>
                <th scope="col">Agent</th>
                <th scope="col">Notifications</th>
              </tr>
            </thead>
            <tbody>
              {apps.map((app) => {
                const policy = policyOf(app);
                const look = appLook(app);
                return (
                  <tr key={app}>
                    <th scope="row">
                      <span className="app-cell">
                        <Badge app={app} size="sm" />
                        {look.name}
                      </span>
                    </th>
                    <td>
                      <Segmented
                        label={`Agent permission in ${look.name}`}
                        value={policy.agent}
                        options={AGENT_OPTIONS}
                        disabled={feed.busy}
                        onChange={(agent) =>
                          void write(`agent:${app}`, agent, () => feed.setPolicy(app, agent, policy.notifications))
                        }
                      />
                    </td>
                    <td>
                      <Segmented
                        label={`Notifications from ${look.name}`}
                        value={policy.notifications}
                        options={NOTIFICATION_OPTIONS}
                        disabled={feed.busy}
                        onChange={(n) =>
                          void write(`notifications:${app}`, n, () => feed.setPolicy(app, policy.agent, n))
                        }
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <div className="side">
        <section className="panel" aria-labelledby="h-pause">
          <h2 id="h-pause">Pause</h2>
          <p className="muted">While paused, everything the agent wants to write waits for your approval.</p>
          <button
            type="button"
            className={settings.paused ? "primary" : "ghost"}
            disabled={feed.busy}
            onClick={() => void feed.setPaused(!settings.paused)}
          >
            {settings.paused ? "Resume agent" : "Pause agent"}
          </button>
        </section>

        <section className="panel" aria-labelledby="h-guards">
          <h2 id="h-guards">Always ask me before</h2>
          <p className="muted">These override "Act" in every app.</p>
          {settings.guards.map((g) => {
            const enabled = Boolean(pending[`guard:${g.category}`] ?? g.enabled);
            return (
              <label key={g.category} className="check">
                <input
                  type="checkbox"
                  checked={enabled}
                  disabled={feed.busy}
                  onChange={() => void write(`guard:${g.category}`, !enabled, () => feed.setGuard(g.category, !enabled))}
                />
                <span>{GUARD_LABELS[g.category] ?? g.category}</span>
              </label>
            );
          })}
        </section>
      </div>
    </div>
  );
}

/** Who reports in to this feed, what each can reach on its computer, and how to connect one. */
function AgentsSection({ feed, contextId }: { feed: Feed; contextId: string | null }) {
  const settings = feed.settings;
  if (!settings) return null;
  const now = Date.now();
  const privates = new Set(privateAgents(settings));
  return (
    <div className="controls">
      <section className="panel wide" aria-labelledby="h-agents">
        <h2 id="h-agents">Your agents</h2>
        {settings.agents.length === 0 ? (
          <p className="muted">No agent has reported in yet. Connect one below.</p>
        ) : (
          <ul className="agent-list">
            {settings.agents.map((a) => {
              const live = now - a.seen_at < AGENT_LIVE_MS;
              return (
                <li key={a.name}>
                  <span className="mono">{a.name}</span>
                  {privates.has(a.name) && (
                    <span className="pill" title="Every model it runs is attested: no one, Calimero included, can read what it is told">
                      Private
                    </span>
                  )}
                  <span className={`pill ${live ? "pill-good" : "pill-bad"}`}>
                    {live ? "Live" : `Last seen ${new Date(a.seen_at).toLocaleString()}`}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* A feed made before assignments has no `assignments` in its settings, and no setter. */}
      {feed.setAssignment && Array.isArray(settings.assignments) && <AgentAssignments feed={feed} />}

      {/* A feed made before access has no `access` in its settings, and no setter. */}
      {feed.setAccess && Array.isArray(settings.access) && <AgentReach feed={feed} />}

      <section className="panel" aria-labelledby="h-agent">
        <h2 id="h-agent">Connect your agent</h2>
        <p className="muted">
          Run <strong>mero-bot</strong> on the machine with this node: it finds this feed by itself, checks every
          call it makes against your controls, logs what it does here, and carries out what you approve or answer.
          Any other agent uses the same API: <code>check_action</code> before acting, <code>record_action</code>{" "}
          to log or propose, <code>complete_action</code> after your decision.
        </p>
        <dl className="facts">
          <div className="fact">
            <dt>Feed context</dt>
            <dd className="mono">{contextId ?? "demo — not on a node"}</dd>
          </div>
          <div className="fact">
            <dt>Owner</dt>
            <dd className="mono">{settings.owner}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}

/** What your feed reads from each app: the lenses your agent proposed, and yours to approve. */
function LensesSection({ feed, preview, newFeed }: { feed: Feed; preview?: Preview; newFeed?: NewFeed }) {
  return (
    <div className="controls">
      <section className="panel full" aria-labelledby="h-lenses">
        <h2 id="h-lenses">What your feed reads from each app</h2>
        <p className="muted">
          Your agent reads each app's ABI and writes a lens: which events matter to you, what kind of item each
          becomes, and how your answer goes back. Nothing is recorded from an app until you approve its lens, and a
          new app version is learned again.
        </p>
        {feed.outdated ? (
          <p className="notice">
            Your feed was made by an earlier Hyperfeed. It still works, but it can't hold lenses or typed items: those need a feed made by the Hyperfeed installed now.
            {newFeed && <NewFeedButton newFeed={newFeed} />}
          </p>
        ) : feed.lenses.length === 0 ? (
          <p className="muted">Nothing learned yet. Chat uses the lens this app ships.</p>
        ) : (
          <ul className="lenses">
            {feed.lenses.map((l) => (
              <LensRow key={`${l.app}@${l.application_id}`} lens={l} feed={feed} preview={preview} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * Push to your phone: this device subscribes with your agent's runtime's key,
 * and the runtime wakes it when something needs you and you have not seen it
 * for a minute. Every subscribed device is listed, and each can be taken off.
 */
function PhoneAlerts({ feed }: { feed: Feed }) {
  const [push, setPush] = useState<PushState | null>(null);
  const [mine, setMine] = useState<string | null>(null);
  const [quiet, setQuiet] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const supported = pushSupported();

  const loadPush = feed.loadPush;
  const load = useCallback(async () => {
    if (!loadPush) return;
    try {
      const [p, e] = await Promise.all([loadPush(), currentEndpoint().catch(() => null)]);
      setPush(p);
      setMine(e);
    } catch (e) {
      setProblem(messageOf(e));
    }
  }, [loadPush]);
  useEffect(() => {
    void load();
  }, [load]);

  if (!push) return null;
  const key = push.key.public_key;
  const here = mine ? push.devices.find((d) => d.endpoint === mine) : undefined;

  const start = async () => {
    if (!feed.addPushDevice) return;
    setWorking(true);
    setProblem(null);
    try {
      const sub = await subscribe(key);
      await feed.addPushDevice(inputOf(sub, deviceName(navigator.userAgent), quiet, key));
    } catch (e) {
      setProblem(messageOf(e));
    } finally {
      setWorking(false);
      await load();
    }
  };
  const remove = async (endpoint: string) => {
    if (!feed.removePushDevice) return;
    setWorking(true);
    setProblem(null);
    try {
      if (endpoint === mine) await unsubscribe().catch(() => undefined);
      await feed.removePushDevice(endpoint);
    } finally {
      setWorking(false);
      await load();
    }
  };

  return (
    <section className="panel" aria-labelledby="h-push">
      <h2 id="h-push">Phone alerts</h2>
      <p className="muted">
        Your agent's runtime wakes your phone when something needs you and you haven't seen it for a minute. Each push is
        encrypted to the device: the push service sees only that one was sent.
      </p>
      {!key ? (
        <p className="muted">Start mero-bot against this feed first: it sets the key your devices subscribe with.</p>
      ) : !supported ? (
        <p className="muted">This browser can't take pushes. On an iPhone, add Hyperfeed to your Home Screen and open it from there.</p>
      ) : here ? (
        <p className="muted">This device gets pushes{here.quiet ? ", saying only \"Something needs you\"" : ""}.</p>
      ) : (
        <>
          <label className="check">
            <input type="checkbox" checked={quiet} onChange={() => setQuiet(!quiet)} />
            <span>Quiet: say only "Something needs you", with no title or text</span>
          </label>
          <button type="button" className="primary" disabled={working || feed.busy} onClick={() => void start()}>
            Push to this device
          </button>
        </>
      )}
      {problem && (
        <p className="error" role="alert">
          {problem}
        </p>
      )}
      {push.devices.length > 0 && (
        <ul className="rules" aria-label="Devices your agent pushes to">
          {push.devices.map((d) => (
            <li key={d.endpoint} className="rule">
              <span>
                {d.name}
                {d.endpoint === mine ? " (this device)" : ""}
                {d.quiet ? " · quiet" : ""}
              </span>
              <button
                type="button"
                className="ghost small"
                disabled={working || feed.busy}
                aria-label={`Stop pushing to ${d.name}`}
                onClick={() => void remove(d.endpoint)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Which agent works in each app: only that one takes the app's work (new
 * items, your decisions on its rows, your chats about it) and calls the app.
 * An app you leave on the default is your private agent's. Code is the app
 * "mero-bot": the tools on a computer. Only you set these; mero-bot refuses
 * `set_assignment` to the agent.
 */
function AgentAssignments({ feed }: { feed: Feed }) {
  const settings = feed.settings!;
  const { page } = feed;
  const { pending, write } = usePending();
  const apps = useMemo(() => {
    const keys = new Set([CODE_APP, ...DEFAULT_APPS]);
    for (const p of settings.policies) keys.add(p.app);
    for (const a of page?.apps ?? []) keys.add(a.app);
    for (const a of settings.assignments ?? []) keys.add(a.app);
    return [...keys];
  }, [settings, page]);
  const privates = new Set(privateAgents(settings));
  // Every agent that reported in or reported what it reaches, and any you assigned that hasn't yet.
  const agents = [
    ...new Set([...settings.agents.map((a) => a.name), ...(settings.reach ?? []).map((r) => r.agent), ...(settings.assignments ?? []).map((a) => a.agent)]),
  ]
    .filter(Boolean)
    .sort();
  return (
    <section className="panel wide" aria-labelledby="h-assign">
      <h2 id="h-assign">Who works in each app</h2>
      <p className="muted">
        Only the agent you pick takes an app's work and may call it. An app on the default goes to your private agent. When
        an agent meets work that needs code, it asks you before handing it to the agent you gave Code.
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">App</th>
              <th scope="col">Agent</th>
            </tr>
          </thead>
          <tbody>
            {apps.map((app) => {
              const look = appLook(app);
              const name = app === CODE_APP ? "Code" : look.name;
              const value = String(pending[`assign:${app}`] ?? assignedAgent(settings, app));
              return (
                <tr key={app}>
                  <th scope="row">
                    <span className="app-cell">
                      <Badge app={app} size="sm" />
                      {name}
                      {app === CODE_APP && <span className="muted"> · shell, files and git on a computer</span>}
                    </span>
                  </th>
                  <td>
                    <select
                      aria-label={`Agent for ${name}`}
                      value={value}
                      disabled={feed.busy}
                      onChange={(e) => void write(`assign:${app}`, e.target.value, () => feed.setAssignment!(app, e.target.value))}
                    >
                      <option value="">{`Default: ${defaultLabel(settings)}`}</option>
                      {agents.map((a) => (
                        <option key={a} value={a}>
                          {privates.has(a) ? `${a} (private)` : a}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** One line of what an agent reported it can reach: its profile, and where it reaches besides your apps. */
function reachLabel(l: ReachLine): string {
  const who = `${l.profile}${l.model ? ` (${l.model})` : ""}${l.attested ? ", attested" : ""}`;
  const where = [
    ...l.folders.map((f) => `${f.path}${f.write ? "" : " (read only)"}`),
    ...(l.shell ? ["shell"] : []),
    ...(l.web ? ["web"] : []),
  ];
  return `${who}: Calimero apps${where.length ? `, ${where.join(", ")}` : " only"}`;
}

const SERVES: Record<string, string> = {
  default: "Default",
  converse: "Your messages",
  triage: "New items",
  "carry-out": "Your decisions",
  learn: "Lenses",
  watch: "Watches",
  typed: "Typed",
};

/**
 * What each agent can reach on its computer besides your apps: what it
 * reported, and the folders, shell and web you let it use. Only you set these;
 * mero-bot refuses `set_access` to the agent and checks every tool call
 * against them.
 */
function AgentReach({ feed }: { feed: Feed }) {
  const settings = feed.settings!;
  const names = [
    ...new Set([...(settings.reach ?? []).map((r) => r.agent), ...(settings.access ?? []).map((a) => a.agent), ...settings.agents.map((a) => a.name)]),
  ].filter((n) => n.startsWith("mero-bot@") || (settings.access ?? []).some((a) => a.agent === n) || (settings.reach ?? []).some((r) => r.agent === n));
  return (
    <section className="panel" aria-labelledby="h-reach">
      <h2 id="h-reach">What your agents can reach</h2>
      <p className="muted">
        Besides your Calimero apps: folders on the agent's computer, a shell and the web. Only you can change these, and
        the agent's runtime checks every call against them.
      </p>
      {names.length === 0 ? (
        <p className="muted">No agent has said what it can reach yet. mero-bot does when it starts.</p>
      ) : (
        names.map((name) => <AgentAccess key={name} feed={feed} agent={name} />)
      )}
    </section>
  );
}

function AgentAccess({ feed, agent }: { feed: Feed; agent: string }) {
  const id = useId();
  const settings = feed.settings!;
  const set = (settings.access ?? []).find((a) => a.agent === agent);
  const reach = (settings.reach ?? []).find((r) => r.agent === agent);
  // What it reported for its local profile is what it uses now; start editing from that, or from nothing.
  const reported = reach?.lines.find((l) => l.folders.length > 0 || l.shell || l.web);
  const start = set ?? (reported ? { folders: reported.folders, shell: reported.shell, web: reported.web } : { folders: [], shell: false, web: false });
  const [folders, setFolders] = useState<Folder[]>(start.folders.map((f) => ({ ...f })));
  const [shell, setShell] = useState(start.shell);
  const [web, setWeb] = useState(start.web);
  const [path, setPath] = useState("");
  const [refused, setRefused] = useState<string | null>(null);
  const dirty =
    JSON.stringify({ folders, shell, web }) !== JSON.stringify({ folders: start.folders.map((f) => ({ path: f.path, write: f.write })), shell: start.shell, web: start.web });

  const add = () => {
    const p = path.trim().replace(/\/+$/, "") || path.trim();
    if (!p) return;
    if (!(p.startsWith("/") || p === "~" || p.startsWith("~/"))) return setRefused("A folder is an absolute path, or one under ~ (like ~/workspace).");
    if (p.split("/").includes("..")) return setRefused("A folder can't contain '..'.");
    if (folders.some((f) => f.path === p)) return setRefused(`${p} is already listed.`);
    setFolders([...folders, { path: p, write: false }]);
    setPath("");
    setRefused(null);
  };

  return (
    <div className="agent-access" aria-label={`What ${agent} can reach`} role="group">
      <h3 className="mono">{agent}</h3>
      {reach && (
        <ul className="reach-lines" aria-label={`What ${agent} reports`}>
          {reach.lines.map((l) => (
            <li key={`${l.serves}:${l.profile}`}>
              <strong>{SERVES[l.serves] ?? l.serves}</strong> · {reachLabel(l)}
            </li>
          ))}
        </ul>
      )}
      {!set && (
        <p className="muted">
          Not set by you: it uses its own default (the folder mero-bot sits in, read and write, with shell and web on).
        </p>
      )}
      <ul className="folders" aria-label={`Folders ${agent} may use`}>
        {folders.length === 0 && <li className="muted">No folders: your Calimero apps only.</li>}
        {folders.map((f) => (
          <li key={f.path} className="folder">
            <span className="mono">{f.path}</span>
            <label className="check">
              <input
                type="checkbox"
                checked={f.write}
                onChange={() => setFolders(folders.map((x) => (x.path === f.path ? { ...x, write: !x.write } : x)))}
              />
              <span>Can write</span>
            </label>
            <button type="button" className="ghost small" aria-label={`Remove ${f.path}`} onClick={() => setFolders(folders.filter((x) => x.path !== f.path))}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      <form
        className="folder-add"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <label htmlFor={`${id}-folder`} className="sr-only">
          Add a folder
        </label>
        <input id={`${id}-folder`} value={path} placeholder="Add a folder, like ~/workspace" onChange={(e) => setPath(e.target.value)} />
        <button type="submit" className="ghost small" disabled={!path.trim()}>
          Add
        </button>
      </form>
      {refused && (
        <p className="error-inline" role="alert">
          {refused}
        </p>
      )}
      <label className="check">
        <input type="checkbox" checked={shell} onChange={() => setShell(!shell)} />
        <span>Shell: runs commands as you, and is not limited to these folders</span>
      </label>
      <label className="check">
        <input type="checkbox" checked={web} onChange={() => setWeb(!web)} />
        <span>Web: fetch pages and search</span>
      </label>
      <button type="button" className="primary small" disabled={feed.busy || !dirty} onClick={() => void feed.setAccess?.(agent, folders, shell, web)}>
        Save
      </button>
    </div>
  );
}

/** Rules a feed holds at once, as the contract counts them (`MAX_RULES`). */
const MAX_RULES = 30;
/** One rule's length, as the contract allows it (`MAX_RULE`). */
const MAX_RULE = 280;

/** Rules to start from, offered while you have none of your own. */
const EXAMPLE_RULES = [
  "Never push to main: open a PR instead",
  "Ask me before messaging anyone new",
  "Keep answers short",
];

/**
 * Settings → Rules: the language your agent answers in, then your standing
 * rules, short lines it keeps to on every turn. Only you add or remove them;
 * one your agent suggests after you corrected it waits here with one-tap
 * Approve, which adds it as yours. The language is a standing rule in a fixed
 * wording (see language.ts), shown as a picker rather than in the list.
 */
function RulesSection({ feed }: { feed: Feed }) {
  const rules = feed.settings?.rules ?? [];
  const suggested = feed.settings?.rule_proposals ?? [];
  const spoken = rules.filter((r) => languageOf(r.text) !== null);
  const others = rules.filter((r) => languageOf(r.text) === null);
  return (
    <div className="rules-page">
      <LanguageRule feed={feed} spoken={spoken} />
      {suggested.length > 0 && (
        <section className="panel" aria-labelledby="h-suggested">
          <div className="panel-head">
            <h2 id="h-suggested">Suggested by your agent</h2>
            <span className="pill pill-wait">{suggested.length} waiting</span>
          </div>
          <p className="muted">Your agent suggests these after you corrected it. Nothing changes until you approve one.</p>
          <ul className="rule-suggestions" aria-label="Rules your agent suggests">
            {suggested.map((p) => (
              <RuleSuggestion key={p.id} proposal={p} feed={feed} />
            ))}
          </ul>
        </section>
      )}
      <StandingRules feed={feed} rules={others} total={rules.length} />
    </div>
  );
}

/** The language your agent answers in: English until you pick another. */
function LanguageRule({ feed, spoken }: { feed: Feed; spoken: RuleView[] }) {
  const id = useId();
  const [picking, setPicking] = useState<string | null>(null);
  // Two language rules (one approved from a suggestion on top of yours): the newest wins.
  const newest = spoken[spoken.length - 1];
  const set = newest ? languageOf(newest.text) : null;
  const shown = picking ?? set ?? DEFAULT_LANGUAGE;
  const options = LANGUAGES.some((l) => l.name === shown) ? LANGUAGES : [...LANGUAGES, { name: shown, native: shown }];
  const pick = async (language: string) => {
    if (language === set && spoken.length === 1) return;
    setPicking(language);
    try {
      // Removed first, so a feed at its limit of rules can still change language.
      for (const r of spoken) await feed.removeRule(r.id);
      await feed.addRule(languageRule(language));
    } finally {
      setPicking(null);
    }
  };
  return (
    <section className="panel rules-language" aria-labelledby="h-language">
      <div className="panel-head">
        <h2 id="h-language">Language</h2>
        {!set && <span className="pill">Default</span>}
      </div>
      <p className="muted">Your agent answers in this language, unless you write to it in another.</p>
      <div className="language-pick">
        <label htmlFor={`${id}-language`}>Answers in</label>
        <select
          id={`${id}-language`}
          value={shown}
          disabled={feed.busy || picking !== null}
          onChange={(e) => void pick(e.target.value)}
        >
          {options.map((l) => (
            <option key={l.name} value={l.name}>
              {l.native === l.name ? l.name : `${l.name} · ${l.native}`}
            </option>
          ))}
        </select>
      </div>
    </section>
  );
}

/** Your standing rules besides the language: each on its own line, and a field to add one. */
function StandingRules({ feed, rules, total }: { feed: Feed; rules: RuleView[]; total: number }) {
  const id = useId();
  const [text, setText] = useState("");
  const full = total >= MAX_RULES;
  const add = async () => {
    const t = text.trim();
    if (!t) return;
    await feed.addRule(t);
    setText("");
  };
  return (
    <section className="panel" aria-labelledby="h-rules">
      <div className="panel-head">
        <h2 id="h-rules">Standing rules</h2>
        {total > MAX_RULES - 5 && (
          <span className="muted small-text" title="The language counts as one">
            {total} of {MAX_RULES} used
          </span>
        )}
      </div>
      <p className="muted">Short lines your agent keeps to on every turn, whatever it is doing. Only you can change them.</p>
      {rules.length === 0 ? (
        <div className="rules-empty">
          <p className="muted">No rules yet. Add one your agent should always keep to, or start from one of these:</p>
          <div className="rule-examples">
            {EXAMPLE_RULES.map((e) => (
              <button key={e} type="button" className="chip" onClick={() => setText(e)}>
                {e}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <ol className="rule-list" aria-label="Your standing rules">
          {rules.map((r, i) => (
            <li key={r.id} className="rule-item">
              <span className="rule-n" aria-hidden="true">
                {i + 1}
              </span>
              <span className="rule-text">{r.text}</span>
              <button
                type="button"
                className="ghost small"
                disabled={feed.busy}
                aria-label={`Remove "${r.text}"`}
                onClick={() => void feed.removeRule(r.id)}
              >
                Remove
              </button>
            </li>
          ))}
        </ol>
      )}
      <form
        className="rule-add"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <label htmlFor={`${id}-rule`} className="sr-only">
          New rule
        </label>
        <input
          id={`${id}-rule`}
          value={text}
          maxLength={MAX_RULE}
          placeholder={full ? "You have the most rules a feed holds: remove one first" : "Add a rule, like \"Never push to main\""}
          disabled={full}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="primary small" disabled={feed.busy || full || !text.trim()}>
          Add
        </button>
      </form>
      {text.length > MAX_RULE - 40 && (
        <p className="muted small-text">
          {text.length} of {MAX_RULE} characters
        </p>
      )}
    </section>
  );
}

/** A rule your agent suggested: one tap adds it as your own, or dismisses it. */
export function RuleSuggestion({ proposal, feed }: { proposal: RuleProposalView; feed: Feed }) {
  return (
    <li className="rule-suggestion" aria-label={`Suggested rule: ${proposal.text}`}>
      <span className="rule-suggestion-head">Your agent suggests a rule</span>
      <strong>{proposal.text}</strong>
      {proposal.why && <span className="muted small-text">{proposal.why}</span>}
      <div className="actions">
        <button type="button" className="primary small" disabled={feed.busy} onClick={() => void feed.approveRule(proposal.id)}>
          Approve
        </button>
        <button type="button" className="ghost small" disabled={feed.busy} onClick={() => void feed.dismissRule(proposal.id)}>
          Dismiss
        </button>
      </div>
    </li>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  options: { id: T; label: string }[];
  disabled: boolean;
  onChange: (v: T) => void;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          className={value === o.id ? "on" : ""}
          disabled={disabled}
          onClick={() => value !== o.id && onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const LENS_STATUS: Record<string, { label: string; tone: string }> = {
  proposed: { label: "Waiting for you", tone: "pill-wait" },
  approved: { label: "In use", tone: "pill-good" },
  rejected: { label: "Turned down", tone: "" },
};

/** One app version's lens: what it records, a preview on recent events, and your decision. */
function LensRow({ lens, feed, preview }: { lens: LensView; feed: Feed; preview?: Preview }) {
  const look = appLook(lens.app);
  const status = LENS_STATUS[lens.status] ?? { label: lens.status, tone: "" };
  const [rows, setRows] = useState<PreviewRow[] | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const events = useMemo(() => {
    try {
      const spec = JSON.parse(lens.spec) as { events?: Record<string, { type?: string } | string> };
      return Object.entries(spec.events ?? {}).map(([kind, e]) => [kind, typeof e === "string" ? e : (e.type ?? "?")] as const);
    } catch {
      return [];
    }
  }, [lens.spec]);
  const read = events.filter(([, t]) => t !== "ignore");
  const ignored = events.length - read.length;
  const runPreview = async () => {
    if (!preview) return;
    setPreviewing(true);
    try {
      setRows(await preview(lens));
    } finally {
      setPreviewing(false);
    }
  };
  return (
    <li className="lens">
      <div className="lens-head">
        <Badge app={lens.app} size="sm" />
        <strong>{look.name}</strong>
        <span className="muted mono" title={lens.application_id}>
          {lens.application_id.slice(0, 8)}
        </span>
        <span className={`pill ${status.tone}`}>{status.label}</span>
      </div>
      <p>{lens.summary}</p>
      <p className="muted small-text">
        {read.map(([kind, type]) => `${kind} → ${TYPE_LABELS[type] ?? type}`).join(" · ")}
        {ignored > 0 && ` · ${ignored} other event${ignored === 1 ? "" : "s"} ignored`}
      </p>
      <div className="actions">
        {lens.status !== "approved" && (
          <button
            type="button"
            className="primary small"
            disabled={feed.busy}
            onClick={() => void feed.decideLens(lens.app, lens.application_id, "approve")}
          >
            Approve
          </button>
        )}
        {lens.status !== "rejected" && (
          <button
            type="button"
            className="ghost small"
            disabled={feed.busy}
            onClick={() => void feed.decideLens(lens.app, lens.application_id, "reject")}
          >
            {lens.status === "approved" ? "Stop using it" : "Turn down"}
          </button>
        )}
        {preview && (
          <button type="button" className="link small" disabled={previewing} onClick={() => void runPreview()}>
            {previewing ? "Running…" : "Preview on recent events"}
          </button>
        )}
      </div>
      {rows && (
        <ol className="lens-preview" aria-label={`What the ${look.name} lens would do`}>
          {rows.length === 0 && <li className="muted">No events from {look.name} since the feed opened.</li>}
          {rows.map((r, i) => (
            <li key={i} className={`preview-${r.outcome.kind}`}>
              <span className="mono">{r.kind}</span>{" "}
              {r.outcome.kind === "recorded"
                ? `→ ${TYPE_LABELS[r.outcome.reading.item_type] ?? r.outcome.reading.item_type}: ${r.outcome.reading.title}${
                    r.outcome.reading.from ? ` · ${r.outcome.reading.from}` : ""
                  }${r.outcome.reading.body ? ` · "${r.outcome.reading.body.slice(0, 80)}"` : ""}`
                : r.outcome.kind === "skipped"
                  ? `· not recorded (${r.outcome.why})`
                  : `· failed: ${r.outcome.why}`}
            </li>
          ))}
        </ol>
      )}
      <details>
        <summary className="small-text">The lens itself</summary>
        <pre className="lens-spec">{pretty(lens.spec)}</pre>
      </details>
    </li>
  );
}

function pretty(spec: string): string {
  try {
    return JSON.stringify(JSON.parse(spec), null, 2);
  } catch {
    return spec;
  }
}
