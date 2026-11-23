import { useState } from "react";
import { KEYS, type AuthState, type RecorderStatus, type Settings } from "../../lib/messages";
import { PLATFORM_NAMES, detectPlatform, isInCall, meetingTitle } from "../../lib/platform";
import { write } from "../../lib/storage";
import { TIERS, resolveTier } from "../../lib/tiers";
import { useCaps, useMicAllowed, type ActiveTab } from "../hooks";
import { ChevronRightIcon, ChipIcon, MicIcon, MicOffIcon, RecordIcon, Spinner, VideoIcon } from "../icons";
import { ask } from "../rpc";
import { ModelSheet } from "./ModelSheet";

export function Ready({
  auth,
  settings,
  status,
  tab,
  onWorkspaces,
}: {
  auth: AuthState;
  settings: Settings;
  status: RecorderStatus;
  tab: ActiveTab | null;
  onWorkspaces: () => void;
}) {
  const caps = useCaps();
  const micAllowed = useMicAllowed();
  const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (sheet) return <ModelSheet settings={settings} caps={caps} status={status} onBack={() => setSheet(false)} />;

  const platform = detectPlatform(tab?.url);
  const inCall = isInCall(tab?.url);
  const recordable = !!tab && /^https?:/.test(tab.url);
  const tier = caps ? resolveTier(settings.tier, caps, settings.language) : null;
  const save = (s: Partial<Settings>) => write("local", KEYS.settings, { ...settings, ...s });

  const start = async () => {
    if (!tab) return;
    setBusy(true);
    setError(null);
    try {
      await ask({ type: "start", tabId: tab.id });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const allowMic = () => void chrome.tabs.create({ url: chrome.runtime.getURL("permission.html") });

  return (
    <main className="body">
      <button className="row card" style={{ padding: "10px 14px" }} onClick={onWorkspaces} aria-label="Change workspace">
        <span className="grow">
          <span className="small muted">Saving to</span>
          <span className="name" style={{ display: "block" }}>
            {auth.workspace?.name}
          </span>
        </span>
        <ChevronRightIcon />
      </button>

      <section className="card tab-card" aria-label="This tab">
        <span className="badge">
          <VideoIcon size={20} />
        </span>
        <span className="meta">
          <span className="name" style={{ display: "block" }}>
            {recordable ? meetingTitle(tab?.title, platform) : "Nothing to record here"}
          </span>
          <span className="small muted">
            {inCall
              ? `${PLATFORM_NAMES[platform]} · in a call`
              : platform !== "other"
                ? `${PLATFORM_NAMES[platform]} · join the call, then record`
                : recordable
                  ? "Not a meeting tab — you can still record it"
                  : "Open your call's tab, then open Minutes"}
          </span>
        </span>
      </section>

      <button className="btn record block big" onClick={start} disabled={!recordable || busy}>
        {busy ? <Spinner /> : <RecordIcon />}
        {busy ? "Starting…" : inCall || platform !== "other" ? "Record meeting" : "Record this tab"}
      </button>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          className={`chip ${settings.mic ? "on" : ""}`}
          aria-pressed={settings.mic}
          onClick={() => void save({ mic: !settings.mic })}
          title={settings.mic ? "Your microphone is transcribed as “You”" : "Only the call is transcribed"}
        >
          {settings.mic ? <MicIcon size={15} /> : <MicOffIcon size={15} />}
          {settings.mic ? "Mic on" : "Mic off"}
        </button>
        <button className="chip on" onClick={() => setSheet(true)} aria-label="Speech model">
          <ChipIcon size={15} />
          {settings.tier === "auto" ? "Auto · " : ""}
          {tier ? TIERS[tier].name : "Checking this laptop…"}
        </button>
      </div>

      {settings.mic && micAllowed === false && (
        <div className="banner wait">
          <span className="grow">Allow Minutes to use your microphone once, so your side of the call is transcribed.</span>
          <button className="btn link" onClick={allowMic}>
            Allow
          </button>
        </div>
      )}
      {(error || status.error) && (
        <div className="banner bad" role="alert">
          <span className="grow">{error ?? status.error}</span>
          {status.error && !error && (
            <button className="btn link" onClick={() => void ask({ type: "dismiss" })}>
              Dismiss
            </button>
          )}
        </div>
      )}
    </main>
  );
}
