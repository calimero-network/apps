import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { decideSelfName } from "@calimero-apps/names";

import { bindCalendar, getBinding } from "../../api/binding";
import type { Owner } from "../../api/booking";
import { readOrg, setMyTeamName } from "../../api/teams";
import { useSignedIn } from "../../api/sessionContext";
import { TeamScopeContext } from "../../api/teamScope";
import { rememberCalendar } from "../../utils/lastVisit";
import { ClientApiDataSource } from "../../api/dataSource/ClientApiDataSource";
import Calendar from "../../components/calendar/Calendar";
import UsernameModal from "../../components/common/modals/username-modal/UsernameModal";
import BookingLinksModal from "../../components/common/modals/booking-links-modal/BookingLinksModal";

import "../../common.scss";
import { useActions, useAppEvents, useModal } from "../../hooks";

/**
 * The calendar username this browser last set in a calendar, from before your
 * name lived on the team. Only read now, to adopt into the team.
 */
const nameKey = (app: string) => `mc-username-${app}`;

/** How long a burst of events waits before one re-read. */
const COALESCE_MS = 250;

/** This frontend's base URL, where `/book` lives (relative builds run under a node's `/{version}/`). */
function frontendBase(): string {
  const { origin, pathname } = window.location;
  const at = pathname.indexOf("/teams/");
  return origin + (at >= 0 ? pathname.slice(0, at) : "");
}

/**
 * One calendar: an app instance (v1: a context) in a team's org.
 *
 * What v1 had to do before the first read is gone: no context to join, no
 * context identity to pick, no node session to bind. The page binds the
 * signed-in client and the instance for the data layer, reads events and
 * members, and follows the instance's event stream.
 */
export default function CalendarPage() {
  const navigate = useNavigate();
  const { teamId, contextId } = useParams<{ teamId: string; contextId: string }>();
  const { client, accountId, passkey, after, targetKey } = useSignedIn();
  const { getEvents, getMembers } = useActions();
  const { openErrorModal } = useModal();
  const [ready, setReady] = useState(false);
  const [showBookingLinks, setShowBookingLinks] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const [teamNames, setTeamNames] = useState<Map<string, string>>(new Map());
  const [teamRead, setTeamRead] = useState(false);
  // Your username in this calendar's roster; null until read.
  const [rosterName, setRosterName] = useState<string | null>(null);
  const setupFor = useRef<string | null>(null);

  useEffect(() => {
    if (teamId && contextId) rememberCalendar(targetKey, teamId, contextId);
  }, [targetKey, teamId, contextId]);

  // The names members set on the team: yours is the one every calendar in it
  // uses, and theirs stand in for people with no calendar username.
  useEffect(() => {
    if (!teamId) return;
    let live = true;
    readOrg(client, teamId)
      .then((org) => {
        if (!live) return;
        setTeamNames(org.names);
        setTeamRead(true);
      })
      .catch(() => {})
      .finally(after);
    return () => {
      live = false;
    };
  }, [client, teamId, after]);

  // The open calendar is bound for the data layer for as long as this page
  // shows it, and on every mount: StrictMode mounts twice, and a bind done once
  // behind the setup guard below was cleared by the first unmount and never
  // redone, so every read after it failed with "No active calendar". Declared
  // before the setup so the first read already finds it bound.
  useEffect(() => {
    if (!contextId) return;
    bindCalendar({ client, app: contextId, after });
    return () => {
      if (getBinding().app === contextId) bindCalendar({ app: "" });
    };
  }, [client, contextId, after]);

  useEffect(() => {
    if (!contextId) {
      navigate(teamId ? `/teams/${teamId}` : "/teams");
      return;
    }
    if (setupFor.current === contextId) return;
    setupFor.current = contextId;

    setRosterName(null);
    (async () => {
      const mine = (await new ClientApiDataSource().getMembers()).data?.find((m) => m.id === accountId);
      setRosterName(mine?.username?.trim() ?? "");
      try {
        await Promise.all([getEvents(), getMembers()]);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to load calendar.";
        openErrorModal({ message, errorType: "appError" });
      }
      setReady(true);
    })();
  }, [contextId, teamId, client, accountId, after, navigate, getEvents, getMembers, openErrorModal]);

  // Every event only means "read again": coalesce a burst into one read.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshCalendar = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      getEvents();
      getMembers();
    }, COALESCE_MS);
  }, [getEvents, getMembers]);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  useAppEvents(client, contextId ?? null, refreshCalendar, refreshCalendar);

  // Your name is the team's, asked once for the team, never per calendar.
  const myTeamName = teamNames.get(accountId) ?? "";
  const decision = decideSelfName({
    orgReady: teamRead && rosterName !== null,
    orgName: myTeamName,
    fallbacks: [rosterName, contextId ? localStorage.getItem(nameKey(contextId)) : null],
  });

  /** Your name on the team, for every calendar in it (and in this calendar's roster). */
  const saveTeamName = useCallback(
    async (name: string) => {
      const trimmed = name.trim();
      if (!trimmed || !teamId) return;
      try {
        await setMyTeamName(client, teamId, accountId, trimmed);
      } catch {
        /* the calendar still shows it; the team asks again next time */
      } finally {
        after();
      }
      setTeamNames((prev) => new Map(prev).set(accountId, trimmed));
    },
    [client, teamId, accountId, after],
  );

  // A name another calendar or an older version knew is published to the team.
  const adopt = decision.kind === "adopt" ? decision.name : "";
  useEffect(() => {
    if (adopt) void saveTeamName(adopt);
  }, [adopt, saveTeamName]);

  // The team's name is copied into this calendar's roster without asking.
  // Only when it differs: every rename is an event to everyone in the calendar.
  const use = decision.kind === "use" ? decision.name : "";
  useEffect(() => {
    if (!use || rosterName === null || rosterName === use) return;
    // Silent: only into the calendar that is open, never into none.
    if (!contextId || getBinding().app !== contextId) return;
    setRosterName(use);
    void new ClientApiDataSource().setUsername(use).then(() => getMembers());
  }, [use, rosterName, contextId, getMembers]);

  const askUsername = decision.kind === "ask" && !skipped;
  const defaultName =
    (decision.kind === "ask" && decision.suggestion) || (accountId ? `user-${accountId.slice(0, 6)}` : "");

  const owner: Owner | null = useMemo(
    () => (contextId ? { client, app: contextId, passkey, after } : null),
    [client, contextId, passkey, after],
  );
  const scope = useMemo(() => ({ names: teamNames }), [teamNames]);

  return (
    <TeamScopeContext.Provider value={scope}>
      <div data-testid="calendar-container">
        {askUsername && (
          <UsernameModal
            defaultName={defaultName}
            onSubmit={(name) => void saveTeamName(name)}
            onSkip={() => setSkipped(true)}
          />
        )}
        {ready && (
          <Calendar
            onBack={teamId ? () => navigate(`/teams/${teamId}`) : undefined}
            onOpenBookingLinks={owner ? () => setShowBookingLinks(true) : undefined}
          />
        )}
        {showBookingLinks && owner && (
          <BookingLinksModal owner={owner} base={frontendBase()} onClose={() => setShowBookingLinks(false)} />
        )}
      </div>
    </TeamScopeContext.Provider>
  );
}
