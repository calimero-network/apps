import { useEffect, useState } from "react";
import { BraveMark, ChromeMark } from "./Landing";
import { Icon } from "./ui";

export const INSTALL_TITLE = "Install Sylence for Chrome and Brave";

/** Beside the page (`extensionDownload.ts`), or the public listing's copy on a Cloud node's page. */
export const EXTENSION_ZIP = typeof __EXTENSION_ZIP__ === "string" ? __EXTENSION_ZIP__ : "./sylence-extension.zip";
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
export function InstallPage({
  onBack,
  backLabel = "Back",
  onSignIn,
}: {
  onBack?: () => void;
  backLabel?: string;
  /** Signed out: offered under the steps, for someone who already has the extension. */
  onSignIn?: () => void;
}) {
  const browser = browserName();
  const page = extensionsPage(browser);
  const [copied, setCopied] = useState(false);
  const supported = browser !== "other";

  useEffect(() => {
    const before = document.title;
    document.title = INSTALL_TITLE;
    if (!navigator.userAgent.includes("jsdom")) window.scrollTo(0, 0);
    return () => {
      document.title = before;
    };
  }, []);

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
        <span className="install-eyebrow">Install</span>
        <h1 id="install-title">Install Sylence for Chrome and Brave</h1>
        <p className="lede">
          The extension records the call in your browser tab and turns speech into text on your laptop. No bot joins the
          call, and the recording is kept in a secure enclave only your team can read.
        </p>
        <div className="row install-cta">
          <a
            className="btn primary large"
            href={EXTENSION_ZIP}
            download="sylence-extension.zip"
            data-testid="download-extension"
          >
            <Icon name="download" /> Download the extension
          </a>
        </div>
        <div className="install-meta">
          <span className="browser">
            <ChromeMark size={16} /> Chrome
          </span>
          <span className="browser">
            <BraveMark size={16} /> Brave
          </span>
          <span className="dim">
            {EXTENSION_VERSION ? `Version ${EXTENSION_VERSION} · ` : ""}Edge works too, on a desktop
            {!supported && " · this browser can't run it"}
          </span>
        </div>
      </div>

      <div className="install-body">
        <h2 className="install-h2">Five steps, about a minute</h2>
        <ol className="install-steps">
          <li>
            <span className="step-n">1</span>
            <div>
              <strong>Unzip the download.</strong>
              <p className="dim">
                You get a folder named <code>sylence</code>. Keep it somewhere it can stay, such as Documents.
              </p>
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
              <strong>
                Click Load unpacked and choose the <code>sylence</code> folder.
              </strong>
              <p className="dim">
                Sylence appears in the list. Pin it from the puzzle icon in the toolbar so it is one click away.
              </p>
            </div>
          </li>
          <li>
            <span className="step-n">5</span>
            <div>
              <strong>Open your call and click Sylence.</strong>
              <p className="dim">Sign in with your passkey, pick a workspace, and press Record meeting.</p>
            </div>
          </li>
        </ol>

        <p className="dim install-note">
          To update, download again, replace the folder, and click the reload arrow on Sylence in the extensions page.
          {onSignIn && (
            <>
              {" "}
              Already set up?{" "}
              <button type="button" className="install-signin" onClick={onSignIn}>
                Sign in to read your meetings
              </button>
              .
            </>
          )}
        </p>
      </div>
    </section>
  );
}
