import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMero } from "@calimero-network/mero-react";
import { useApplicationId } from "../hooks/useApplicationId";
import { useToast } from "../contexts/ToastContext";
import { setActiveForum, setForumName } from "../lib/session";
import { decodeInvite } from "../lib/inviteCodec";
import {
  createSpaceNamespace,
  deleteSpace,
  listSpaceNamespaces,
  mintNamespaceInvite,
  redeemInvite,
  type NamespaceRow,
} from "../lib/groups";
import InviteModal from "../components/InviteModal";
import { invitationFromRaw } from "../lib/inviteLink";
import { useDialogOpen } from "../hooks/useDialogOpen";
import styles from "./SpacesPage.module.css";

/**
 * Spaces = NAMESPACES. One level up from where this page used to sit.
 *
 * It used to list contexts and name each one a "space", which collapsed two
 * distinct things into one and left no forum for forums: creating a space made a
 * namespace plus a context and nothing could ever add a second forum to it. The
 * model that actually matches Calimero, and what the two-node suite proves:
 *
 *   Namespace ("space")  ← you invite people HERE
 *     └── Subgroup ("forum") + Context   ← one board   → /spaces/:id
 *
 * So: this page creates namespaces, invites to namespaces, and accepts any invite
 * code. Forums live on ForumsPage.
 *
 * Invite codes are the SAME format mero-chat and mero-blocks use — one base58
 * token of deflated JSON (lib/inviteCodec) — so a code minted by any of them
 * decodes here, and a code from here pastes into a chat window without being
 * mangled.
 */
export default function SpacesPage() {
  const navigate = useNavigate();
  const { mero, logout, nodeUrl } = useMero();
  const { showToast } = useToast();
  // Resolved from the NODE by package, not from the session — see lib/appId.
  const { appId, resolving: resolvingAppId, notInstalled } = useApplicationId();
  const nodeLabel = (() => {
    if (!nodeUrl) return "";
    try {
      const u = new URL(nodeUrl);
      return u.port ? `${u.hostname}:${u.port}` : u.hostname;
    } catch {
      return nodeUrl;
    }
  })();

  const [namespaces, setNamespaces] = useState<NamespaceRow[]>([]);
  const [listing, setListing] = useState(true);
  const [name, setName] = useState("");
  const [joinCode, setJoinCode] = useState("");

  // One key names the action in flight ("create", "join", `invite:<id>`), instead
  // of a single `busy` boolean. With a boolean, clicking Invite disabled Create,
  // Join and every row, and all of them read "Working…" — indistinguishable from
  // the page having locked up.
  const [pending, setPending] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<{ id: string; code: string } | null>(
    null,
  );
  // The space pending deletion. A confirm step rather than `confirm()`, because
  // this takes every forum in the space with it and the sentence has to say so.
  // Which card's menu is open. mero-design keys this by id and closes on an
  // outside click via a ref on the OPEN card only — same shape here.
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [pendingDelete, setPendingDelete] = useState<NamespaceRow | null>(null);
  const deleteDialogRef = useRef<HTMLDialogElement | null>(null);

  /**
   * Run one action under its own key, with step status wired to `onStatus`.
   * Clears the previous outcome first: leaving a stale "Joined ✓" above a fresh
   * spinner reads as if the new action had already finished.
   */
  const run = useCallback(
    async (
      key: string,
      fn: (onStatus: (m: string) => void) => Promise<void>,
    ) => {
      setPending(key);
      setError(null);
      setStatus(null);
      try {
        await fn(setStatus);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setPending(null);
        setStatus(null);
      }
    },
    [],
  );

  const load = useCallback(
    async (showSpinner = true) => {
      if (!mero || !appId) {
        setListing(false);
        return;
      }
      if (showSpinner) setListing(true);
      try {
        setNamespaces(await listSpaceNamespaces(mero.admin, appId));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load spaces.");
      } finally {
        setListing(false);
      }
    },
    [mero, appId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Close an open card menu on an outside click. The ref is attached to the
  // OPEN card only (see the grid below), so this compares against one node
  // rather than tracking every card.
  useEffect(() => {
    if (!menuOpenId) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpenId(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpenId]);

  const create = useCallback(() => {
    const spaceName = name.trim();
    if (!spaceName || !mero) return;
    if (!appId) {
      setError(
        "Missing application id — reopen Mero Forum from the desktop app.",
      );
      return;
    }
    void run("create", async (onStatus) => {
      const { namespaceId } = await createSpaceNamespace(
        mero.admin,
        { applicationId: appId, name: spaceName },
        onStatus,
      );
      setName("");
      onStatus("Refreshing your spaces…");
      await load(false);
      // Straight into the new namespace: it has no forums yet, and making one is
      // the only useful next step.
      navigate(`/spaces/${namespaceId}`);
    });
  }, [name, mero, appId, run, load, navigate]);

  const mintInvite = useCallback(
    (ns: NamespaceRow) => {
      if (!mero) return;
      void run(`invite:${ns.namespaceId}`, async (onStatus) => {
        const code = await mintNamespaceInvite(
          mero.admin,
          { namespaceId: ns.namespaceId, namespaceName: ns.name },
          onStatus,
        );
        setInvite({ id: ns.namespaceId, code });
        showToast(`Invite ready for “${ns.name}”.`);
      });
    },
    [mero, run, showToast],
  );

  const removeSpace = useCallback(
    (ns: NamespaceRow) => {
      if (!mero) return;
      setPendingDelete(null);
      void run(`delete:${ns.namespaceId}`, async (onStatus) => {
        await deleteSpace(
          mero.admin,
          { namespaceId: ns.namespaceId },
          onStatus,
        );
        onStatus("Refreshing your spaces…");
        await load(false);
        showToast(`Deleted \u201c${ns.name}\u201d.`);
      });
    },
    [mero, run, load, showToast],
  );

  /**
   * Accept any code: a namespace invite, or a forum invite (which carries the
   * namespace invitation too, so someone with no prior membership gets both joins
   * from one paste). A forum code that names its context takes you into the forum.
   */
  const acceptCode = useCallback(
    (raw: string) => {
      if (!mero) return;
      // Accept a LINK pasted into the code field, not just a code. People paste
      // whatever they were sent, and the two are indistinguishable to them —
      // rejecting a link here would be the app refusing its own invitation.
      // Accepts a platform link, a `calimero://` deep link, this app's older
      // `?invite=` link, or the bare code — people paste whatever they were sent.
      const candidate = invitationFromRaw(raw) ?? raw;
      const payload = decodeInvite(candidate);
      if (!payload) {
        setError(
          "That invite is not valid. If you pasted a code, paste the whole thing — it is one long line with no spaces.",
        );
        return;
      }
      void run("join", async (onStatus) => {
        // Shared with the app-level link prompt, so the two cannot drift. A forum
        // invitation needs BOTH joins — the namespace grant and the forum's
        // context — and this sequence is where that lives.
        const landed = await redeemInvite(mero.admin, payload, onStatus);
        setJoinCode("");
        onStatus("Refreshing your spaces…");
        await load(false);

        if (landed.kind === "forum") {
          if (landed.forumName)
            setForumName(landed.contextId, landed.forumName);
          setActiveForum(landed.contextId, landed.identity, landed.namespaceId);
          navigate("/f");
          return;
        }
        if (landed.kind === "namespace") {
          navigate(`/spaces/${landed.namespaceId}`);
          return;
        }
        showToast("Joined. Your spaces are listed below.");
      });
    },
    [mero, run, load, navigate, showToast],
  );

  useDialogOpen(deleteDialogRef, !!pendingDelete);

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <span className={styles.logo}>Mero Forum</span>
        <div className={styles.headerRight}>
          <span className={styles.nodeTag}>{nodeLabel}</span>
          <button className={styles.logoutBtn} onClick={logout}>
            Logout
          </button>
        </div>
      </header>

      <main className={styles.main}>
        <h1 className={styles.title}>Your Spaces</h1>

        <div className={styles.createRow}>
          <input
            className={styles.input}
            placeholder="New space name…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            data-testid="space-name-input"
            onKeyDown={(e) => {
              if (e.key === "Enter" && name.trim()) create();
            }}
          />
          <button
            className={styles.btn}
            onClick={create}
            disabled={pending === "create" || !name.trim() || !appId}
            data-testid="create-space"
          >
            {pending === "create" ? "Creating…" : "Create"}
          </button>
        </div>

        {status && <p className={styles.empty}>{status}</p>}
        {error && <p className={styles.joinError}>{error}</p>}

        {notInstalled && (
          <p className={styles.empty}>
            Mero Forum is not installed on this node. Install it from the
            marketplace, then reload — spaces are listed per application.
          </p>
        )}

        {listing || resolvingAppId ? (
          <p className={styles.empty}>Loading…</p>
        ) : namespaces.length === 0 ? (
          !notInstalled && (
            <p className={styles.empty} data-testid="spaces-empty">
              No spaces yet. Create one above.
            </p>
          )
        ) : (
          <div className={styles.grid}>
            {namespaces.map((ns) => (
              <div
                key={ns.namespaceId}
                className={styles.cardWrap}
                ref={menuOpenId === ns.namespaceId ? menuRef : null}
              >
                <button
                  className={styles.card}
                  data-testid="space-row"
                  onClick={() => navigate(`/spaces/${ns.namespaceId}`)}
                >
                  <span className={styles.cardName}>{ns.name}</span>
                  <span className={styles.cardSub}>
                    {ns.forumCount} forum{ns.forumCount === 1 ? "" : "s"} ·{" "}
                    {ns.memberCount} member{ns.memberCount === 1 ? "" : "s"}
                  </span>
                </button>
                <button
                  className={styles.menuBtn}
                  data-testid="space-menu"
                  title="More options"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpenId(
                      menuOpenId === ns.namespaceId ? null : ns.namespaceId,
                    );
                  }}
                >
                  ⋯
                </button>
                {menuOpenId === ns.namespaceId && (
                  <div className={styles.dropdown}>
                    <button
                      className={styles.dropdownItem}
                      onClick={() => {
                        setMenuOpenId(null);
                        mintInvite(ns);
                      }}
                      data-testid="invite-btn"
                    >
                      Invite
                    </button>
                    <button
                      className={`${styles.dropdownItem} ${styles.dropdownDanger}`}
                      onClick={() => {
                        setMenuOpenId(null);
                        setPendingDelete(ns);
                      }}
                      data-testid="delete-space"
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className={styles.joinSection}>
          <p className={styles.joinLabel}>Got an invitation? Join a space!</p>
          <div className={styles.joinRow}>
            <input
              className={styles.input}
              placeholder="Paste an invitation link or code…"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              data-testid="join-input"
              onKeyDown={(e) => {
                if (e.key === "Enter" && joinCode.trim()) acceptCode(joinCode);
              }}
            />
            <button
              className={styles.btn}
              onClick={() => acceptCode(joinCode)}
              disabled={pending === "join" || !joinCode.trim()}
              data-testid="join-btn"
            >
              {pending === "join" ? "Joining…" : "Join"}
            </button>
          </div>
        </div>
      </main>

      {/* A confirm step rather than `window.confirm`: deleting a space deletes
          every forum in it, for everyone, and a native dialog has no room to
          say so. */}
      <dialog
        ref={deleteDialogRef}
        className={styles.confirmDialog}
        onClose={() => setPendingDelete(null)}
      >
        <h2 className={styles.confirmTitle}>Delete this space?</h2>
        <p className={styles.confirmText}>
          <strong>{pendingDelete?.name}</strong> and the{" "}
          <strong>
            {pendingDelete?.forumCount ?? 0} forum
            {pendingDelete?.forumCount === 1 ? "" : "s"}
          </strong>{" "}
          inside it will be deleted, with every post and comment in them. This
          happens for everyone in the space, not just on this node, and it
          cannot be undone.
        </p>
        <div className={styles.confirmRow}>
          <button
            className={`${styles.btn} ${styles.btnDanger}`}
            onClick={() => pendingDelete && removeSpace(pendingDelete)}
            disabled={pending === `delete:${pendingDelete?.namespaceId}`}
            data-testid="confirm-delete-space"
          >
            Delete
          </button>
          <button
            className={styles.logoutBtn}
            onClick={() => setPendingDelete(null)}
          >
            Cancel
          </button>
        </div>
      </dialog>

      <InviteModal
        open={!!invite}
        code={invite?.code ?? ""}
        scope={`Whole space · ${namespaces.find((n) => n.namespaceId === invite?.id)?.name ?? ""}`}
        onClose={() => setInvite(null)}
      />
    </div>
  );
}
