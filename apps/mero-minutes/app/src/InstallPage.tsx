import { useState } from "react";
import { Icon } from "./ui";

/** Served beside the page by `extensionDownload.ts`. */
export const EXTENSION_ZIP = "./minutes-extension.zip";
export const EXTENSION_VERSION = typeof __EXTENSION_VERSION__ === "string" ? __EXTENSION_VERSION__ : "";

/** Which browser this is, for the extensions page address. Brave says so only through `navigator.brave`. */
export function browserName(nav: Navigator = navigator): "brave" | "edge" | "chrome" | "other" {
  if ((nav as Navigator & { brave?: unknown }).brave) return "brave";
  const ua = nav.userAgent;
  if (/Edg\//.test(ua)) return "edge";
  if (/Chrome\//.test(ua)) return "chrome";
  return "other";
}

export function extensionsPage(browser: ReturnType<typeof browserName>): string {
  return browser === "brave" ? "brave://extensions" : browser === "edge" ? "edge://extensions" : "chrome://extensions";
}

/**
 * Download and install the extension. Until it is in the Chrome Web Store it
 * installs as an unpacked extension: download, unzip, Developer mode, Load
 * unpacked. A browser does not let a page open `chrome://` addresses, so the
 * address is offered to copy.
 */
export function InstallPage({ onBack, backLabel = "Back" }: { onBack?: () => void; backLabel?: string }) {
  const browser = browserName();
  const page = extensionsPage(browser);
  const [copied, setCopied] = useState(false);
  const supported = browser !== "other";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(page);
      setCopied(true);
      setTimeout(() => setCopied(false), 1_600);
    } catch {
      /* the address is on screen to type */
    }
  };

  return (
    <section className="install" aria-labelledby="install-title" data-testid="install-page">
      {onBack && (
        <button type="button" className="btn ghost back" onClick={onBack}>
          <Icon name="left" /> {backLabel}
        </button>
      )}
      <div className="install-head">
        <div className="hero-mark" aria-hidden="true">
          <Icon name="puzzle" size={22} />
        </div>
        <h1 id="install-title">Install Minutes for Chrome and Brave</h1>
        <p className="lede">
          The extension records the call in your browser tab and turns speech into text on your laptop. No bot joins
          the call and the audio never leaves your machine.
        </p>
        <div className="row install-cta">
          <a className="btn primary large" href={EXTENSION_ZIP} download="minutes-extension.zip" data-testid="download-extension">
            <Icon name="download" /> Download the extension
          </a>
        </div>
        <p className="dim">
          {EXTENSION_VERSION ? `Version ${EXTENSION_VERSION} · ` : ""}Chrome, Brave or Edge on a desktop
          {!supported && " · this browser can't run it"}
        </p>
      </div>

      <ol className="install-steps">
        <li>
          <span className="step-n">1</span>
          <div>
            <strong>Unzip the download.</strong>
            <p className="dim">You get a folder named <code>minutes</code>. Keep it somewhere it can stay, such as Documents.</p>
          </div>
        </li>
        <li>
          <span className="step-n">2</span>
          <div>
            <strong>Open your browser's extensions page.</strong>
            <p className="dim">Paste this address into a new tab:</p>
            <div className="copy-field">
              <code data-testid="extensions-address">{page}</code>
              <button type="button" className="btn small" onClick={() => void copy()}>
                <Icon name={copied ? "check" : "copy"} size={14} /> {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
        </li>
        <li>
          <span className="step-n">3</span>
          <div>
            <strong>Turn on Developer mode</strong>
            <p className="dim">The switch is at the top right of the extensions page.</p>
          </div>
        </li>
        <li>
          <span className="step-n">4</span>
          <div>
            <strong>Click Load unpacked and choose the <code>minutes</code> folder.</strong>
            <p className="dim">Minutes appears in the list. Pin it from the puzzle icon in the toolbar so it is one click away.</p>
          </div>
        </li>
        <li>
          <span className="step-n">5</span>
          <div>
            <strong>Open your call and click Minutes.</strong>
            <p className="dim">Sign in with your passkey, pick a workspace, and press Record meeting.</p>
          </div>
        </li>
      </ol>

      <p className="dim install-note">
        To update, download again, replace the folder, and click the reload arrow on Minutes in the extensions page.
      </p>
    </section>
  );
}
