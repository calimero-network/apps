import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMero } from "@calimero-network/mero-react";
import { useApplicationId } from "../hooks/useApplicationId";
import { useToast } from "../contexts/ToastContext";
import { setActiveAudience, setAudienceName } from "../lib/session";
import {
  createAudience,
  deleteAudience,
  enterAudienceContext,
  listAudiences,
  mintNamespaceInvite,
  mintAudienceInvite,
  type AudienceRow,
} from "../lib/groups";
import InviteModal from "../components/InviteModal";
import { useDialogOpen } from "../hooks/useDialogOpen";
import { hostingProblem } from "../lib/hosting";
import AppHeader from "../components/AppHeader";
import {
  AlertIcon,
  ChevronRightIcon,
  CopyIcon,
  HashIcon,
  LayersIcon,
  LogOutIcon,
  MoreIcon,
  PlusIcon,
  TrashIcon,
  UserPlusIcon,
  UsersIcon,
} from "../components/icons";
import styles from "./AudiencesPage.module.css";
import { JoinSyncBanner, useJoinSync } from "@calimero-apps/join-sync";

/**
 * Audiences inside one space (namespace). An audience is a SUBGROUP plus the context bound
 * to it, and that context is the board.
 *
 * The two things this page exists to make possible, both proven by suite S3/S4:
 *
 *   - A namespace can hold MORE THAN ONE audience. The old picker created a namespace
 *     and a single context together, so it could not.
 *   - An audience is joinable by someone who only holds the namespace, because it is
 *     created OPEN. Restricted is the default, and a restricted audience answers
 *     `join-via-inheritance` with 403 — invited members could see the space and
 *     never reach the audience.
 *
 * Two invite scopes are offered, and the difference is DESTINATION, not grant:
 * both codes join the space (audience access is inherited from it, so there is no
 * narrower grant to hand out — see `mintAudienceInvite`), but an audience code drops the
 * joiner straight into that audience while a space code leaves them on this list. The
 * hints say so rather than implying the audience code is more restrictive.
 */
export default function AudiencesPage() {
  const navigate = useNavigate();
  const { namespaceId = "" } = useParams();
  // `admin`, never `mero.admin`: the session-aware admin (see CompaniesPage).
  // On an account session the raw client's admin is the relay's node route and
  // answers 403 to every create and join.
  const { admin, isDelegated, logout } = useMero();
  const { showToast } = useToast();
  // Resolved from the NODE by package (or the registry, for an account) — see
  // lib/appId and hooks/useApplicationId.
  const { appId } = useApplicationId();
  // Whether anyone can be invited to this space — see lib/hosting. Re-read
  // after every mint, since a refused one is where the answer may change.
  const [hostingVersion, setHostingVersion] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const hostingNote = useMemo(() => hostingProblem(namespaceId), [namespaceId, hostingVersion]);

  const [audiences, setAudiences] = useState<AudienceRow[]>([]);
  /** The space whose audience list has come back at least once. */
  const [listedForNs, setListedForNs] = useState<string | null>(null);
  /** Contract roster per audience context, kept for the member counts on each row. */
  const [listing, setListing] = useState(true);
  const [nsName, setNsName] = useState("");
  const [name, setName] = useState("");

  const [pending, setPending] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<{
    key: string;
    code: string;
    scope: string;
    hint: React.ReactNode;
  } | null>(null);
  // The audience pending deletion. Its posts and comments go with it, for
  // everyone — a sentence `window.confirm` has no room for.
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AudienceRow | null>(null);
  const deleteDialogRef = useRef<HTMLDialogElement | null>(null);

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
      if (!admin || !namespaceId) return;
      if (showSpinner) setListing(true);
      try {
        // The namespace's own name for the header, so the page says which space
        // you are in rather than a truncated id.
        const info = await admin.getNamespace(namespaceId).catch(() => null);
        setNsName(
          (info?.name ?? "").trim() || `Space ${namespaceId.slice(0, 6)}`,
        );
        setAudiences(await listAudiences(admin, namespaceId));
        // A real answer, empty or not — that is what ends the sync gate.
        setListedForNs(namespaceId);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load audiences.");
      } finally {
        setListing(false);
      }
    },
    [admin, namespaceId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // A space joined this session whose audiences have not replicated yet. Without
  // this the branch below tells a brand-new member "No audiences yet. Create one
  // above." about a space that may be full of them.
  const { isSyncing, dismiss: dismissSyncing } = useJoinSync({
    namespaceId: namespaceId || null,
    settled: listedForNs === namespaceId,
  });

  const create = useCallback(() => {
    const audienceName = name.trim();
    if (!audienceName || !admin) return;
    if (!appId) {
      setError(
        "Missing application id — reopen Mero Updates from the desktop app.",
      );
      return;
    }
    void run("create", async (onStatus) => {
      // `identity`, not the create response's `memberPublicKey`: the account
      // admin returns "" there, and lib/groups re-reads the identity this
      // session actually holds in the new context.
      const { contextId, identity } = await createAudience(
        admin,
        { applicationId: appId, namespaceId, name: audienceName },
        onStatus,
      );
      setAudienceName(contextId, audienceName);
      setName("");
      setActiveAudience(contextId, identity, namespaceId);
      // Into the audience: the creator is already a member, so there is nothing to wait
      // for. 480p H.264 (/live), not the 64x48 in-WASM comparison route.
      navigate("/a");
    });
  }, [name, admin, appId, namespaceId, run, navigate]);

  /** Enter an audience: join it if needed, wait for the identity, then open the audience. */
  const enter = useCallback(
    (audience: AudienceRow) => {
      if (!admin) return;
      if (!audience.contextId) {
        setError(
          `“${audience.name}” has no audience context on this node yet. It may still be replicating — refresh in a moment.`,
        );
        return;
      }
      const contextId = audience.contextId;
      void run(`enter:${audience.audienceId}`, async (onStatus) => {
        const identity = await enterAudienceContext(
          admin,
          { audienceId: audience.audienceId, contextId },
          onStatus,
        );
        setAudienceName(contextId, audience.name);
        setActiveAudience(contextId, identity, namespaceId);
        navigate("/a");
      });
    },
    [admin, run, navigate, namespaceId],
  );

  const inviteToAudience = useCallback(
    (audience: AudienceRow) => {
      if (!admin) return;
      void run(`invite:${audience.audienceId}`, async (onStatus) => {
        const code = await mintAudienceInvite(
          admin,
          {
            namespaceId,
            audienceId: audience.audienceId,
            audienceName: audience.name,
            namespaceName: nsName,
            contextId: audience.contextId,
          },
          onStatus,
        ).finally(() => setHostingVersion((v) => v + 1));
        setInvite({
          key: `audience:${audience.audienceId}`,
          code,
          scope: `Opens ${audience.name}`,
          hint: (
            <>
              One paste puts them straight into <strong>{audience.name}</strong>.
              Note what it grants: joining <strong>{nsName}</strong>, which
              makes every audience in it reachable — access is inherited from
              the company, so this is <em>not</em> narrower than the company
              link. It just lands them in this audience instead of the list.
            </>
          ),
        });
        showToast(`Invite ready for “${audience.name}”.`);
      });
    },
    [admin, namespaceId, nsName, run, showToast],
  );

  const inviteToNamespace = useCallback(() => {
    if (!admin) return;
    void run("invite:namespace", async (onStatus) => {
      const code = await mintNamespaceInvite(
        admin,
        { namespaceId, namespaceName: nsName },
        onStatus,
      ).finally(() => setHostingVersion((v) => v + 1));
      setInvite({
        key: "namespace",
        code,
        scope: `Whole company · ${nsName}`,
        hint: (
          <>
            This link joins <strong>{nsName}</strong> and every audience in it,
            including audiences made later. It lands them on the audience list — to
            drop someone straight into one audience, use <strong>Invite</strong> on
            that audience.
          </>
        ),
      });
      showToast(`Invite ready for “${nsName}”.`);
    });
  }, [admin, namespaceId, nsName, run, showToast]);

  useDialogOpen(deleteDialogRef, !!pendingDelete);

  useEffect(() => {
    if (!menuOpenId) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpenId(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpenId]);

  const removeAudience = useCallback(
    (audience: AudienceRow) => {
      if (!admin) return;
      setPendingDelete(null);
      void run(`delete:${audience.audienceId}`, async (onStatus) => {
        await deleteAudience(
          admin,
          { audienceId: audience.audienceId, contextId: audience.contextId },
          onStatus,
        );
        onStatus("Refreshing audiences…");
        await load(false);
        showToast(`Deleted \u201c${audience.name}\u201d.`);
      });
    },
    [admin, run, load, showToast],
  );

  const copyId = (label: string, id: string) => {
    void navigator.clipboard
      ?.writeText(id)
      .then(() => showToast(`${label} copied.`))
      .catch(() => showToast("Could not reach the clipboard.", "error"));
  };

  return (
    <div className={styles.root}>
      <AppHeader
        crumbs={[
          { label: "Companies", onClick: () => navigate("/companies"), icon: <LayersIcon size={14} /> },
          { label: nsName || "Company" },
        ]}
        right={
          <button className={styles.logoutBtn} onClick={logout} title="Sign out of this node">
            <LogOutIcon size={15} />
            Logout
          </button>
        }
      />

      <main className={styles.main}>
        <div className={styles.pageHead}>
          <span className={styles.headTile} aria-hidden>
            <LayersIcon size={20} />
          </span>
          <div className={styles.headText}>
            <h1 className={styles.title}>{nsName || "Company"}</h1>
            {/* Said on the page because it is the one thing a founder would
                otherwise assume wrong: an audience here is a FILTER for attention,
                not a wall. Audiences are open subgroups, so a member of the company
                can open any of them. */}
            <p className={styles.sub} data-testid="audience-scope-note">
              An audience is a feed of updates. Everyone invited to this company
              can open every audience in it — for something confidential, like a
              board, create a separate company and invite only the board.
            </p>
          </div>
          {/* Gated on hosting: a space the cloud refused to host cannot be
              invited to (lib/hosting), and the button says so rather than
              failing on the click. */}
          <button
            className={`${styles.btn} ${styles.btnSecondary}`}
            onClick={inviteToNamespace}
            disabled={pending === "invite:namespace" || !!hostingNote}
            title={hostingNote ?? undefined}
            data-testid="invite-space"
          >
            <UserPlusIcon size={16} />
            {pending === "invite:namespace"
              ? "Inviting…"
              : hostingNote
                ? "Invite (not hosted yet)"
                : "Invite people"}
          </button>
        </div>

        <section className={styles.createCard}>
          <label className={styles.label} htmlFor="new-audience">
            New audience
          </label>
          <div className={styles.createRow}>
            <input
              id="new-audience"
              className={styles.input}
              placeholder="New audience — e.g. All investors, Angels, Advisors"
              value={name}
              onChange={(e) => setName(e.target.value)}
              data-testid="audience-name-input"
              onKeyDown={(e) => {
                if (e.key === "Enter" && name.trim()) create();
              }}
            />
            <button
              className={styles.btn}
              onClick={create}
              disabled={pending === "create" || !name.trim() || !appId}
              data-testid="create-audience"
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

        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Audiences</h2>
          {!listing && audiences.length > 0 && <span className={styles.count}>{audiences.length}</span>}
        </div>

        {isSyncing ? (
          <JoinSyncBanner show what="audiences" onDismiss={dismissSyncing} />
        ) : listing ? (
          <div className={styles.grid} aria-busy="true">
            <div className={styles.skeleton} />
            <div className={styles.skeleton} />
          </div>
        ) : audiences.length === 0 ? (
          <div className={styles.emptyCard} data-testid="audiences-empty">
            <span className={styles.emptyTile} aria-hidden>
              <HashIcon size={20} />
            </span>
            <strong>No audiences yet</strong>
            <span>Most companies start with one called “All investors”.</span>
          </div>
        ) : (
          <div className={styles.grid}>
            {audiences.map((audience) => (
              <div
                key={audience.audienceId}
                className={styles.cardWrap}
                ref={menuOpenId === audience.audienceId ? menuRef : null}
              >
                <button
                  className={styles.card}
                  data-testid="audience-row"
                  disabled={!audience.contextId}
                  onClick={() => enter(audience)}
                >
                  <span className={styles.cardTile} data-joined={audience.joined} aria-hidden>
                    <HashIcon size={18} />
                  </span>
                  <span className={styles.cardText}>
                    <span className={styles.cardName}>{audience.name}</span>
                    <span className={styles.cardSub}>
                      {audience.contextId ? (
                        <>
                          <UsersIcon size={13} />
                          {`${audience.memberCount} member${audience.memberCount === 1 ? "" : "s"}`}
                          {!audience.joined && <span className={styles.tag}>not joined</span>}
                        </>
                      ) : (
                        <>
                          <span className={styles.spinner} aria-hidden />
                          syncing…
                        </>
                      )}
                    </span>
                  </span>
                  {pending === `enter:${audience.audienceId}` ? (
                    <span className={styles.spinner} aria-hidden />
                  ) : (
                    <ChevronRightIcon size={16} className={styles.cardChevron} />
                  )}
                </button>
                <button
                  className={styles.menuBtn}
                  data-testid="audience-menu"
                  title="More options"
                  aria-label="More options"
                  aria-expanded={menuOpenId === audience.audienceId}
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpenId(
                      menuOpenId === audience.audienceId ? null : audience.audienceId,
                    );
                  }}
                >
                  <MoreIcon size={16} />
                </button>
                {menuOpenId === audience.audienceId && (
                  <div
                    className={styles.dropdown}
                    role="menu"
                    onKeyDown={(e) => e.key === "Escape" && setMenuOpenId(null)}
                  >
                    <button
                      className={styles.dropdownItem}
                      data-testid="invite-audience"
                      disabled={!!hostingNote}
                      title={hostingNote ?? undefined}
                      onClick={() => {
                        setMenuOpenId(null);
                        inviteToAudience(audience);
                      }}
                    >
                      <UserPlusIcon size={15} />
                      {hostingNote ? "Invite (not hosted yet)" : "Invite"}
                    </button>
                    {audience.contextId && (
                      <button
                        className={styles.dropdownItem}
                        onClick={() => {
                          setMenuOpenId(null);
                          copyId("Context ID", audience.contextId!);
                        }}
                      >
                        <CopyIcon size={15} />
                        Copy context ID
                      </button>
                    )}
                    {/* Deleting an audience deletes its context first, which
                        is a node's own operation — the account admin refuses
                        `deleteContext` by name. Hidden rather than failing. */}
                    {!isDelegated && (
                      <>
                        <div className={styles.dropdownSep} />
                        <button
                          className={`${styles.dropdownItem} ${styles.dropdownDanger}`}
                          data-testid="delete-audience"
                          onClick={() => {
                            setMenuOpenId(null);
                            setPendingDelete(audience);
                          }}
                        >
                          <TrashIcon size={15} />
                          Delete
                        </button>
                      </>
                    )}
                    <div className={styles.dropdownMeta} title={audience.audienceId}>
                      Group <code>{audience.audienceId}</code>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </main>

      <dialog
        ref={deleteDialogRef}
        className={styles.confirmDialog}
        onClose={() => setPendingDelete(null)}
      >
        <div className={styles.confirmHead}>
          <span className={styles.dangerTile} aria-hidden>
            <AlertIcon size={18} />
          </span>
          <h2 className={styles.confirmTitle}>Delete this audience?</h2>
        </div>
        <p className={styles.confirmText}>
          <strong>{pendingDelete?.name}</strong> and every update, reply and ask
          in it will be deleted. This happens for everyone in the company, not
          just on this node, and it cannot be undone.
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
            onClick={() => pendingDelete && removeAudience(pendingDelete)}
            disabled={pending === `delete:${pendingDelete?.audienceId}`}
            data-testid="confirm-delete-audience"
          >
            Delete audience
          </button>
        </div>
      </dialog>

      <InviteModal
        open={!!invite}
        code={invite?.code ?? ""}
        scope={invite?.scope ?? ""}
        onClose={() => setInvite(null)}
      />
    </div>
  );
}
