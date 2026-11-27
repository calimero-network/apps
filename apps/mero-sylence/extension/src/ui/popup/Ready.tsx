import { useState } from "react";
import { KEYS, type AuthState, type RecorderStatus, type Settings } from "../../lib/messages";
import { PLATFORM_NAMES, detectPlatform, isInCall, meetingTitle } from "../../lib/platform";
import { write } from "../../lib/storage";
import { TIERS, resolveTier } from "../../lib/tiers";
import { useCaps, useMicAllowed, type ActiveTab } from "../hooks";
import { AlertIcon, ChevronRightIcon, ChipIcon, LockIcon, MicIcon, MicOffIcon, Spinner, VideoIcon } from "../icons";
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
  const shown = error ?? status.error;

  return (
    <main className="body">
      <section className="card stack" style={{ gap: 12 }} aria-label="This tab">
        <div className="tab-card">
          <span className="tile">
            <VideoIcon size={18} />
          </span>
          <span className="grow">
            <span className="strong truncate">{recordable ? meetingTitle(tab?.title, platform) : "Nothing to record here"}</span>
            <span className="small muted truncate">
              {inCall
                ? `${PLATFORM_NAMES[platform]} · in a call`
                : platform !== "other"
                  ? `${PLATFORM_NAMES[platform]} · join the call, then record`
                  : recordable
                    ? "Not a meeting tab — you can still record it"
                    : "Open your call's tab, then open Sylence"}
            </span>
          </span>
        </div>
        <button className="btn primary block lg" onClick={start} disabled={!recordable || busy}>
          {busy ? <Spinner size={14} /> : <span className="dot" aria-hidden="true" />}
          {busy ? "Starting…" : inCall || platform !== "other" ? "Record meeting" : "Record this tab"}
        </button>
      </section>

      <div className="hstack">
        <button
          className="chip"
          aria-pressed={settings.mic}
          onClick={() => void save({ mic: !settings.mic })}
          title={settings.mic ? "Your microphone is transcribed as “You”" : "Only the call is transcribed"}
        >
          {settings.mic ? <MicIcon size={14} /> : <MicOffIcon size={14} />}
          <span>{settings.mic ? "Mic on" : "Mic off"}</span>
        </button>
        <button className="chip grow" style={{ flex: "0 1 auto" }} onClick={() => setSheet(true)} aria-label="Speech model">
          <ChipIcon size={14} />
          <span>
            {settings.tier === "auto" ? "Auto · " : ""}
            {tier ? TIERS[tier].name : "Checking this laptop…"}
          </span>
        </button>
      </div>

      {settings.mic && micAllowed === false && (
        <div className="banner">
          <MicIcon size={14} />
          <span className="grow">Allow the microphone once so your side of the call is transcribed.</span>
          <button className="btn link" onClick={allowMic}>
            Allow
          </button>
        </div>
      )}
      {shown && (
        <div className="banner bad" role="alert">
          <AlertIcon size={14} />
          <span className="grow">{shown}</span>
          {status.error && !error && (
            <button className="btn link" onClick={() => void ask({ type: "dismiss" })}>
              Dismiss
            </button>
          )}
        </div>
      )}

      <div className="stack" style={{ marginTop: "auto", gap: 12 }}>
        <button className="row card" style={{ padding: "8px 12px" }} onClick={onWorkspaces} aria-label="Change workspace">
          <span className="grow">
            <span className="label">Saving to</span>
            <span className="name">{auth.workspace?.name}</span>
          </span>
          <ChevronRightIcon size={16} className="chev" />
        </button>
        <p className="foot">
          <LockIcon size={13} />
          <span>Transcribed on this laptop. Audio is never uploaded.</span>
        </p>
      </div>
    </main>
  );
}
