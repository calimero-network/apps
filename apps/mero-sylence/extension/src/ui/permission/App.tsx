import { useState } from "react";
import { KEYS } from "../../lib/messages";
import { write } from "../../lib/storage";
import { CheckIcon, Mark, MicIcon } from "../icons";

/**
 * The microphone prompt. The offscreen page can't ask for permission itself,
 * so the person grants it here once, for the extension.
 */
export function App() {
  const [state, setState] = useState<"ask" | "granted" | "denied">("ask");

  const request = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const t of stream.getTracks()) t.stop();
      await write("local", KEYS.micGranted, true);
      setState("granted");
    } catch {
      setState("denied");
    }
  };

  return (
    <main className="page">
      <div className="card">
        <Mark size={44} />
        {state === "granted" ? (
          <>
            <div>
              <h1 className="title hstack" style={{ justifyContent: "center" }}>
                <CheckIcon size={18} /> Microphone allowed
              </h1>
              <p className="subtitle">You can close this tab and start recording from the Sylence button.</p>
            </div>
            <button className="btn primary lg" onClick={() => window.close()}>
              Close
            </button>
          </>
        ) : (
          <>
            <div>
              <h1 className="title">Let Sylence hear you</h1>
              <p className="subtitle">
                Sylence transcribes your microphone as “You”, on this laptop. Audio is never uploaded. Your browser will
                ask once.
              </p>
            </div>
            <button className="btn primary lg" onClick={() => void request()}>
              <MicIcon size={15} /> Allow microphone
            </button>
            {state === "denied" && (
              <div className="banner bad" role="alert" style={{ textAlign: "left" }}>
                The microphone was blocked. Allow it in the address bar's site settings for Sylence, then try again.
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
