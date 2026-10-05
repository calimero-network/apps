import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  setContextId,
  setContextIdentity,
  getContextIdentity,
  useMero,
} from "@calimero-network/mero-react";

import { loadAccountId } from "../../api/identity";
import { bindSession } from "../../api/session";
import { ClientApiDataSource } from "../../api/dataSource/ClientApiDataSource";
import Calendar from "../../components/calendar/Calendar";
import UsernameModal from "../../components/common/modals/username-modal/UsernameModal";

import "../../common.scss";
import { useActions, useModal, useSse } from "../../hooks";

// localStorage key for a per-context display name the user picked once.
const nameKey = (ctx: string) => `mc-username-${ctx}`;

export default function CalendarPage() {
  const navigate = useNavigate();
  const { teamId, contextId } = useParams<{ teamId: string; contextId: string }>();
  const { getEvents, getMembers } = useActions();
  const { openErrorModal } = useModal();
  // `admin`, not `mero.admin`: the session-aware client. On an account its
  // `getNodeIdentity` is the ACCOUNT and its `getContextIdentitiesOwned` is the
  // account too — where the relay's own routes would name the relay.
  const { admin } = useMero();
  const [ready, setReady] = useState(false);
  const [askUsername, setAskUsername] = useState(false);
  const setupDone = useRef(false);

  // ── Activate the context + identity, register a username, load data ─────────
  // The rest of the data layer reads the *active* context from getContextId()
  // and the executor from getContextIdentity(), so this is the one place that
  // wires them up. Everything downstream (redux thunks, SSE) needs no contextId.
  useEffect(() => {
    if (!contextId) {
      // Back to the team's calendar picker when we know the team, since that is
      // where a missing context is actually chosen; only a URL with no team at
      // all sends you all the way out to the teams list.
      navigate(teamId ? `/teams/${teamId}` : "/teams");
      return;
    }
    if (!admin) return; // the session is still connecting; run once it is
    if (setupDone.current) return;
    setupDone.current = true;

    (async () => {
      setContextId(contextId);
      // The team keys an account's device-local private store (api/privateStore).
      bindSession({ namespaceId: teamId ?? "" });

      // Who we are, for the OWNERSHIP checks (Edit / Delete / view-only). This
      // is the ACCOUNT and is a different value from the context signing key
      // resolved just below — see api/identity for why conflating them silently
      // hid Edit and Delete from every event's owner. Resolved before the
      // calendar is revealed so the first render already knows what it owns.
      await loadAccountId(admin);

      // Resolve the public key this session owns in the context and make it the
      // executor identity. Failure is non-fatal — fall back to whatever's stored.
      try {
        const res = (await admin.getContextIdentitiesOwned(contextId)) as
          | { identities?: string[] }
          | string[];
        const ids = Array.isArray(res) ? res : (res.identities ?? []);
        const pk = ids[0];
        if (pk) setContextIdentity(pk);
      } catch {
        /* keep existing identity */
      }

      // Register a display name once per context so peers see a real name
      // instead of a 44-char key. If we've never set one, prompt for it.
      const stored = localStorage.getItem(nameKey(contextId));
      if (stored) {
        try {
          await new ClientApiDataSource().setUsername(stored);
        } catch {
          /* best-effort */
        }
      } else {
        setAskUsername(true);
      }

      // Load events + members, then reveal the calendar.
      try {
        await Promise.all([getEvents(), getMembers()]);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to load calendar.";
        openErrorModal({ message, errorType: "appError" });
      }
      setReady(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextId, admin]);

  // ── Live updates: re-fetch events + members on every context mutation ───────
  // …and on every reconnect: whatever changed while the stream was down
  // arrives as no event at all.
  const refreshCalendar = () => {
    getEvents();
    getMembers();
  };
  useSse(contextId ?? null, refreshCalendar, refreshCalendar);

  async function handleUsernameSubmit(name: string) {
    const trimmed = name.trim();
    if (trimmed && contextId) {
      localStorage.setItem(nameKey(contextId), trimmed);
      try {
        await new ClientApiDataSource().setUsername(trimmed);
        getMembers();
      } catch {
        /* best-effort */
      }
    }
    setAskUsername(false);
  }

  // Default a name suggestion from the active identity (short pubkey).
  const defaultName = (() => {
    const pk = getContextIdentity() ?? "";
    return pk ? `user-${pk.slice(0, 6)}` : "";
  })();

  return (
    <div data-testid="calendar-container">
      {askUsername && (
        <UsernameModal
          defaultName={defaultName}
          onSubmit={handleUsernameSubmit}
          onSkip={() => setAskUsername(false)}
        />
      )}
      {ready && (
        <Calendar
          // One level up is the team's OTHER calendars, not the teams list. A
          // team can hold several, so jumping straight out made switching
          // between two calendars a two-step trip through an unrelated page.
          onBack={teamId ? () => navigate(`/teams/${teamId}`) : undefined}
        />
      )}
    </div>
  );
}
