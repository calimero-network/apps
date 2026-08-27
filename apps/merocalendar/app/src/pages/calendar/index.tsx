import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  setContextId,
  setContextIdentity,
  getContextIdentity,
} from "@calimero-network/mero-react";

import { adminGet } from "../../api/rpc";
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
  const [ready, setReady] = useState(false);
  const [askUsername, setAskUsername] = useState(false);
  const setupDone = useRef(false);

  // ── Activate the context + identity, register a username, load data ─────────
  // The rest of the data layer reads the *active* context from getContextId()
  // and the executor from getContextIdentity(), so this is the one place that
  // wires them up. Everything downstream (redux thunks, SSE) needs no contextId.
  useEffect(() => {
    if (!contextId) {
      navigate("/teams");
      return;
    }
    if (setupDone.current) return;
    setupDone.current = true;

    (async () => {
      setContextId(contextId);

      // Resolve the public key this node owns in the context and make it the
      // executor identity. identities-owned shape is { identities: [pk] } (or a
      // bare string[]). Failure is non-fatal — fall back to whatever's stored.
      try {
        const res = await adminGet<
          { identities?: string[] } | string[]
        >(`/contexts/${contextId}/identities-owned`);
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
  }, [contextId]);

  // ── Live updates: re-fetch events + members on every context mutation ───────
  useSse(contextId ?? null, () => {
    getEvents();
    getMembers();
  });

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
        <Calendar onBack={teamId ? () => navigate("/teams") : undefined} />
      )}
    </div>
  );
}
