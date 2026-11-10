import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { decideSelfName, type SelfNameDecision } from "@calimero-apps/names";

import SessionMenu from "./SessionMenu";
import ThemeToggle from "./ThemeToggle";
import { BrandMark } from "./AppHeader";
import {
  BarChartIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  HandIcon,
  HashIcon,
  HelpCircleIcon,
  InboxIcon,
  LayersIcon,
  MenuIcon,
  PenSquareIcon,
  SettingsIcon,
  UserPlusIcon,
  UsersIcon,
  XIcon,
} from "./icons";
import type {
  CategoryView,
  MeView,
  Overview,
} from "../lib/updatesClient";
import {
  RevisionContext,
  useAudienceEvents,
  useAudienceContextId,
  useLive,
  usePublishSpaceName,
  useSelfSpaceName,
  useUpdatesClient,
} from "../lib/updates";
import { getActiveNamespaceId, getAudienceName, getUsername } from "../lib/active";

/** What every page inside an audience needs, loaded once by the shell. */
interface AudienceData {
  me: MeView | null;
  overview: Overview | null;
  categories: CategoryView[];
  reload: () => void;
}

const AudienceDataContext = createContext<AudienceData>({
  me: null,
  overview: null,
  categories: [],
  reload: () => undefined,
});

export function useAudience(): AudienceData {
  return useContext(AudienceDataContext);
}

/** Debounce so a burst of events (a publish emits several) is one re-read. */
const BUMP_DEBOUNCE_MS = 250;

/**
 * The frame around every audience page, and the owner of LIVE state.
 *
 * Every contract event of this audience — a published update, an investor's
 * reaction, a read receipt — and every stream reconnect bumps one
 * revision counter, and every `useLive` read below re-runs. That is what makes
 * the conversation two-way in practice: a founder sees the reply land without
 * refreshing.
 */
export default function AudienceShell() {
  const contextId = useAudienceContextId();
  const [revision, setRevision] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const bump = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      setRevision((n) => n + 1);
    }, BUMP_DEBOUNCE_MS);
  }, []);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  // Every event of this instance, and every reconnect of the stream (events
  // missed while it was down are re-read, not replayed), bumps the revision.
  useAudienceEvents(contextId, bump);

  const revisionValue = useMemo(() => ({ revision, bump }), [revision, bump]);

  return (
    <RevisionContext.Provider value={revisionValue}>
      <ShellBody />
    </RevisionContext.Provider>
  );
}

function ShellBody() {
  const navigate = useNavigate();
  const contextId = useAudienceContextId();
  const me = useLive((c) => c.getMe(), []);
  const overview = useLive((c) => c.getOverview(), []);
  const categories = useLive((c) => c.listCategories(), []);

  const reload = useCallback(() => {
    me.reload();
    overview.reload();
    categories.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me.reload, overview.reload, categories.reload]);

  const data = useMemo<AudienceData>(
    () => ({
      me: me.data,
      overview: overview.data,
      categories: categories.data ?? [],
      reload,
    }),
    [me.data, overview.data, categories.data, reload],
  );

  const selfName = useSelfName(me.data, me.reload);

  const audienceName = contextId ? getAudienceName(contextId) : "";
  const company = overview.data?.company_name || "";
  const isTeam = !!me.data?.is_team;
  const o = overview.data;

  // The phone nav drawer. It is the sidebar itself, slid in over the page, so
  // there is one nav and one identity footer, never a copy to keep in step.
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setNavOpen(false), [location.pathname]);
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setNavOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen]);

  const toAudiences = () => {
    const ns = getActiveNamespaceId();
    navigate(ns ? `/companies/${ns}` : "/companies");
  };
  const roleLabel = me.data ? (isTeam ? (me.data.is_admin ? "Admin" : "Team") : "Investor") : null;

  return (
    <AudienceDataContext.Provider value={data}>
      <div className="shell" data-nav-open={navOpen}>
        {/* ⚠️ No backdrop-filter, filter or transform on .shell or .shellMain:
            any of them would become the containing block for the fixed
            drawer, scrim and menus below and trap them inside it. */}
        <aside className="sidebar" id="audience-nav" data-testid="mobile-nav" aria-label="Audience">
          <div className="sideBrand">
            <BrandMark />
            <span className="brandName">Mero Updates</span>
            <button
              type="button"
              className="iconBtn sideClose"
              aria-label="Close menu"
              onClick={() => setNavOpen(false)}
            >
              <XIcon size={18} />
            </button>
          </div>

          <button className="back sideBack" onClick={toAudiences}>
            <ChevronLeftIcon size={14} />
            Audiences
          </button>
          <div className="appTitle">
            <span className="appTile" aria-hidden>
              <HashIcon size={16} />
            </span>
            <span className="appTitleText">
              <span className="appCompany" data-testid="company-name">
                {company || "Your company"}
              </span>
              {audienceName && <span className="appAudience">{audienceName}</span>}
            </span>
          </div>

          <nav className="appNav" aria-label="Sections">
            <NavLink to="/a" end className="navItem">
              <InboxIcon size={17} />
              Updates
              {!!o?.unread_updates && <span className="badge">{o.unread_updates}</span>}
            </NavLink>
            {isTeam && (
              <NavLink to="/a/compose" className="navItem">
                <PenSquareIcon size={17} />
                Compose
              </NavLink>
            )}
            <NavLink to="/a/asks" className="navItem">
              <HandIcon size={17} />
              Asks
              {!!o?.open_asks && <span className="badge soft">{o.open_asks}</span>}
            </NavLink>
            <NavLink to="/a/metrics" className="navItem">
              <BarChartIcon size={17} />
              KPIs
            </NavLink>
            <NavLink to="/a/questions" className="navItem">
              <HelpCircleIcon size={17} />
              Q&amp;A
              {!!o?.open_questions && isTeam && <span className="badge">{o.open_questions}</span>}
            </NavLink>
            <NavLink to="/a/people" className="navItem">
              <UsersIcon size={17} />
              People
            </NavLink>
            {isTeam && (
              <NavLink to="/a/settings" className="navItem">
                <SettingsIcon size={17} />
                Settings
              </NavLink>
            )}
          </nav>

          <div className="grow" />
          <SessionMenu me={me.data} roleLabel={roleLabel} />
        </aside>
        {navOpen && <div className="navScrim" aria-hidden onClick={() => setNavOpen(false)} />}

        <div className="shellMain">
          <header className="topBar">
            <button
              type="button"
              className="iconBtn menuBtn"
              aria-label="Open menu"
              aria-expanded={navOpen}
              aria-controls="audience-nav"
              onClick={() => setNavOpen(true)}
              data-testid="mobile-nav-btn"
            >
              <MenuIcon size={20} />
            </button>
            <span className="topBrand" aria-hidden>
              <BrandMark />
            </span>
            <nav className="crumbs" aria-label="Breadcrumb">
              <button type="button" className="crumb" onClick={toAudiences}>
                <LayersIcon size={14} />
                <span className="crumbLabel">{company || "Company"}</span>
              </button>
              {audienceName && (
                <>
                  <ChevronRightIcon size={14} className="crumbSep" />
                  <span className="crumb current" aria-current="page">
                    <HashIcon size={14} />
                    <span className="crumbLabel">{audienceName}</span>
                  </span>
                </>
              )}
            </nav>
            <div className="grow" />
            <ThemeToggle />
          </header>

          <div className="appBody">
            {me.error && <div className="error">{me.error}</div>}
            {me.data && selfName.kind === "ask" && (
              <ProfilePrompt me={me.data} suggestion={selfName.suggestion} onSaved={reload} />
            )}

            <main className="appMain">
              <Outlet />
            </main>
          </div>
        </div>
      </div>
    </AudienceDataContext.Provider>
  );
}

/**
 * Your name in this audience, from your name in the company.
 *
 * The company holds it (org member metadata), asked when you created or joined
 * it; this audience's profile is a copy, written silently whenever it differs.
 * A profile name (or this app's older per-browser name) from before the
 * company held one is published to the company instead. Only a company with
 * no name for you anywhere asks — once, for the whole company.
 */
function useSelfName(me: MeView | null, reload: () => void): SelfNameDecision {
  const client = useUpdatesClient();
  const publishSpaceName = usePublishSpaceName();
  const space = useSelfSpaceName(me?.account);
  const decision = useMemo<SelfNameDecision>(
    () =>
      me
        ? decideSelfName({ orgReady: space.ready, orgName: space.name, fallbacks: [me.name, getUsername()] })
        : { kind: "wait" },
    [me, space.ready, space.name],
  );

  // One write per (audience, name): a refused write is not retried in a loop.
  const done = useRef<string | null>(null);
  useEffect(() => {
    if (!me || !client || (decision.kind !== "use" && decision.kind !== "adopt")) return;
    const name = decision.name;
    const key = `${client.appId}:${decision.kind}:${name}`;
    if (done.current === key) return;
    done.current = key;
    if (decision.kind === "adopt") void publishSpaceName(me.account, name);
    if (me.name.trim() === name) return;
    void client
      .setProfile({ name, firm: me.firm })
      .then(reload)
      .catch(() => {
        /* the shell still labels you by the company name */
      });
  }, [me, client, decision, publishSpaceName, reload]);

  return decision;
}

/**
 * "Who are you?" — for a company made before names were asked when it was
 * created or joined, the first time you open any of its audiences.
 *
 * Asked inline rather than behind a settings page: the founder's follow-up
 * list and every byline are useless as 64-hex account ids. The answer is your
 * name in the whole company, so no other audience in it asks again.
 */
function ProfilePrompt({
  me,
  suggestion,
  onSaved,
}: {
  me: MeView;
  suggestion: string;
  onSaved: () => void;
}) {
  const client = useUpdatesClient();
  const publishSpaceName = usePublishSpaceName();
  const [name, setName] = useState(suggestion);
  const [firm, setFirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!client || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await client.setProfile({ name: name.trim(), firm: firm.trim() });
      await publishSpaceName(me.account, name);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="profilePrompt" data-testid="profile-prompt">
      <div className="profilePromptHead">
        <span className="iconTile accent" aria-hidden>
          <UserPlusIcon size={18} />
        </span>
        <div>
        <strong>Your name in this company</strong>
        <p className="muted">
          {me.is_team
            ? "It goes on every update you publish, in every audience of the company."
            : "The team sees who read, reacted and offered to help — as a name, not an account id."}
        </p>
        </div>
      </div>
      <div className="row wrap">
        <input
          aria-label="Your name"
          placeholder="Your name"
          value={name}
          maxLength={64}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void save()}
        />
        <input
          aria-label={me.is_team ? "Company or role" : "Fund or firm"}
          placeholder={me.is_team ? "Role (e.g. CEO)" : "Fund or firm (optional)"}
          value={firm}
          maxLength={64}
          onChange={(e) => setFirm(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void save()}
        />
        <button className="primary" disabled={busy || !name.trim()} onClick={() => void save()}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </section>
  );
}
