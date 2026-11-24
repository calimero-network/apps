import type { RecorderStatus } from "../../lib/messages";
import { NOTES_MODELS } from "../../lib/notes";
import { AlertIcon, CheckIcon, ExternalIcon } from "../icons";
import { ask } from "../rpc";

export function Saved({ status }: { status: RecorderStatus }) {
  const open = () => {
    if (status.link) void chrome.tabs.create({ url: status.link });
  };
  return (
    <main className="body">
      <div className="hero" style={{ padding: "32px 8px 8px" }}>
        <span className="tile lg">
          <CheckIcon size={22} />
        </span>
        <div>
          <h1 className="title">Meeting saved</h1>
          <p className="subtitle">{status.meeting?.title}</p>
        </div>
      </div>
      {((status.actions !== undefined && status.actions > 0) || status.wroteSummary) && (
        <div className="banner">
          <CheckIcon size={14} />
          <span className="grow">
            {savedNote(status.actions ?? 0, !!status.wroteSummary)}
          </span>
        </div>
      )}
      {status.notesBy && (
        <p className="by-line" data-testid="notes-by">
          {status.notesBy.kind === "model"
            ? `Written by ${NOTES_MODELS[status.notesBy.model].name} on this laptop.`
            : `Found from phrases said in the call. ${status.notesBy.why}`}
        </p>
      )}
      {status.error && (
        <div className="banner bad">
          <AlertIcon size={14} />
          <span className="grow">{status.error}</span>
        </div>
      )}
      {status.uploadError && <div className="banner">{status.uploadError}</div>}
      <div className="stack" style={{ marginTop: "auto" }}>
        <button className="btn primary block lg" onClick={open} disabled={!status.link}>
          Open in Minutes <ExternalIcon size={14} />
        </button>
        <button className="btn ghost block lg" onClick={() => void ask({ type: "dismiss" })}>
          Done
        </button>
      </div>
    </main>
  );
}

export function savedNote(actions: number, summary: boolean): string {
  const items = actions === 1 ? "1 action item" : `${actions} action items`;
  if (summary && actions > 0) return `A summary and ${items} added from the transcript.`;
  if (summary) return "A summary added from the transcript.";
  return `${items.charAt(0).toUpperCase()}${items.slice(1)} added from the transcript.`;
}
