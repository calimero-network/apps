import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMero } from "@calimero-network/mero-react";
import { useApplicationId } from "../hooks/useApplicationId";
import { useToast } from "../contexts/ToastContext";
import { setActiveAudience, setAudienceName } from "../lib/session";
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
import { hostingProblem } from "../lib/hosting";
import AppHeader from "../components/AppHeader";
import {
  AlertIcon,
  ChevronRightIcon,
  CopyIcon,
  InfoIcon,
  LayersIcon,
  LinkIcon,
  LogOutIcon,
  MoreIcon,
  PlusIcon,
  TrashIcon,
  UserPlusIcon,
} from "../components/icons";
import styles from "./CompaniesPage.module.css";

/**
 * Spaces = NAMESPACES. One level up from where this page used to sit.
 *
 * It used to list contexts and name each one a "space", which collapsed two
 * distinct things into one and left no audience for audiences: creating a space made a
 * namespace plus a context and nothing could ever add a second audience to it. The
 * model that actually matches Calimero, and what the two-node suite proves:
 *
 *   Namespace ("space")  ← you invite people HERE
 *     └── Subgroup ("audience") + Context   ← one board   → /companies/:id
 *
 * So: this page creates namespaces, invites to namespaces, and accepts any invite
 * code. Audiences live on AudiencesPage.
 *
 * Invite codes are the SAME format mero-chat and mero-blocks use — one base58
 * token of deflated JSON (lib/inviteCodec) — so a code minted by any of them
 * decodes here, and a code from here pastes into a chat window without being
 * mangled.
 */
export default function CompaniesPage() {
  const navigate = useNavigate();
  // `admin`, never `mero.admin`: the session-aware admin. On a node login it is
  // the node's own client; on an account (delegated) session it is the account
  // admin, which carries creates and joins through the relay. The raw client's
  // admin is the relay's NODE route there, and an account's token gets 403 from
  // every write on it — which is how this page used to sit on "Creating…".
  const { admin, isDelegated, logout, nodeUrl } = useMero();
  const { showToast } = useToast();
  // Resolved from the NODE by package (or the registry, for an account) — see
  // lib/appId and hooks/useApplicationId.
  const { appId, resolving: resolvingAppId, notInstalled } = useApplicationId();
  // Which spaces nobody can be invited to, and why — see lib/hosting. Learned
  // from the create call (`haError`) or from a refused mint, and re-read after
  // either so the Invite buttons update without a reload.
  const [hostingVersion, setHostingVersion] = useState(0);
  const hostingNote = useCallback(
    (namespaceId: string) => hostingProblem(namespaceId),
    // The version is the dependency on purpose: the store is outside React.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hostingVersion],
  );
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
  // this takes every audience in the space with it and the sentence has to say so.
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
      if (!admin || !appId) {
        setListing(false);
        return;
      }
      if (showSpinner) setListing(true);
      try {
        setNamespaces(await listSpaceNamespaces(admin, appId));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load companies.");
      } finally {
        setListing(false);
      }
    },
    [admin, appId],
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
    if (!spaceName || !admin) return;
    if (!appId) {
      setError(
        "Missing application id — reopen Mero Updates from the desktop app.",
      );
      return;
    }
    void run("create", async (onStatus) => {
      const created = await createSpaceNamespace(
        admin,
        { applicationId: appId, name: spaceName },
        onStatus,
      );
      setName("");
      onStatus("Refreshing your companies…");
      await load(false);
      setHostingVersion((v) => v + 1);
      if (!created.haEnabled) {
        // The space exists and the founder can use it; what will NOT work is
        // inviting, and the person is told now — on this screen, right after
        // creating — rather than by a failed Invite on the next page.
        showToast(created.haError ?? "This company is not hosted yet — nobody can be invited to it.", "error");
      }
      // Straight into the new namespace: it has no audiences yet, and making one is
      // the only useful next step.
      navigate(`/companies/${created.namespaceId}`);
    });
  }, [name, admin, appId, run, load, navigate, showToast]);

  const mintInvite = useCallback(
    (ns: NamespaceRow) => {
      if (!admin) return;
      void run(`invite:${ns.namespaceId}`, async (onStatus) => {
        try {
          const code = await mintNamespaceInvite(
            admin,
            { namespaceId: ns.namespaceId, namespaceName: ns.name },
            onStatus,
          );
          setInvite({ id: ns.namespaceId, code });
          showToast(`Invite ready for “${ns.name}”.`);
        } finally {
          // A refused mint records the space as unhosted (lib/groups); a
          // successful one clears nothing, but re-reading is cheap and keeps
          // the buttons honest either way.
          setHostingVersion((v) => v + 1);
        }
      });
    },
    [admin, run, showToast],
  );

  const removeSpace = useCallback(
    (ns: NamespaceRow) => {
      if (!admin) return;
      setPendingDelete(null);
      void run(`delete:${ns.namespaceId}`, async (onStatus) => {
        await deleteSpace(
          admin,
          { namespaceId: ns.namespaceId },
          onStatus,
        );
        onStatus("Refreshing your companies…");
        await load(false);
        showToast(`Deleted \u201c${ns.name}\u201d.`);
      });
    },
    [admin, run, load, showToast],
  );

  /**
   * Accept any code: a namespace invite, or an audience invite (which carries the
   * namespace invitation too, so someone with no prior membership gets both joins
   * from one paste). An audience code that names its context takes you into the audience.
   */
  const acceptCode = useCallback(
    (raw: string) => {
      if (!admin) return;
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
        // Shared with the app-level link prompt, so the two cannot drift. An audience
        // invitation needs BOTH joins — the namespace grant and the audience's
        // context — and this sequence is where that lives.
        const landed = await redeemInvite(admin, payload, onStatus);
        setJoinCode("");
        onStatus("Refreshing your companies…");
        await load(false);

        if (landed.kind === "audience") {
          if (landed.audienceName)
            setAudienceName(landed.contextId, landed.audienceName);
          setActiveAudience(landed.contextId, landed.identity, landed.namespaceId);
          navigate("/a");
          return;
        }
        if (landed.kind === "namespace") {
          navigate(`/companies/${landed.namespaceId}`);
          return;
        }
        showToast("Joined. Your companies are listed below.");
      });
    },
    [admin, run, load, navigate, showToast],
  );

  useDialogOpen(deleteDialogRef, !!pendingDelete);

  const copyId = (id: string) => {
    void navigator.clipboard
      ?.writeText(id)
      .then(() => showToast("Company ID copied."))
      .catch(() => showToast("Could not reach the clipboard.", "error"));
  };

  return (
    <div className={styles.root}>
      <AppHeader
        crumbs={[{ label: "Companies", icon: <LayersIcon size={14} /> }]}
        right={
          <>
            {nodeLabel && (
              <span className={styles.nodeTag} title={nodeUrl ?? undefined}>
                <span className={styles.nodeDot} aria-hidden />
                {nodeLabel}
              </span>
            )}
            <button className={styles.logoutBtn} onClick={logout} title="Sign out of this node">
              <LogOutIcon size={15} />
              Logout
            </button>
          </>
        }
      />

      <main className={styles.main}>
        <div className={styles.pageHead}>
          <div>
            <h1 className={styles.title}>Your companies</h1>
            <p className={styles.sub}>
              A company is a private space for investor relations. Invite someone once and they can read every
              audience inside it.
            </p>
          </div>
        </div>

        <section className={styles.createCard}>
          <label className={styles.label} htmlFor="new-company">
            New company
          </label>
          <div className={styles.createRow}>
            <input
              id="new-company"
              className={styles.input}
              placeholder="Your company’s name — e.g. Acme Inc."
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
              {pending !== "create" && <PlusIcon size={16} />}
              {pending === "create" ? "Creating…" : "Create"}
            </button>
          </div>
        </section>

        {status && (
          <p className={styles.status}>
            <span className={styles.spinner} aria-hidden />
            {status}
          </p>
        )}
        {error && (
          <p className={styles.joinError} role="alert">
            <AlertIcon size={15} />
            {error}
          </p>
        )}

        {notInstalled && (
          <p className={styles.notice}>
            <InfoIcon size={16} />
            Mero Updates is not installed on this node. Install it from the
            marketplace, then reload — companies are listed per application.
          </p>
        )}

        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Companies</h2>
          {!listing && namespaces.length > 0 && <span className={styles.count}>{namespaces.length}</span>}
        </div>

        {listing || resolvingAppId ? (
          <div className={styles.grid} aria-busy="true">
            <div className={styles.skeleton} />
            <div className={styles.skeleton} />
            <div className={styles.skeleton} />
          </div>
        ) : namespaces.length === 0 ? (
          !notInstalled && (
            <div className={styles.emptyCard} data-testid="spaces-empty">
              <span className={styles.emptyTile} aria-hidden>
                <LayersIcon size={20} />
              </span>
              <strong>No companies yet</strong>
              <span>
                Founders: create yours above. Investors: paste the invitation a founder sent you below.
              </span>
            </div>
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
                  onClick={() => navigate(`/companies/${ns.namespaceId}`)}
                >
                  <span className={styles.cardTile} aria-hidden>
                    <LayersIcon size={18} />
                  </span>
                  <span className={styles.cardText}>
                    <span className={styles.cardName}>{ns.name}</span>
                    <span className={styles.cardSub}>
                      {ns.audienceCount} audience{ns.audienceCount === 1 ? "" : "s"} ·{" "}
                      {ns.memberCount} member{ns.memberCount === 1 ? "" : "s"}
                    </span>
                  </span>
                  <ChevronRightIcon size={16} className={styles.cardChevron} />
                </button>
                <button
                  className={styles.menuBtn}
                  data-testid="space-menu"
                  title="More options"
                  aria-label="More options"
                  aria-expanded={menuOpenId === ns.namespaceId}
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpenId(
                      menuOpenId === ns.namespaceId ? null : ns.namespaceId,
                    );
                  }}
                >
                  <MoreIcon size={16} />
                </button>
                {menuOpenId === ns.namespaceId && (
                  <div
                    className={styles.dropdown}
                    role="menu"
                    onKeyDown={(e) => e.key === "Escape" && setMenuOpenId(null)}
                  >
                    {/* Gated on hosting: a space the cloud refused to host
                        cannot be invited to, and the button says why instead
                        of failing on the click. */}
                    <button
                      className={styles.dropdownItem}
                      onClick={() => {
                        setMenuOpenId(null);
                        mintInvite(ns);
                      }}
                      disabled={!!hostingNote(ns.namespaceId)}
                      title={hostingNote(ns.namespaceId) ?? undefined}
                      data-testid="invite-btn"
                    >
                      <UserPlusIcon size={15} />
                      {hostingNote(ns.namespaceId) ? "Invite (not hosted yet)" : "Invite"}
                    </button>
                    <button
                      className={styles.dropdownItem}
                      onClick={() => {
                        setMenuOpenId(null);
                        copyId(ns.namespaceId);
                      }}
                    >
                      <CopyIcon size={15} />
                      Copy company ID
                    </button>
                    {/* Deleting a namespace is a node's own operation — the
                        account admin refuses it by name (NotForAccountError).
                        Hidden rather than shown-and-failing. */}
                    {!isDelegated && (
                      <>
                        <div className={styles.dropdownSep} />
                        <button
                          className={`${styles.dropdownItem} ${styles.dropdownDanger}`}
                          onClick={() => {
                            setMenuOpenId(null);
                            setPendingDelete(ns);
                          }}
                          data-testid="delete-space"
                        >
                          <TrashIcon size={15} />
                          Delete
                        </button>
                      </>
                    )}
                    <div className={styles.dropdownMeta} title={ns.namespaceId}>
                      ID <code>{ns.namespaceId}</code>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <section className={styles.joinSection}>
          <span className={styles.joinTile} aria-hidden>
            <LinkIcon size={18} />
          </span>
          <div className={styles.joinBody}>
            <h2 className={styles.joinTitle}>Join with an invitation</h2>
            <p className={styles.joinLabel}>Invited by a founder? Paste the link to join their updates.</p>
            <div className={styles.joinRow}>
              <input
                className={styles.input}
                aria-label="Invitation link or code"
                placeholder="Paste an invitation link or code…"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                data-testid="join-input"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && joinCode.trim()) acceptCode(joinCode);
                }}
              />
              <button
                className={`${styles.btn} ${styles.btnSecondary}`}
                onClick={() => acceptCode(joinCode)}
                disabled={pending === "join" || !joinCode.trim()}
                data-testid="join-btn"
              >
                {pending === "join" ? "Joining…" : "Join"}
              </button>
            </div>
          </div>
        </section>
      </main>

      {/* A confirm step rather than `window.confirm`: deleting a space deletes
          every audience in it, for everyone, and a native dialog has no room to
          say so. */}
      <dialog
        ref={deleteDialogRef}
        className={styles.confirmDialog}
        onClose={() => setPendingDelete(null)}
      >
        <div className={styles.confirmHead}>
          <span className={styles.dangerTile} aria-hidden>
            <AlertIcon size={18} />
          </span>
          <h2 className={styles.confirmTitle}>Delete this company?</h2>
        </div>
        <p className={styles.confirmText}>
          <strong>{pendingDelete?.name}</strong> and the{" "}
          <strong>
            {pendingDelete?.audienceCount ?? 0} audience
            {pendingDelete?.audienceCount === 1 ? "" : "s"}
          </strong>{" "}
          inside it will be deleted, with every update, reply and ask in them. This
          happens for everyone in the company, not just on this node, and it
          cannot be undone.
        </p>
        <div className={styles.confirmRow}>
          <button
            className={`${styles.btn} ${styles.btnSecondary}`}
            onClick={() => setPendingDelete(null)}
          >
            Cancel
          </button>
          <button
            className={`${styles.btn} ${styles.btnDanger}`}
            onClick={() => pendingDelete && removeSpace(pendingDelete)}
            disabled={pending === `delete:${pendingDelete?.namespaceId}`}
            data-testid="confirm-delete-space"
          >
            Delete company
          </button>
        </div>
      </dialog>

      <InviteModal
        open={!!invite}
        code={invite?.code ?? ""}
        scope={`Whole company · ${namespaces.find((n) => n.namespaceId === invite?.id)?.name ?? ""}`}
        onClose={() => setInvite(null)}
      />
    </div>
  );
}
