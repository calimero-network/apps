import { useEffect, useRef, useState } from "react";
import { DEFAULT_SETTINGS, IDLE, KEYS, type AuthState, type RecorderStatus, type Settings } from "../../lib/messages";
import { useActiveTab, useStored } from "../hooks";
import { GearIcon, Mark, Spinner } from "../icons";
import { ask } from "../rpc";
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
  const reason = useStored<string>("session", KEYS.signedOutReason);

  // Once per opening: is the account still there? (A wiped cluster or a
  // removed account signs the extension out instead of failing at Record.)
  const checked = useRef(false);
  const signedIn = !!auth;
  useEffect(() => {
    if (!signedIn || checked.current) return;
    checked.current = true;
    void ask({ type: "checkSession" }).catch(() => undefined);
  }, [signedIn]);

  if (auth === undefined || status === undefined || stored === undefined || tab === undefined) {
    return (
      <div className="shell" aria-busy="true">
        <div className="hero" style={{ margin: "auto" }}>
          <Spinner size={18} />
        </div>
      </div>
    );
  }
  const settings = { ...DEFAULT_SETTINGS, ...stored };
  const s = status ?? IDLE;
  const busy = s.phase === "starting" || s.phase === "loading-model" || s.phase === "recording" || s.phase === "stopping" || s.phase === "improving" || s.phase === "notes";

  let content;
  if (view === "settings") {
    content = <SettingsView auth={auth} settings={settings} onBack={() => setView("main")} />;
  } else if (!auth) {
    content = <SignedOut settings={settings} reason={reason ?? null} />;
  } else if (busy) {
    content = <Recording status={s} tabId={tab?.id ?? null} />;
  } else if (s.phase === "saved") {
    content = <Saved status={s} />;
  } else if (!auth.workspace || view === "workspaces") {
    content = <Workspaces auth={auth} onDone={() => setView("main")} canClose={!!auth.workspace} />;
  } else {
    content = <Ready auth={auth} settings={settings} status={s} tab={tab} onWorkspaces={() => setView("workspaces")} />;
  }

  return (
    <div className="shell">
      <header className="top">
        <Mark size={22} />
        <span className="brand">Sylence</span>
        <span className="spacer" />
        {view !== "settings" && (
          <button className="icon-btn" aria-label="Settings" title="Settings" onClick={() => setView("settings")}>
            <GearIcon size={16} />
          </button>
        )}
      </header>
      {content}
    </div>
  );
}
