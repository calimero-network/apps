import { useState } from "react";
import { readLog } from "../../lib/diagnostics";
import { validOverride } from "../../lib/format";
import { KEYS, type AuthState, type Settings } from "../../lib/messages";
import { write } from "../../lib/storage";
import { LANGUAGES, TIERS, TIER_ORDER, type TierId } from "../../lib/tiers";
import { BackIcon, ChevronRightIcon, SignOutIcon } from "../icons";
import { ask } from "../rpc";

export function SettingsView({ auth, settings, onBack }: { auth: AuthState | null; settings: Settings; onBack: () => void }) {
  const save = (s: Partial<Settings>) => write("local", KEYS.settings, { ...settings, ...s });
  const [override, setOverride] = useState(settings.pageOverride);
  const [advanced, setAdvanced] = useState(!!settings.pageOverride);
  const overrideOk = validOverride(override);

  return (
    <main className="body">
      <div className="hstack" style={{ marginLeft: -6 }}>
        <button className="icon-btn" aria-label="Back" onClick={onBack}>
          <BackIcon size={16} />
        </button>
        <h1 className="title" style={{ fontSize: 15 }}>
          Settings
        </h1>
      </div>

      <div className="list">
        <div className="row" style={{ cursor: "default" }}>
          <label className="grow strong" htmlFor="model">
            Speech model
          </label>
          <select
            id="model"
            className="select"
            style={{ width: 168 }}
            value={settings.tier}
            onChange={(e) => void save({ tier: e.target.value as TierId | "auto" })}
          >
            <option value="auto">Automatic</option>
            {TIER_ORDER.map((id) => (
              <option key={id} value={id}>
                {TIERS[id].name}
              </option>
            ))}
          </select>
        </div>
        <div className="row" style={{ cursor: "default" }}>
          <label className="grow strong" htmlFor="lang">
            Spoken language
          </label>
          <select
            id="lang"
            className="select"
            style={{ width: 168 }}
            value={settings.language}
            onChange={(e) => void save({ language: e.target.value })}
          >
            {LANGUAGES.map((l) => (
              <option key={l.code || "auto"} value={l.code}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
        <div className="row" style={{ cursor: "default" }}>
          <span className="grow">
            <span className="name">Transcribe my microphone</span>
            <span className="meta">Your words are labelled “You”.</span>
          </span>
          <button
            className="switch"
            role="switch"
            aria-checked={settings.mic}
            aria-label="Transcribe my microphone"
            onClick={() => void save({ mic: !settings.mic })}
          />
        </div>
      </div>

      {auth && (
        <div className="list">
          <div className="row" style={{ cursor: "default" }}>
            <span className="grow">
              <span className="meta" style={{ marginTop: 0 }}>
                Signed in as
              </span>
              <span className="name" title={auth.accountId}>
                {auth.accountId.length > 22 ? `${auth.accountId.slice(0, 10)}…${auth.accountId.slice(-8)}` : auth.accountId}
              </span>
            </span>
            <button className="btn sm" onClick={() => void ask({ type: "signOut" })}>
              <SignOutIcon size={13} /> Sign out
            </button>
          </div>
        </div>
      )}

      <button
        className="btn ghost sm"
        style={{ alignSelf: "flex-start", marginLeft: -4 }}
        onClick={() => setAdvanced(!advanced)}
        aria-expanded={advanced}
      >
        <ChevronRightIcon size={13} style={{ transform: advanced ? "rotate(90deg)" : "none", transition: "transform 150ms" }} />
        {advanced ? "Hide advanced" : "Advanced"}
      </button>
      {advanced && (
        <div className="card stack" style={{ gap: 16 }}>
          <div className="field">
            <label htmlFor="override">Sign-in page</label>
            <input
              id="override"
              className="input"
              placeholder="Calimero Cloud (default)"
              value={override}
              onChange={(e) => setOverride(e.target.value)}
              onBlur={() => {
                if (overrideOk) void save({ pageOverride: override.trim() });
              }}
              aria-invalid={!overrideOk}
            />
            <span className="small muted">
              {overrideOk
                ? "For development, e.g. http://localhost:5173. Sign in again after changing it."
                : "Use an https:// address, or http://localhost."}
            </span>
          </div>
          <hr className="divider" />
          <Diagnostics />
        </div>
      )}
    </main>
  );
}

/** Copies the recorder's log (steps, models, errors; no transcript or session) for a bug report. */
function Diagnostics() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async () => {
    const lines = await readLog();
    const text = [`Minutes ${chrome.runtime.getManifest().version} on ${navigator.userAgent}`, ...lines].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(lines.length ? `Copied ${lines.length} lines.` : "Nothing logged yet in this browser session.");
    } catch {
      setCopied("Could not copy. Open the service worker's console instead.");
    }
  };
  return (
    <div className="field">
      <span className="field-label">Diagnostics</span>
      <span className="small muted">
        {copied ?? "Steps, models and errors from this browser session. No transcript text or sign-in data."}
      </span>
      <button className="btn sm" style={{ alignSelf: "flex-start" }} onClick={() => void copy()}>
        Copy diagnostics
      </button>
    </div>
  );
}
