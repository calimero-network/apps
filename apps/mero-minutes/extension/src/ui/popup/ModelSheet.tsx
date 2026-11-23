import { ArrowLeft, Download } from "@calimero-network/mero-icons";
import { sizeLabel } from "../../lib/format";
import { KEYS, type RecorderStatus, type Settings } from "../../lib/messages";
import { write } from "../../lib/storage";
import { LANGUAGES, TIERS, TIER_ORDER, pickTier, tierFits, type Capabilities, type TierId } from "../../lib/tiers";
import { CheckIcon } from "../icons";
import { ask } from "../rpc";

export function ModelSheet({
  settings,
  caps,
  status,
  onBack,
}: {
  settings: Settings;
  caps: Capabilities | null;
  status: RecorderStatus;
  onBack: () => void;
}) {
  const save = (s: Partial<Settings>) => write("local", KEYS.settings, { ...settings, ...s });
  const auto = caps ? pickTier(caps, settings.language) : null;
  const choose = (tier: TierId | "auto") => void save({ tier });
  const selected = settings.tier === "auto" ? auto : settings.tier;
  const loading = status.phase === "idle" && status.model;

  return (
    <main className="body sheet">
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <button className="icon-btn" aria-label="Back" onClick={onBack}>
          <ArrowLeft width={18} height={18} />
        </button>
        <h1 className="title" style={{ fontSize: 17 }}>
          Speech model
        </h1>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        Runs on this laptop. The model downloads once and stays in your browser; your audio never leaves the device.
      </p>

      <div className="field">
        <label htmlFor="language">Spoken language</label>
        <select
          id="language"
          className="select"
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

      <div className="list" role="radiogroup" aria-label="Speech model">
        <button className="row tier" role="radio" aria-checked={settings.tier === "auto"} onClick={() => choose("auto")}>
          <span className="grow">
            <span className="name">Automatic</span>
            <span className="blurb" style={{ display: "block" }}>
              {auto ? `${TIERS[auto].name} on this laptop` : "Picks the best model this laptop runs well"}
            </span>
          </span>
          <span className="tick">{settings.tier === "auto" ? <CheckIcon /> : null}</span>
        </button>
        {TIER_ORDER.map((id) => {
          const t = TIERS[id];
          const fits = caps ? tierFits(id, caps, settings.language) : true;
          return (
            <button
              key={id}
              className="row tier"
              role="radio"
              aria-checked={settings.tier === id}
              aria-disabled={!fits}
              disabled={!fits}
              onClick={() => choose(id)}
            >
              <span className="grow">
                <span className="name">
                  {t.name}
                  {id === "best" ? " · the standard" : ""}
                </span>
                <span className="blurb" style={{ display: "block" }}>
                  {fits ? t.blurb : t.device === "webgpu" ? "Needs WebGPU, which this browser doesn't offer." : "English only."}
                </span>
              </span>
              <span className="size">{sizeLabel(t.sizeMb)}</span>
              <span className="tick">{settings.tier === id ? <CheckIcon /> : null}</span>
            </button>
          );
        })}
      </div>

      {selected && (
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {loading && status.model ? (
            <>
              <span className="small">
                Downloading {TIERS[status.tier ?? selected].name}… {Math.round(status.model.fraction * 100)}%
              </span>
              <div className="progress" role="progressbar" aria-valuenow={Math.round(status.model.fraction * 100)}>
                <span style={{ width: `${status.model.fraction * 100}%` }} />
              </div>
            </>
          ) : (
            <button className="btn block" onClick={() => void ask({ type: "preload", tier: selected })}>
              <Download width={16} height={16} /> Download {TIERS[selected].name} now ({sizeLabel(TIERS[selected].sizeMb)})
            </button>
          )}
        </div>
      )}
    </main>
  );
}
