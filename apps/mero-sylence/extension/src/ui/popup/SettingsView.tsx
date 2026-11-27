import { useState } from "react";
import { readLog } from "../../lib/diagnostics";
import { validOverride } from "../../lib/format";
import { KEYS, type AuthState, type Settings } from "../../lib/messages";
import { write } from "../../lib/storage";
import { LANGUAGES, TIERS, TIER_ORDER, canImproveAfterCall, tierBlock, type TierId } from "../../lib/tiers";
import { useCaps } from "../hooks";
import { NotesSettings } from "./NotesSettings";
import { BackIcon, SignOutIcon } from "../icons";
import { ask } from "../rpc";

export function SettingsView({ auth, settings, onBack }: { auth: AuthState | null; settings: Settings; onBack: () => void }) {
  const caps = useCaps();
  const save = (s: Partial<Settings>) => write("local", KEYS.settings, { ...settings, ...s });
  const [override, setOverride] = useState(settings.pageOverride);
  const developer = settings.developer ?? !!settings.pageOverride;
  const overrideOk = validOverride(override);
  // The second pass runs the 1.5 GB model: only where it is allowed and already downloaded.
  const improveOk = canImproveAfterCall(caps);
  const improveWhy = !caps
    ? "Checking this laptop…"
    : tierBlock("best", caps)
      ? `Off on this laptop. ${tierBlock("best", caps)}`
      : "Unlocks once Whisper large-v3 turbo is downloaded (Speech model, on the record screen).";
  // Action items come from the transcript, so a speech model must be on the laptop.
  const actionsOk = !!caps?.cached?.length;

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
            <span className="meta">Your words are labelled with your name, or “You”.</span>
          </span>
          <button
            className="switch"
            role="switch"
            aria-checked={settings.mic}
            aria-label="Transcribe my microphone"
            onClick={() => void save({ mic: !settings.mic })}
          />
        </div>
        <div className="row" style={{ cursor: "default" }}>
          <span className="grow">
            <span className="name">Speaker names</span>
            <span className="meta">Names each line after who was talking in Meet, Zoom or Teams.</span>
          </span>
          <button
            className="switch"
            role="switch"
            aria-checked={settings.speakerNames}
            aria-label="Speaker names"
            onClick={() => void save({ speakerNames: !settings.speakerNames })}
          />
        </div>
        <div className="row" style={{ cursor: "default" }}>
          <span className="grow">
            <span className="name">Tell the call it’s recorded</span>
            <span className="meta">Posts a short note in the Meet, Zoom or Teams chat when you start recording.</span>
          </span>
          <button
            className="switch"
            role="switch"
            aria-checked={settings.announceRecording}
            aria-label="Tell the call it’s recorded"
            onClick={() => void save({ announceRecording: !settings.announceRecording })}
          />
        </div>
        <div className="row" style={{ cursor: "default" }}>
          <span className="grow">
            <span className="name">Improve the transcript after the call</span>
            <span className="meta">
              {improveOk
                ? "When you stop, Whisper large-v3 turbo goes over the whole recording again and replaces the live lines. The audio stays on this laptop and is deleted after."
                : improveWhy}
            </span>
          </span>
          <button
            className="switch"
            role="switch"
            aria-checked={improveOk && settings.improveAfterCall}
            aria-label="Improve the transcript after the call"
            disabled={!improveOk}
            onClick={() => void save({ improveAfterCall: !settings.improveAfterCall })}
          />
        </div>
        <div className="row" style={{ cursor: "default" }}>
          <span className="grow">
            <span className="name">Find action items</span>
            <span className="meta">
              {actionsOk
                ? "From phrases like “I’ll…”, “can you…”, “we need to…”, added when the meeting ends. Smart notes (Experimental) finds more. Off here, you can still find them later on the meeting's page."
                : "Unlocks once a speech model is downloaded. You can also find them later on the meeting's page."}
            </span>
          </span>
          <button
            className="switch"
            role="switch"
            aria-checked={actionsOk && settings.autoActions}
            aria-label="Find action items"
            disabled={!actionsOk}
            onClick={() => void save({ autoActions: !settings.autoActions })}
          />
        </div>
      </div>

      <NotesSettings settings={settings} caps={caps} />

      {developer && (
        <div className="card stack" style={{ gap: 16 }} data-testid="developer">
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

      {auth && (
        <button className="btn block lg" style={{ marginTop: "auto" }} onClick={() => void ask({ type: "signOut" })}>
          <SignOutIcon size={14} /> Log out
        </button>
      )}
      <label className="dev-toggle">
        <span>Developer mode</span>
        <button
          className="switch sm"
          role="switch"
          aria-checked={developer}
          aria-label="Developer mode"
          onClick={() => void save({ developer: !developer, ...(developer ? { pageOverride: "" } : {}) })}
        />
      </label>
    </main>
  );
}

/** Copies the recorder's log (steps, models, errors; no transcript or session) for a bug report. */
function Diagnostics() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async () => {
    const lines = await readLog();
    const text = [`Sylence ${chrome.runtime.getManifest().version} on ${navigator.userAgent}`, ...lines].join("\n");
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
