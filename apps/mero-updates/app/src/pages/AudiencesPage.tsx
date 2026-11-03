import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { describeError } from "@calimero-apps/connect";
import { useToast } from "../contexts/ToastContext";
import { setActiveAudience, setAudienceName } from "../lib/active";
import {
  createAudience,
  inviteLink,
  isAdminRole,
  listAudiences,
  mintInvite,
  readCompany,
  type AudienceRow,
} from "../lib/companies";
import { useSignedIn } from "../lib/sessionContext";
import InviteModal from "../components/InviteModal";
import { useDialogOpen } from "../hooks/useDialogOpen";
import AppHeader from "../components/AppHeader";
import LogoutButton from "../components/LogoutButton";
import {
  AlertIcon,
  ChevronRightIcon,
  CopyIcon,
  HashIcon,
  LayersIcon,
  MoreIcon,
  PlusIcon,
  TrashIcon,
  UserPlusIcon,
  UsersIcon,
} from "../components/icons";
import styles from "./AudiencesPage.module.css";

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
  const { client, accountId, source, passkey, after } = useSignedIn();
  const { showToast } = useToast();

  const [audiences, setAudiences] = useState<AudienceRow[]>([]);
  const [spaceAdmin, setSpaceAdmin] = useState(false);
  const [listing, setListing] = useState(true);
  const [nsName, setNsName] = useState("");
  const [memberCount, setMemberCount] = useState(0);
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
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AudienceRow | null>(null);
  const deleteDialogRef = useRef<HTMLDialogElement | null>(null);

  const run = useCallback(async (key: string, fn: (onStatus: (m: string) => void) => Promise<void>) => {
    setPending(key);
    setError(null);
    setStatus(null);
    try {
      await fn(setStatus);
    } catch (e) {
      setError(describeError(e));
    } finally {
      after();
      setPending(null);
      setStatus(null);
    }
  }, [after]);

  const load = useCallback(
    async (showSpinner = true) => {
      if (!namespaceId) return;
      if (showSpinner) setListing(true);
      try {
        const info = await readCompany(client, namespaceId).catch(() => null);
        setNsName((info?.name ?? "").trim() || `Company ${namespaceId.slice(0, 6)}`);
        setSpaceAdmin(isAdminRole(info?.roles.get(accountId)));
        setMemberCount(info?.roles.size ?? 0);
        setAudiences(await listAudiences(client, source, namespaceId));
      } catch (e) {
        setError(describeError(e));
      } finally {
        after();
        setListing(false);
      }
    },
    [client, source, namespaceId, accountId, after],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const open = useCallback(
    (contextId: string, audienceName: string) => {
      setAudienceName(contextId, audienceName);
      setActiveAudience(contextId, namespaceId);
      navigate("/a");
    },
    [namespaceId, navigate],
  );

  const create = useCallback(() => {
    const audienceName = name.trim();
    if (!audienceName) return;
    void run("create", async (onStatus) => {
      onStatus("Creating the audience…");
      const contextId = await createAudience(client, source, namespaceId, audienceName);
      setName("");
      open(contextId, audienceName);
    });
  }, [name, client, source, namespaceId, run, open]);

  /** Enter an audience: every member of the company reaches every audience in it. */
  const enter = useCallback((audience: AudienceRow) => open(audience.contextId, audience.name), [open]);

  const inviteToAudience = useCallback(
    (audience: AudienceRow) => {
      void run(`invite:${audience.contextId}`, async (onStatus) => {
        onStatus("Approve the invitation with your passkey…");
        const token = await mintInvite(client, namespaceId, passkey());
        setInvite({
          key: `audience:${audience.contextId}`,
          code: inviteLink(token, audience.contextId),
          scope: `Opens ${audience.name}`,
          hint: (
            <>
              Opening the link puts them straight into <strong>{audience.name}</strong>. Note what it
              grants: joining <strong>{nsName}</strong>, which makes every audience in it reachable —
              this is <em>not</em> narrower than the company link. It just lands them in this audience
              instead of the list.
            </>
          ),
        });
        showToast(`Invite ready for “${audience.name}”.`);
      });
    },
    [client, namespaceId, nsName, passkey, run, showToast],
  );

  const inviteToNamespace = useCallback(() => {
    void run("invite:namespace", async (onStatus) => {
      onStatus("Approve the invitation with your passkey…");
      const token = await mintInvite(client, namespaceId, passkey());
      setInvite({
        key: "namespace",
        code: inviteLink(token),
        scope: `Whole company · ${nsName}`,
        hint: (
          <>
            This link joins <strong>{nsName}</strong> and every audience in it, including audiences
            made later. It lands them on the audience list — to drop someone straight into one
            audience, use <strong>Invite</strong> on that audience.
          </>
        ),
      });
      showToast(`Invite ready for “${nsName}”.`);
    });
  }, [client, namespaceId, nsName, passkey, run, showToast]);

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
      setPendingDelete(null);
      void run(`delete:${audience.contextId}`, async (onStatus) => {
        onStatus("Deleting…");
        await client.deleteApp(audience.contextId);
        onStatus("Refreshing audiences…");
        await load(false);
        showToast(`Deleted \u201c${audience.name}\u201d.`);
      });
    },
    [client, run, load, showToast],
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
          {
            label: "Companies",
            onClick: () => navigate("/companies"),
            icon: <LayersIcon size={14} />,
          },
          { label: nsName || "Company" },
        ]}
        right={<LogoutButton />}
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
                not a wall. Every member of the company can open any of them. */}
            <p className={styles.sub} data-testid="audience-scope-note">
              An audience is a feed of updates. Everyone invited to this company
              can open every audience in it — for something confidential, like a
              board, create a separate company and invite only the board.
            </p>
          </div>
          <button
            className={`${styles.btn} ${styles.btnSecondary}`}
            onClick={inviteToNamespace}
            disabled={pending === "invite:namespace"}
            data-testid="invite-space"
          >
            <UserPlusIcon size={16} />
            {pending === "invite:namespace" ? "Inviting…" : "Invite people"}
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
              disabled={pending === "create" || !name.trim()}
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
          {!listing && audiences.length > 0 && (
            <span className={styles.count}>{audiences.length}</span>
          )}
        </div>

        {listing ? (
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
                key={audience.contextId}
                className={styles.cardWrap}
                ref={menuOpenId === audience.contextId ? menuRef : null}
              >
                <button
                  className={styles.card}
                  data-testid="audience-row"
                  onClick={() => enter(audience)}
                >
                  <span className={styles.cardTile} data-joined aria-hidden>
                    <HashIcon size={18} />
                  </span>
                  <span className={styles.cardText}>
                    <span className={styles.cardName}>{audience.name}</span>
                    <span className={styles.cardSub}>
                      <UsersIcon size={13} />
                      {`${memberCount} member${memberCount === 1 ? "" : "s"}`}
                    </span>
                  </span>
                  {pending === `enter:${audience.contextId}` ? (
                    <span className={styles.spinner} aria-hidden />
                  ) : (
                    <ChevronRightIcon
                      size={16}
                      className={styles.cardChevron}
                    />
                  )}
                </button>
                <button
                  className={styles.menuBtn}
                  data-testid="audience-menu"
                  title="More options"
                  aria-label="More options"
                  aria-expanded={menuOpenId === audience.contextId}
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpenId(
                      menuOpenId === audience.contextId
                        ? null
                        : audience.contextId,
                    );
                  }}
                >
                  <MoreIcon size={16} />
                </button>
                {menuOpenId === audience.contextId && (
                  <div
                    className={styles.dropdown}
                    role="menu"
                    onKeyDown={(e) => e.key === "Escape" && setMenuOpenId(null)}
                  >
                    <button
                      className={styles.dropdownItem}
                      data-testid="invite-audience"
                      onClick={() => {
                        setMenuOpenId(null);
                        inviteToAudience(audience);
                      }}
                    >
                      <UserPlusIcon size={15} />
                      Invite
                    </button>
                    <button
                      className={styles.dropdownItem}
                      onClick={() => {
                        setMenuOpenId(null);
                        copyId("Audience ID", audience.contextId);
                      }}
                    >
                      <CopyIcon size={15} />
                      Copy audience ID
                    </button>
                    {/* Its creator, or an admin of the company; anyone else is not offered it. */}
                    {(spaceAdmin || audience.owner === accountId) && (
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
                    <div
                      className={styles.dropdownMeta}
                      title={audience.contextId}
                    >
                      ID <code>{audience.contextId}</code>
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
          in it will be deleted. This happens for everyone in the company, and it
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
            onClick={() => pendingDelete && removeAudience(pendingDelete)}
            disabled={pending === `delete:${pendingDelete?.contextId}`}
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
