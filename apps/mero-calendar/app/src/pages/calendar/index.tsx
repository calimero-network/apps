import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { bindCalendar } from "../../api/binding";
import type { Owner } from "../../api/booking";
import { readOrg } from "../../api/teams";
import { useSignedIn } from "../../api/sessionContext";
import { TeamScopeContext } from "../../api/teamScope";
import { rememberCalendar } from "../../utils/lastVisit";
import { ClientApiDataSource } from "../../api/dataSource/ClientApiDataSource";
import Calendar from "../../components/calendar/Calendar";
import UsernameModal from "../../components/common/modals/username-modal/UsernameModal";
import BookingLinksModal from "../../components/common/modals/booking-links-modal/BookingLinksModal";

import "../../common.scss";
import { useActions, useAppEvents, useModal } from "../../hooks";

/** The calendar username this browser last set in a calendar. */
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
  const [askUsername, setAskUsername] = useState(false);
  const [teamNames, setTeamNames] = useState<Map<string, string>>(new Map());
  const setupFor = useRef<string | null>(null);

  useEffect(() => {
    if (teamId && contextId) rememberCalendar(targetKey, teamId, contextId);
  }, [targetKey, teamId, contextId]);

  // The names members set on the team, for people with no calendar username.
  useEffect(() => {
    if (!teamId) return;
    let live = true;
    readOrg(client, teamId)
      .then((org) => live && setTeamNames(org.names))
      .catch(() => {})
      .finally(after);
    return () => {
      live = false;
    };
  }, [client, teamId, after]);

  useEffect(() => {
    if (!contextId) {
      navigate(teamId ? `/teams/${teamId}` : "/teams");
      return;
    }
    if (setupFor.current === contextId) return;
    setupFor.current = contextId;
    bindCalendar({ client, app: contextId, after });

    (async () => {
      const stored = localStorage.getItem(nameKey(contextId));
      if (stored) {
        // Best effort, and only when it differs: every rename is an event to
        // everyone in the calendar.
        const data = new ClientApiDataSource();
        const mine = (await data.getMembers()).data?.find((m) => m.id === accountId);
        if (mine?.username !== stored) await data.setUsername(stored);
      } else {
        setAskUsername(true);
      }
      try {
        await Promise.all([getEvents(), getMembers()]);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to load calendar.";
        openErrorModal({ message, errorType: "appError" });
      }
      setReady(true);
    })();
  }, [contextId, teamId, client, accountId, after, navigate, getEvents, getMembers, openErrorModal]);

  useEffect(() => () => bindCalendar({ app: "" }), []);

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

  async function handleUsernameSubmit(name: string) {
    const trimmed = name.trim();
    if (trimmed && contextId) {
      localStorage.setItem(nameKey(contextId), trimmed);
      await new ClientApiDataSource().setUsername(trimmed);
      getMembers();
    }
    setAskUsername(false);
  }

  // A name already set on the team is used without asking.
  const myTeamName = teamNames.get(accountId) ?? "";
  useEffect(() => {
    if (askUsername && myTeamName) void handleUsernameSubmit(myTeamName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askUsername, myTeamName]);

  const defaultName = myTeamName || (accountId ? `user-${accountId.slice(0, 6)}` : "");

  const owner: Owner | null = useMemo(
    () => (contextId ? { client, app: contextId, passkey, after } : null),
    [client, contextId, passkey, after],
  );
  const scope = useMemo(() => ({ names: teamNames }), [teamNames]);

  return (
    <TeamScopeContext.Provider value={scope}>
      <div data-testid="calendar-container">
        {askUsername && !myTeamName && (
          <UsernameModal
            defaultName={defaultName}
            onSubmit={handleUsernameSubmit}
            onSkip={() => setAskUsername(false)}
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
