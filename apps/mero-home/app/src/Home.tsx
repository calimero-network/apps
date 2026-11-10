import { useCallback, useEffect, useState } from "react";
import type { CalimeroClient, PasskeyProvider } from "@calimero-network/mero-js";
import { describeError, myOrgs, type KeyValueStorage, type MyOrg } from "@calimero-apps/connect";

import { AdminApps } from "./screens/AdminApps";
import { Invitations } from "./screens/Invitations";
import { MergeOrgs } from "./screens/MergeOrgs";
import { OrgSettings } from "./screens/OrgSettings";
import { People } from "./screens/People";
import { YourApps } from "./screens/YourApps";
import { loadOrg, modeLabel, orgName, roleLabel, screensFor, type OrgView, type Screen } from "./home";
import { movesSupported } from "./move";

const SCREEN_LABEL: Record<Screen, string> = {
  apps: "Your apps",
  people: "People",
  invitations: "Invitations",
  admin: "Admin",
  settings: "Organization",
};

/** The org opened last by this account, remembered across loads. */
const lastOrgKey = (account: string) => `mero-home:org:${account}`;

export interface HomeProps {
  client: CalimeroClient;
  account: string;
  passkey: () => PasskeyProvider;
  after: () => void;
  /** The org to open first (`?org=`, or the one an invite joined). */
  initialOrg?: string | null;
  storage?: KeyValueStorage;
}

type Orgs = { kind: "loading" } | { kind: "ready"; orgs: MyOrg[] } | { kind: "failed"; error: string };
type View = { kind: "none" } | { kind: "loading" } | { kind: "ready"; view: OrgView } | { kind: "failed"; error: string };

/**
 * Home once signed in: the org picker, then the org's screens. What each
 * person gets follows the owner's decisions (`screensFor`): everyone sees
 * their apps; members and above the people; whoever may invite the
 * invitations; admins the Admin screen.
 */
export function Home({ client, account, passkey, after, initialOrg = null, storage = globalThis.localStorage }: HomeProps) {
  const [orgs, setOrgs] = useState<Orgs>({ kind: "loading" });
  const [org, setOrg] = useState<string | null>(null);
  const [view, setView] = useState<View>({ kind: "none" });
  const [screen, setScreen] = useState<Screen>("apps");
  const [reloads, setReloads] = useState(0);
  const reload = useCallback(() => setReloads((n) => n + 1), []);
  /** Bumped to read the account's organizations again (after one was deleted). */
  const [orgReads, setOrgReads] = useState(0);
  // A move or a merge changes the orgs too (one may be deleted): both are read again.
  const reloadAll = useCallback(() => {
    setOrgReads((n) => n + 1);
    setReloads((n) => n + 1);
  }, []);
  // Whether the node moves apps between organizations (core's `/apps/{app}/move`):
  // on a node from before, "Move to another organization" and "Merge
  // organizations" are not offered.
  const [canMove, setCanMove] = useState(false);

  useEffect(() => {
    let live = true;
    movesSupported(client).then((yes) => live && setCanMove(yes));
    return () => {
      live = false;
    };
  }, [client]);

  useEffect(() => {
    let live = true;
    myOrgs(client)
      .then((list) => {
        if (!live) return;
        setOrgs({ kind: "ready", orgs: list });
        let remembered: string | null = null;
        try {
          remembered = storage?.getItem(lastOrgKey(account)) ?? null;
        } catch {
          /* nothing stored */
        }
        const pick =
          [initialOrg, remembered].find((o) => o && list.some((x) => x.orgId === o)) ??
          (list.length === 1 ? list[0]!.orgId : null);
        // Read again after a change: the org open stays open while it exists.
        setOrg((current) => (current && list.some((x) => x.orgId === current) ? current : (pick ?? null)));
      })
      .catch((e) => live && setOrgs({ kind: "failed", error: describeError(e) }))
      .finally(after);
    return () => {
      live = false;
    };
  }, [client, account, initialOrg, storage, after, orgReads]);

  useEffect(() => {
    if (!org) {
      setView({ kind: "none" });
      return;
    }
    let live = true;
    setView((v) => (v.kind === "ready" && v.view.org === org ? v : { kind: "loading" }));
    loadOrg(client, org, account)
      .then((v) => live && setView({ kind: "ready", view: v }))
      .catch((e) => live && setView({ kind: "failed", error: describeError(e) }))
      .finally(after);
    return () => {
      live = false;
    };
  }, [client, org, account, reloads, after]);

  const choose = (id: string | null) => {
    setOrg(id);
    setScreen("apps");
    try {
      if (id) storage?.setItem(lastOrgKey(account), id);
    } catch {
      /* remembered for this page only */
    }
  };

  const screens = view.kind === "ready" ? screensFor(view.view) : [];
  const shown = screens.includes(screen) ? screen : "apps";

  return (
    <>
      <section className="home-card" aria-label="Organization">
        {orgs.kind === "loading" && <p className="home-muted">Looking for your organizations…</p>}
        {orgs.kind === "failed" && (
          <p className="home-error" role="alert">
            {orgs.error}
          </p>
        )}
        {orgs.kind === "ready" && orgs.orgs.length === 0 && (
          <p className="home-muted" data-testid="no-orgs">
            You are in no organization yet. Open an invitation link, or create one from any app.
          </p>
        )}
        {orgs.kind === "ready" && orgs.orgs.length > 0 && (
          <div className="home-row home-org">
            <label className="home-field">
              <span>Organization</span>
              <select
                data-testid="org-picker"
                value={org ?? ""}
                onChange={(e) => choose(e.target.value || null)}
              >
                <option value="">Choose…</option>
                {orgs.orgs.map((o) => (
                  <option key={o.orgId} value={o.orgId}>
                    {o.name || o.orgId}
                  </option>
                ))}
              </select>
            </label>
            {view.kind === "ready" && (view.view.profile.logo || view.view.profile.name) && (
              <p className="home-row" data-testid="org-profile">
                {view.view.profile.logo && (
                  <img src={view.view.profile.logo} alt="" className="home-logo home-logo--small" />
                )}
                <strong>{orgName(view.view)}</strong>
              </p>
            )}
            {view.kind === "ready" && (
              <p className="home-muted" data-testid="org-mode">
                {view.view.role ? `${roleLabel(view.view.role)} · ` : ""}
                {modeLabel(view.view.mode)}
              </p>
            )}
          </div>
        )}
      </section>

      {view.kind === "loading" && (
        <section className="home-card">
          <p className="home-muted">Opening the organization…</p>
        </section>
      )}
      {view.kind === "failed" && (
        <section className="home-card">
          <p className="home-error" role="alert">
            {view.error}
          </p>
        </section>
      )}

      {view.kind === "ready" && (
        <>
          <nav className="home-tabs" role="tablist" aria-label="Home screens">
            {screens.map((s) => (
              <button
                key={s}
                role="tab"
                aria-selected={shown === s}
                className={shown === s ? "glass-btn glass-btn--primary" : "glass-btn"}
                data-testid={`tab-${s}`}
                onClick={() => {
                  setScreen(s);
                  // Each screen opens on the org as it is now: someone may have
                  // joined, or been removed, since it was last read.
                  reload();
                }}
              >
                {SCREEN_LABEL[s]}
              </button>
            ))}
          </nav>
          {shown === "apps" && <YourApps view={view.view} />}
          {shown === "people" && (
            <People
              client={client}
              view={view.view}
              account={account}
              passkey={passkey}
              after={after}
              onChanged={reload}
            />
          )}
          {shown === "invitations" && (
            <Invitations client={client} view={view.view} account={account} passkey={passkey} after={after} />
          )}
          {shown === "settings" && (
            <OrgSettings
              key={view.view.org}
              client={client}
              view={view.view}
              account={account}
              passkey={passkey}
              after={after}
              onChanged={reload}
              onDeleted={() => {
                try {
                  storage?.removeItem(lastOrgKey(account));
                } catch {
                  /* nothing stored */
                }
                setOrg(null);
                setScreen("apps");
                setOrgReads((n) => n + 1);
              }}
            />
          )}
          {shown === "admin" && (
            <>
              <AdminApps
                client={client}
                view={view.view}
                orgs={orgs.kind === "ready" ? orgs.orgs : []}
                canMove={canMove}
                passkey={passkey}
                after={after}
                onChanged={reloadAll}
              />
              {canMove && (
                <MergeOrgs
                  client={client}
                  view={view.view}
                  orgs={orgs.kind === "ready" ? orgs.orgs : []}
                  account={account}
                  passkey={passkey}
                  after={after}
                  onChanged={reloadAll}
                />
              )}
            </>
          )}
        </>
      )}
    </>
  );
}
