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
    <main className="body" style={{ maxWidth: 420, margin: "12vh auto", gap: 18 }}>
      <div className="hero">
        <Mark size={56} />
        {state === "granted" ? (
          <>
            <span style={{ color: "var(--glass-good-ink)" }}>
              <CheckIcon size={28} />
            </span>
            <h1 className="title">Microphone allowed</h1>
            <p className="subtitle">You can close this tab and start recording from the Minutes button.</p>
            <button className="btn primary" onClick={() => window.close()}>
              Close
            </button>
          </>
        ) : (
          <>
            <h1 className="title">Let Minutes hear you</h1>
            <p className="subtitle">
              Minutes transcribes your microphone as “You”, on this laptop. Audio is never uploaded. Your browser will ask
              once.
            </p>
            <button className="btn primary big" onClick={() => void request()}>
              <MicIcon /> Allow microphone
            </button>
            {state === "denied" && (
              <div className="banner bad" role="alert">
                The microphone was blocked. Allow it in the address bar's site settings for Minutes, then try again.
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
