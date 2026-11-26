import { sizeLabel } from "../../lib/format";
import { KEYS, type RecorderStatus, type Settings } from "../../lib/messages";
import { NOTES_MODELS, notesModelFor, type NotesModelId, type NotesSetting } from "../../lib/notes";
import { write } from "../../lib/storage";
import type { Capabilities } from "../../lib/tiers";
import { useStored } from "../hooks";
import { AlertIcon, CheckIcon, DownloadIcon } from "../icons";
import { ask } from "../rpc";

const CHOICES: { id: NotesSetting; name: string; meta: (caps: Capabilities | null) => string; size?: number }[] = [
  {
    id: "auto",
    name: "Automatic",
    meta: (caps) => {
      const m = caps ? notesModelFor("auto", caps) : null;
      return m ? `${NOTES_MODELS[m].name} on this laptop` : "The best model this laptop runs";
    },
  },
  { id: "better", name: NOTES_MODELS.better.name, meta: () => NOTES_MODELS.better.blurb, size: NOTES_MODELS.better.sizeMb },
  { id: "small", name: NOTES_MODELS.small.name, meta: () => NOTES_MODELS.small.blurb, size: NOTES_MODELS.small.sizeMb },
  { id: "off", name: "Off", meta: () => "Action items from phrases said in the call, no summary" },
];

/**
 * Smart notes: which model writes the summary and action items, whether this
 * browser can run one (WebGPU), and the one-time download.
 */
export function NotesSettings({ settings, caps }: { settings: Settings; caps: Capabilities | null }) {
  const status = useStored<RecorderStatus>("session", KEYS.status);
  const save = (s: Partial<Settings>) => write("local", KEYS.settings, { ...settings, ...s });
  const noGpu = caps !== null && !caps.webgpu;
  const model: NotesModelId | null = caps ? notesModelFor(settings.notesModel, caps) : null;
  const progress = status?.phase !== "notes" && status?.notes && status.notes.model === model ? status.notes : null;
  const downloaded = !!model && ((caps?.cachedNotes ?? []).includes(model) || (progress?.fraction ?? 0) >= 1);
  const downloading = !!progress && progress.fraction < 1;
  const disabled = !settings.autoActions;

  return (
    <section className="stack" aria-labelledby="notes-title" style={{ gap: 8 }}>
      <div className="section-head">
        <h2 id="notes-title" className="label">
          Smart notes
        </h2>
      </div>
      <p className="small muted" style={{ padding: "0 2px" }}>
        After each meeting a small AI model on this laptop writes the summary and action items. The transcript stays on
        the laptop.
      </p>

      {noGpu && (
        <div className="banner" role="status">
          <AlertIcon size={14} />
          <span className="grow">This browser doesn't offer WebGPU, so action items come from phrases said in the call.</span>
        </div>
      )}
      {disabled && (
        <div className="banner" role="status">
          <AlertIcon size={14} />
          <span className="grow">Turn on Find action items above to use Smart notes.</span>
        </div>
      )}

      <div className="list" role="radiogroup" aria-label="Smart notes model">
        {CHOICES.map((c) => {
          const unavailable = disabled || (noGpu && c.id !== "off");
          return (
            <button
              key={c.id}
              className="row tier"
              role="radio"
              aria-checked={settings.notesModel === c.id}
              aria-disabled={unavailable}
              disabled={unavailable}
              onClick={() => void save({ notesModel: c.id })}
            >
              <span className="grow">
                <span className="name">{c.name}</span>
                <span className="meta">{c.meta(caps)}</span>
              </span>
              {c.size !== undefined && <span className="end">{sizeLabel(c.size)}</span>}
              <span className="tick">{settings.notesModel === c.id ? <CheckIcon size={16} /> : null}</span>
            </button>
          );
        })}
      </div>

      {model && !disabled && (
        <div className="card notes-download" data-testid="notes-download">
          {downloaded ? (
            <span className="hstack small">
              <CheckIcon size={14} />
              <span className="grow">
                {NOTES_MODELS[model].name} is downloaded ({sizeLabel(NOTES_MODELS[model].sizeMb)})
              </span>
            </span>
          ) : downloading ? (
            <div className="stack" style={{ gap: 6 }}>
              <span className="small muted">
                Downloading {NOTES_MODELS[model].name} · {Math.round(progress.fraction * 100)}% of{" "}
                {sizeLabel(NOTES_MODELS[model].sizeMb)}
              </span>
              <div className="progress" role="progressbar" aria-valuenow={Math.round(progress.fraction * 100)} aria-label="Download">
                <span style={{ width: `${progress.fraction * 100}%` }} />
              </div>
            </div>
          ) : (
            <div className="hstack">
              <span className="grow small muted">
                Downloads once, the first time it is used, or now.
              </span>
              <button className="btn sm" onClick={() => void ask({ type: "preloadNotes", model })}>
                <DownloadIcon size={13} /> {sizeLabel(NOTES_MODELS[model].sizeMb)}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
