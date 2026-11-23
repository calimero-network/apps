import { useState } from "react";
import { Settings as SettingsGlyph } from "@calimero-network/mero-icons";
import { DEFAULT_SETTINGS, IDLE, KEYS, type AuthState, type RecorderStatus, type Settings } from "../../lib/messages";
import { useActiveTab, useStored } from "../hooks";
import { Mark, Spinner } from "../icons";
import { Ready } from "./Ready";
import { Recording } from "./Recording";
import { Saved } from "./Saved";
import { SettingsView } from "./SettingsView";
import { SignedOut } from "./SignedOut";
import { Workspaces } from "./Workspaces";

export function App() {
  const auth = useStored<AuthState>("local", KEYS.auth);
  const stored = useStored<Settings>("local", KEYS.settings);
  const status = useStored<RecorderStatus>("session", KEYS.status);
  const tab = useActiveTab();
  const [view, setView] = useState<"main" | "settings" | "workspaces">("main");

  if (auth === undefined || status === undefined || stored === undefined || tab === undefined) {
    return (
      <div className="shell" aria-busy="true">
        <div className="hero">
          <Spinner size={20} />
        </div>
      </div>
    );
  }
  const settings = { ...DEFAULT_SETTINGS, ...stored };
  const s = status ?? IDLE;
  const busy = s.phase === "starting" || s.phase === "loading-model" || s.phase === "recording" || s.phase === "stopping";

  let content;
  if (view === "settings") {
    content = <SettingsView auth={auth} settings={settings} onBack={() => setView("main")} />;
  } else if (!auth) {
    content = <SignedOut settings={settings} />;
  } else if (busy) {
    content = <Recording status={s} tabId={tab?.id ?? null} />;
  } else if (s.phase === "saved") {
    content = <Saved status={s} />;
  } else if (!auth.workspace || view === "workspaces") {
    content = <Workspaces auth={auth} onDone={() => setView("main")} />;
  } else {
    content = <Ready auth={auth} settings={settings} status={s} tab={tab} onWorkspaces={() => setView("workspaces")} />;
  }

  return (
    <div className="shell">
      <header className="top">
        <Mark size={26} />
        <span className="brand">Minutes</span>
        <span className="spacer" />
        {view !== "settings" && (
          <button className="icon-btn" aria-label="Settings" title="Settings" onClick={() => setView("settings")}>
            <SettingsGlyph width={18} height={18} />
          </button>
        )}
      </header>
      {content}
    </div>
  );
}
