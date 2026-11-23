import { ExternalLink } from "@calimero-network/mero-icons";
import type { RecorderStatus } from "../../lib/messages";
import { CheckIcon } from "../icons";
import { ask } from "../rpc";

export function Saved({ status }: { status: RecorderStatus }) {
  const open = () => {
    if (status.link) void chrome.tabs.create({ url: status.link });
  };
  return (
    <main className="body">
      <div className="hero">
        <span
          style={{
            display: "grid",
            placeItems: "center",
            width: 52,
            height: 52,
            borderRadius: 16,
            background: "var(--glass-good-bg)",
            color: "var(--glass-good-ink)",
          }}
        >
          <CheckIcon size={26} />
        </span>
        <div>
          <h1 className="title">Meeting saved</h1>
          <p className="subtitle">{status.meeting?.title}</p>
        </div>
      </div>
      {status.error && <div className="banner bad">{status.error}</div>}
      {status.uploadError && <div className="banner wait">{status.uploadError}</div>}
      <button className="btn primary block big" onClick={open} disabled={!status.link}>
        Open in Minutes <ExternalLink width={16} height={16} />
      </button>
      <button className="btn block" onClick={() => void ask({ type: "dismiss" })}>
        Done
      </button>
    </main>
  );
}
