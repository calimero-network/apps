import { useCallback, useEffect, useRef, useState } from "react";
import { describeError, type OtherOrg } from "@calimero-apps/connect";

export interface ConnectExistingOrgProps {
  /**
   * The account's other organizations, where this app may be added:
   * `() => otherOrgs(client, source)` from `@calimero-apps/connect`. Read
   * when the person opens the list, never before.
   */
  load: () => Promise<OtherOrg[]>;
  /**
   * Creates this app's instance in the chosen organization (then opens it).
   * A rejection is shown under the list and the choice can be made again.
   */
  onConnect: (org: OtherOrg) => Promise<void> | void;
  /** The app's name, for the copy ("Add Mero Chat to …"). */
  appName: string;
  /** The button's words (default "Connect to an existing organization"). */
  label?: string;
  /** Open the list straight away (the button is still shown, as a toggle). */
  defaultOpen?: boolean;
  className?: string;
}

type State =
  | { kind: "closed" }
  | { kind: "loading" }
  | { kind: "ready"; orgs: OtherOrg[] }
  | { kind: "failed"; error: string };

/**
 * The secondary, explicit way to put an app into an organization the account
 * already has (one made for another app): a button, "Connect to an existing
 * organization", that lists those organizations with what each holds
 * ("overworld — Mero Blocks: overworld"). Nothing is preselected and nothing
 * happens until the person picks one; creating a new organization for the app
 * stays the primary action, next to it.
 *
 * Test ids: `connect-existing-org` (the button), `connect-org-<orgId>` (each
 * choice), `connect-existing-org-list`, `connect-existing-org-empty`,
 * `connect-existing-org-error`.
 */
export function ConnectExistingOrg({
  load,
  onConnect,
  appName,
  label = "Connect to an existing organization",
  defaultOpen = false,
  className,
}: ConnectExistingOrgProps) {
  const [state, setState] = useState<State>({ kind: "closed" });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const open = useCallback(async () => {
    setState({ kind: "loading" });
    setError(null);
    try {
      const orgs = await load();
      if (live.current) setState({ kind: "ready", orgs });
    } catch (e) {
      if (live.current) setState({ kind: "failed", error: describeError(e) });
    }
  }, [load]);

  const opened = useRef(false);
  useEffect(() => {
    if (defaultOpen && !opened.current) {
      opened.current = true;
      void open();
    }
  }, [defaultOpen, open]);

  const toggle = () => {
    if (state.kind === "closed") void open();
    else setState({ kind: "closed" });
  };

  const choose = async (org: OtherOrg) => {
    if (busy) return;
    setBusy(org.orgId);
    setError(null);
    try {
      await onConnect(org);
    } catch (e) {
      if (live.current) setError(describeError(e));
    } finally {
      if (live.current) setBusy(null);
    }
  };

  return (
    <div className={className ? `cp-connect ${className}` : "cp-connect"}>
      <button
        type="button"
        className="cp-connect__toggle"
        data-testid="connect-existing-org"
        aria-expanded={state.kind !== "closed"}
        onClick={toggle}
      >
        {label}
      </button>
      {state.kind === "loading" && <p className="cp-connect__note">Looking for your organizations…</p>}
      {state.kind === "failed" && (
        <p className="cp-connect__error" role="alert" data-testid="connect-existing-org-error">
          {state.error}
        </p>
      )}
      {state.kind === "ready" &&
        (state.orgs.length === 0 ? (
          <p className="cp-connect__note" data-testid="connect-existing-org-empty">
            You are in no other organization where you can add {appName}.
          </p>
        ) : (
          <>
            <p className="cp-connect__note">Add {appName} to one of your organizations. Its members can then use it.</p>
            <ul className="cp-connect__list" data-testid="connect-existing-org-list">
              {state.orgs.map((org) => (
                <li key={org.orgId}>
                  <button
                    type="button"
                    className="cp-connect__org"
                    data-testid={`connect-org-${org.orgId}`}
                    disabled={busy !== null}
                    aria-busy={busy === org.orgId}
                    onClick={() => void choose(org)}
                  >
                    <span className="cp-connect__name">{org.name || org.orgId}</span>
                    <span className="cp-connect__holds">{busy === org.orgId ? `Adding ${appName}…` : org.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ))}
      {error && (
        <p className="cp-connect__error" role="alert" data-testid="connect-existing-org-error">
          {error}
        </p>
      )}
    </div>
  );
}
