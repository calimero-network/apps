import { useMemo, useState } from "react";
import type { AgentMode, NotificationMode } from "./backend";
import type { Feed } from "./useFeed";
import { Badge } from "./FeedView";
import { DEFAULT_APPS, appLook } from "./apps";
import { GUARD_LABELS, TYPE_LABELS } from "./format";
import type { LensView } from "./generated/HyperfeedClient";
import type { Preview, PreviewRow } from "./preview";

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

export function ControlsView({ feed, contextId, preview }: { feed: Feed; contextId: string | null; preview?: Preview }) {
  const { settings, page } = feed;
  // What a control was just set to, shown until the contract's answer is read
  // back. Without it a checkbox snaps back to its old state for the length of
  // the round trip, which reads as the click not having worked.
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

  // Every app with a policy, every app in the feed, and the usual ones.
  const apps = useMemo(() => {
    const keys = new Set(DEFAULT_APPS);
    for (const p of settings?.policies ?? []) keys.add(p.app);
    for (const a of page?.apps ?? []) keys.add(a.app);
    return [...keys];
  }, [settings, page]);

  if (!settings) return <div className="empty">Loading your rules…</div>;

  const policyOf = (app: string) => {
    const stored = settings.policies.find((p) => p.app === app) ?? { app, agent: "ask", notifications: "feed" };
    return {
      agent: String(pending[`agent:${app}`] ?? stored.agent) as AgentMode,
      notifications: String(pending[`notifications:${app}`] ?? stored.notifications) as NotificationMode,
    };
  };

  return (
    <div className="controls">
      {feed.error && (
        <div className="error" role="alert">
          <span>{feed.error}</span>
          <button type="button" className="ghost small" onClick={feed.dismissError}>
            Dismiss
          </button>
        </div>
      )}
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

        <section className="panel" aria-labelledby="h-agent">
          <h2 id="h-agent">Connect your agent</h2>
          <p className="muted">
            Run <strong>mero-bot</strong> on the machine with this node: it finds this feed by itself, checks every
            call it makes against these rules, logs what it does here, and carries out what you approve or answer.
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
      <section className="panel full" aria-labelledby="h-lenses">
        <h2 id="h-lenses">What your feed reads from each app</h2>
        <p className="muted">
          Your agent reads each app's ABI and writes a lens: which events matter to you, what kind of item each
          becomes, and how your answer goes back. Nothing is recorded from an app until you approve its lens, and a
          new app version is learned again.
        </p>
        {feed.lenses.length === 0 ? (
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
