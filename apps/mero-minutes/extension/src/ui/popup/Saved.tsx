import type { RecorderStatus } from "../../lib/messages";
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
