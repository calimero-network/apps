import { useCallback, useEffect, useRef, useState } from "react";
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
  const { mero, logout } = useMero();
  const { showToast } = useToast();
  // Resolved from the NODE by package, not from the session — see lib/appId.
  const { appId } = useApplicationId();

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
      if (!mero || !namespaceId) return;
      if (showSpinner) setListing(true);
      try {
        // The namespace's own name for the header, so the page says which space
        // you are in rather than a truncated id.
        const info = await mero.admin
          .getNamespace(namespaceId)
          .catch(() => null);
        setNsName(
          (info?.name ?? "").trim() || `Space ${namespaceId.slice(0, 6)}`,
        );
        setAudiences(await listAudiences(mero.admin, namespaceId));
        // A real answer, empty or not — that is what ends the sync gate.
        setListedForNs(namespaceId);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load audiences.");
      } finally {
        setListing(false);
      }
    },
    [mero, namespaceId],
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
    if (!audienceName || !mero) return;
    if (!appId) {
      setError(
        "Missing application id — reopen Mero Updates from the desktop app.",
      );
      return;
    }
    void run("create", async (onStatus) => {
      const { contextId, memberPublicKey } = await createAudience(
        mero.admin,
        { applicationId: appId, namespaceId, name: audienceName },
        onStatus,
      );
      setAudienceName(contextId, audienceName);
      setName("");
      setActiveAudience(contextId, memberPublicKey, namespaceId);
      // Into the audience: the creator is already a member, so there is nothing to wait
      // for. 480p H.264 (/live), not the 64x48 in-WASM comparison route.
      navigate("/a");
    });
  }, [name, mero, appId, namespaceId, run, navigate]);

  /** Enter an audience: join it if needed, wait for the identity, then open the audience. */
  const enter = useCallback(
    (audience: AudienceRow) => {
      if (!mero) return;
      if (!audience.contextId) {
        setError(
          `“${audience.name}” has no audience context on this node yet. It may still be replicating — refresh in a moment.`,
        );
        return;
      }
      const contextId = audience.contextId;
      void run(`enter:${audience.audienceId}`, async (onStatus) => {
        const identity = await enterAudienceContext(
          mero.admin,
          { audienceId: audience.audienceId, contextId },
          onStatus,
        );
        setAudienceName(contextId, audience.name);
        setActiveAudience(contextId, identity, namespaceId);
        navigate("/a");
      });
    },
    [mero, run, navigate, namespaceId],
  );

  const inviteToAudience = useCallback(
    (audience: AudienceRow) => {
      if (!mero) return;
      void run(`invite:${audience.audienceId}`, async (onStatus) => {
        const code = await mintAudienceInvite(
          mero.admin,
          {
            namespaceId,
            audienceId: audience.audienceId,
            audienceName: audience.name,
            namespaceName: nsName,
            contextId: audience.contextId,
          },
          onStatus,
        );
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
    [mero, namespaceId, nsName, run, showToast],
  );

  const inviteToNamespace = useCallback(() => {
    if (!mero) return;
    void run("invite:namespace", async (onStatus) => {
      const code = await mintNamespaceInvite(
        mero.admin,
        { namespaceId, namespaceName: nsName },
        onStatus,
      );
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
  }, [mero, namespaceId, nsName, run, showToast]);

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
      if (!mero) return;
      setPendingDelete(null);
      void run(`delete:${audience.audienceId}`, async (onStatus) => {
        await deleteAudience(
          mero.admin,
          { audienceId: audience.audienceId, contextId: audience.contextId },
          onStatus,
        );
        onStatus("Refreshing audiences…");
        await load(false);
        showToast(`Deleted \u201c${audience.name}\u201d.`);
      });
    },
    [mero, run, load, showToast],
  );

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <button className={styles.back} onClick={() => navigate("/companies")}>
          ← Spaces
        </button>
        <span className={styles.logo}>{nsName || "Space"}</span>
        <div className={styles.headerRight}>
          <button
            className={styles.logoutBtn}
            onClick={inviteToNamespace}
            disabled={pending === "invite-ns"}
            data-testid="invite-space"
          >
            {pending === "invite-ns" ? "Inviting…" : "Invite"}
          </button>
          <button className={styles.logoutBtn} onClick={logout}>
            Logout
          </button>
        </div>
      </header>

      <main className={styles.main}>
        <h1 className={styles.title}>Audiences</h1>
        {/* Said on the page because it is the one thing a founder would
            otherwise assume wrong: an audience here is a FILTER for attention,
            not a wall. Audiences are open subgroups, so a member of the company
            can open any of them. */}
        <p className={styles.empty} data-testid="audience-scope-note">
          An audience is a feed of updates. Everyone invited to this company
          can open every audience in it — for something confidential, like a
          board, create a separate company and invite only the board.
        </p>

        <div className={styles.createRow}>
          <input
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
            {pending === "create" ? "Creating…" : "Create"}
          </button>
        </div>

        {status && <p className={styles.empty}>{status}</p>}
        {error && <p className={styles.joinError}>{error}</p>}

        {isSyncing ? (
          <JoinSyncBanner show what="audiences" onDismiss={dismissSyncing} />
        ) : listing ? (
          <p className={styles.empty}>Loading…</p>
        ) : audiences.length === 0 ? (
          <p className={styles.empty} data-testid="audiences-empty">
            No audiences yet. Most companies start with one called
            “All investors”.
          </p>
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
                  <span className={styles.cardName}>{audience.name}</span>
                  <span className={styles.cardSub}>
                    {audience.contextId
                      ? `${audience.memberCount} member${audience.memberCount === 1 ? "" : "s"}${audience.joined ? "" : " · not joined"}`
                      : "syncing…"}
                  </span>
                </button>
                <button
                  className={styles.menuBtn}
                  data-testid="audience-menu"
                  title="More options"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpenId(
                      menuOpenId === audience.audienceId ? null : audience.audienceId,
                    );
                  }}
                >
                  ⋯
                </button>
                {menuOpenId === audience.audienceId && (
                  <div className={styles.dropdown}>
                    <button
                      className={styles.dropdownItem}
                      data-testid="invite-audience"
                      onClick={() => {
                        setMenuOpenId(null);
                        inviteToAudience(audience);
                      }}
                    >
                      Invite
                    </button>
                    <button
                      className={`${styles.dropdownItem} ${styles.dropdownDanger}`}
                      data-testid="delete-audience"
                      onClick={() => {
                        setMenuOpenId(null);
                        setPendingDelete(audience);
                      }}
                    >
                      Delete
                    </button>
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
        <h2 className={styles.confirmTitle}>Delete this audience?</h2>
        <p className={styles.confirmText}>
          <strong>{pendingDelete?.name}</strong> and every update, reply and ask
          in it will be deleted. This happens for everyone in the company, not
          just on this node, and it cannot be undone.
        </p>
        <div className={styles.confirmRow}>
          <button
            className={`${styles.btn} ${styles.btnDanger}`}
            onClick={() => pendingDelete && removeAudience(pendingDelete)}
            disabled={pending === `delete:${pendingDelete?.audienceId}`}
            data-testid="confirm-delete-audience"
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
        scope={invite?.scope ?? ""}
        onClose={() => setInvite(null)}
      />
    </div>
  );
}
