import { useMemo } from "react";
import type { AgentMode, NotificationMode } from "./backend";
import type { Feed } from "./useFeed";
import { Badge } from "./FeedView";
import { DEFAULT_APPS, appLook } from "./apps";
import { GUARD_LABELS } from "./format";

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

export function ControlsView({ feed, contextId }: { feed: Feed; contextId: string | null }) {
  const { settings, page } = feed;

  // Every app with a policy, every app in the feed, and the usual ones.
  const apps = useMemo(() => {
    const keys = new Set(DEFAULT_APPS);
    for (const p of settings?.policies ?? []) keys.add(p.app);
    for (const a of page?.apps ?? []) keys.add(a.app);
    return [...keys];
  }, [settings, page]);

  if (!settings) return <div className="empty">Loading your rules…</div>;

  const policyOf = (app: string) =>
    settings.policies.find((p) => p.app === app) ?? { app, agent: "ask", notifications: "feed" };

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
                          void feed.setPolicy(app, agent, policy.notifications as NotificationMode)
                        }
                      />
                    </td>
                    <td>
                      <Segmented
                        label={`Notifications from ${look.name}`}
                        value={policy.notifications}
                        options={NOTIFICATION_OPTIONS}
                        disabled={feed.busy}
                        onChange={(n) => void feed.setPolicy(app, policy.agent as AgentMode, n)}
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
          {settings.guards.map((g) => (
            <label key={g.category} className="check">
              <input
                type="checkbox"
                checked={g.on}
                disabled={feed.busy}
                onChange={() => void feed.setGuard(g.category, !g.on)}
              />
              <span>{GUARD_LABELS[g.category] ?? g.category}</span>
            </label>
          ))}
        </section>

        <section className="panel" aria-labelledby="h-agent">
          <h2 id="h-agent">Connect your agent</h2>
          <p className="muted">
            Your agent writes to this feed as you, through the same warrant path it uses everywhere else. Before
            acting it calls <code>check_action</code>; it records with <code>record_action</code> and reports
            back after your decision with <code>complete_action</code>.
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
