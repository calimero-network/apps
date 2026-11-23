import { useState } from "react";
import { ArrowLeft } from "@calimero-network/mero-icons";
import { validOverride } from "../../lib/format";
import { KEYS, type AuthState, type Settings } from "../../lib/messages";
import { write } from "../../lib/storage";
import { LANGUAGES, TIERS, TIER_ORDER, type TierId } from "../../lib/tiers";
import { SignOutIcon } from "../icons";
import { ask } from "../rpc";

export function SettingsView({ auth, settings, onBack }: { auth: AuthState | null; settings: Settings; onBack: () => void }) {
  const save = (s: Partial<Settings>) => write("local", KEYS.settings, { ...settings, ...s });
  const [override, setOverride] = useState(settings.pageOverride);
  const [advanced, setAdvanced] = useState(!!settings.pageOverride);
  const overrideOk = validOverride(override);

  return (
    <main className="body">
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <button className="icon-btn" aria-label="Back" onClick={onBack}>
          <ArrowLeft width={18} height={18} />
        </button>
        <h1 className="title" style={{ fontSize: 17 }}>
          Settings
        </h1>
      </div>

      <div className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="field">
          <label htmlFor="model">Speech model</label>
          <select
            id="model"
            className="select"
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
        <div className="field">
          <label htmlFor="lang">Spoken language</label>
          <select id="lang" className="select" value={settings.language} onChange={(e) => void save({ language: e.target.value })}>
            {LANGUAGES.map((l) => (
              <option key={l.code || "auto"} value={l.code}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ flex: 1 }}>
            <span style={{ fontWeight: 600, display: "block" }}>Transcribe my microphone</span>
            <span className="small muted">Your words are labelled “You”.</span>
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
        <div className="card" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span className="small muted" style={{ display: "block" }}>
              Signed in
            </span>
            <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", display: "block" }} title={auth.accountId}>
              {auth.accountId.length > 22 ? `${auth.accountId.slice(0, 10)}…${auth.accountId.slice(-8)}` : auth.accountId}
            </span>
          </span>
          <button className="btn" onClick={() => void ask({ type: "signOut" })}>
            <SignOutIcon size={16} /> Sign out
          </button>
        </div>
      )}

      <button className="btn link" style={{ alignSelf: "flex-start" }} onClick={() => setAdvanced(!advanced)} aria-expanded={advanced}>
        {advanced ? "Hide advanced" : "Advanced"}
      </button>
      {advanced && (
        <div className="card field">
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
              ? "For development: a Minutes page such as http://localhost:5173 (pnpm dev:local mero-minutes). Sign in again after changing it."
              : "Use an https:// address, or http://localhost."}
          </span>
        </div>
      )}
    </main>
  );
}
