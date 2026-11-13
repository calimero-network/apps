import { useEffect, useId, useRef, type KeyboardEvent, type MouseEvent } from "react";
import { createRoot } from "react-dom/client";

export interface ConsentHandoffProps {
  /** The confirmation code the node's consent page will show (`started.code`). */
  code: string;
  /** The app sending the person, as they know it: "Mero Chat". */
  appName?: string;
  /** What is being approved, in plain words: "Create the workspace “Acme”". */
  action?: string;
  onContinue: () => void;
  onCancel: () => void;
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Shown before an app sends the person to the node's consent page: the code
 * that page will show, so a page that is not the node's is told apart.
 * A modal dialog; Esc and the backdrop cancel, focus returns where it was.
 */
export function ConsentHandoff({ code, appName, action, onContinue, onCancel }: ConsentHandoffProps) {
  const titleId = useId();
  const textId = useId();
  const card = useRef<HTMLDivElement>(null);
  const primary = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    primary.current?.focus();
    return () => {
      if (before && before.isConnected) before.focus();
    };
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
      return;
    }
    if (e.key !== "Tab" || !card.current) return;
    const items = Array.from(card.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !card.current.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !card.current.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  };

  const onBackdrop = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onCancel();
  };

  return (
    <div className="cp-consent" onMouseDown={onBackdrop} onKeyDown={onKeyDown} data-testid="consent-handoff">
      <div
        ref={card}
        className="cp-consent__card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={textId}
      >
        <span className="cp-consent__icon" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3 5 6v5c0 4.4 3 8.3 7 10 4-1.7 7-5.6 7-10V6l-7-3Z" />
            <path d="m9 12 2 2 4-4" />
          </svg>
        </span>
        <h2 id={titleId} className="cp-consent__title">
          Approve on your Calimero node
        </h2>
        <p id={textId} className="cp-consent__text">
          Your node will open its own page, where you approve {appName ? `this request from ${appName}` : "this"} with your passkey.
        </p>
        {action ? (
          <p className="cp-consent__action">
            <span className="cp-consent__label">Request</span>
            <span data-testid="consent-handoff-action">{action}</span>
          </p>
        ) : null}
        <div className="cp-consent__code-box">
          <span className="cp-consent__label">Confirmation code</span>
          <code className="cp-consent__code" data-testid="consent-handoff-code">
            {code}
          </code>
          <span className="cp-consent__check">Check that page shows this code.</span>
        </div>
        <div className="cp-consent__actions">
          <button type="button" className="cp-consent__secondary" onClick={onCancel} data-testid="consent-handoff-cancel">
            Cancel
          </button>
          <button
            ref={primary}
            type="button"
            className="cp-consent__primary"
            onClick={onContinue}
            data-testid="consent-handoff-continue"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}

export interface ConsentHandoffOptions {
  code: string;
  appName?: string;
  action?: string;
  /** Where the dialog is mounted; `document.body` by default. */
  container?: HTMLElement;
}

/**
 * Shows {@link ConsentHandoff} and answers whether the person chose to go on
 * to the node's consent page: `true` for Continue, `false` for Cancel, Esc or
 * the backdrop. Callable from code outside React; pass it as mero-js
 * `openConsentPage`'s `confirm`:
 *
 * ```ts
 * client.openConsentPage(request, { confirm: (s) => confirmConsentHandoff({ code: s.code ?? "" }) });
 * ```
 */
export function confirmConsentHandoff({ code, appName, action, container }: ConsentHandoffOptions): Promise<boolean> {
  if (typeof document === "undefined") return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    const host = document.createElement("div");
    host.className = "cp-consent-host";
    (container ?? document.body).appendChild(host);
    const root = createRoot(host);
    let settled = false;
    const settle = (answer: boolean) => {
      if (settled) return;
      settled = true;
      // Not from inside React's own event dispatch.
      queueMicrotask(() => {
        root.unmount();
        host.remove();
        resolve(answer);
      });
    };
    root.render(
      <ConsentHandoff
        code={code}
        appName={appName}
        action={action}
        onContinue={() => settle(true)}
        onCancel={() => settle(false)}
      />,
    );
  });
}
