import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useSubscription } from "@calimero-network/mero-react";

import SessionMenu from "./SessionMenu";
import AppHeader from "./AppHeader";
import {
  BarChartIcon,
  ChevronLeftIcon,
  HandIcon,
  HashIcon,
  HelpCircleIcon,
  InboxIcon,
  LayersIcon,
  PenSquareIcon,
  SettingsIcon,
  UserPlusIcon,
  UsersIcon,
} from "./icons";
import { useStreamReconnect } from "../hooks/useStreamReconnect";
import type {
  CategoryView,
  MeView,
  Overview,
} from "../generated/UpdatesClient";
import {
  RevisionContext,
  useAudienceContextId,
  useLive,
  useUpdatesClient,
} from "../lib/updates";
import { getActiveNamespaceId, getAudienceName, setUsername } from "../lib/session";

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
 * Every contract event for this context — a peer's update replicating in, an
 * investor's reaction, a read receipt — and every stream reconnect bumps one
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

  const contextIds = useMemo(() => (contextId ? [contextId] : []), [contextId]);
  useSubscription(contextIds, bump);
  // Events missed while the stream was down are gone for good; re-read.
  useStreamReconnect(bump);

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

  const audienceName = contextId ? getAudienceName(contextId) : "";
  const company = overview.data?.company_name || "";
  const isTeam = !!me.data?.is_team;
  const o = overview.data;

  const toAudiences = () => {
    const ns = getActiveNamespaceId();
    navigate(ns ? `/companies/${ns}` : "/companies");
  };
  const roleLabel = me.data ? (isTeam ? (me.data.is_admin ? "Admin" : "Team") : "Investor") : null;

  return (
    <AudienceDataContext.Provider value={data}>
      <div className="shellRoot">
        <AppHeader
          crumbs={[
            { label: company || "Company", onClick: toAudiences, icon: <LayersIcon size={14} /> },
            ...(audienceName ? [{ label: audienceName, icon: <HashIcon size={14} /> }] : []),
          ]}
          right={
            <>
              {roleLabel && (
                <span className="roleTag" data-team={isTeam}>
                  {roleLabel}
                </span>
              )}
              <SessionMenu />
            </>
          }
        />

        <div className="app">
          <aside className="sidebar">
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
                <InboxIcon size={16} />
                Updates
                {!!o?.unread_updates && <span className="badge">{o.unread_updates}</span>}
              </NavLink>
              {isTeam && (
                <NavLink to="/a/compose" className="navItem">
                  <PenSquareIcon size={16} />
                  Compose
                </NavLink>
              )}
              <NavLink to="/a/asks" className="navItem">
                <HandIcon size={16} />
                Asks
                {!!o?.open_asks && <span className="badge soft">{o.open_asks}</span>}
              </NavLink>
              <NavLink to="/a/metrics" className="navItem">
                <BarChartIcon size={16} />
                KPIs
              </NavLink>
              <NavLink to="/a/questions" className="navItem">
                <HelpCircleIcon size={16} />
                Q&amp;A
                {!!o?.open_questions && isTeam && (
                  <span className="badge">{o.open_questions}</span>
                )}
              </NavLink>
              <NavLink to="/a/people" className="navItem">
                <UsersIcon size={16} />
                People
              </NavLink>
              {isTeam && (
                <NavLink to="/a/settings" className="navItem">
                  <SettingsIcon size={16} />
                  Settings
                </NavLink>
              )}
            </nav>
          </aside>

          <div className="appBody">
            {me.error && <div className="error">{me.error}</div>}
            {me.data && !me.data.name && <ProfilePrompt me={me.data} onSaved={reload} />}

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
 * "Who are you?" — shown until you answer.
 *
 * Asked inline, once, rather than behind a settings page: the founder's
 * follow-up list and every byline are useless as 64-hex account ids, and the
 * one moment someone is sure to see this is their first visit.
 */
function ProfilePrompt({ me, onSaved }: { me: MeView; onSaved: () => void }) {
  const client = useUpdatesClient();
  const [name, setName] = useState("");
  const [firm, setFirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!client || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await client.setProfile({ name: name.trim(), firm: firm.trim() });
      setUsername(name.trim());
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
        <strong>Tell {me.is_team ? "your investors" : "the team"} who you are.</strong>
        <p className="muted">
          {me.is_team
            ? "Your name goes on every update you publish."
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
