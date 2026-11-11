import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { describeError, otherOrgs, type OtherOrg } from "@calimero-apps/connect";
import { lastUsedName } from "@calimero-apps/names";
import { ConnectExistingOrg } from "@calimero-apps/passkey";
import { useToast } from "../contexts/ToastContext";
import {
  CONNECTED_AUDIENCE_NAME,
  createAudience,
  createCompany,
  setCompanyName,
  inviteLink,
  listCompanies,
  leaveCompany,
  leaveCompanyOrg,
  mintInvite,
  PRODUCT_NAME,
  type NamespaceRow,
} from "../lib/companies";
import { getUsername } from "../lib/active";
import { describeTarget } from "../lib/session";
import { useSignedIn } from "../lib/sessionContext";
import InviteModal from "../components/InviteModal";
import { useDialogOpen } from "../hooks/useDialogOpen";
import AppHeader from "../components/AppHeader";
import LogoutButton from "../components/LogoutButton";
import {
  AlertIcon,
  ChevronRightIcon,
  CopyIcon,
  LayersIcon,
  LogOutIcon,
  MoreIcon,
  PlusIcon,
  TrashIcon,
  UserPlusIcon,
} from "../components/icons";
import styles from "./CompaniesPage.module.css";
import { passkeyConfirm } from "@calimero-network/mero-js";

/**
 * Companies = ORGANIZATIONS. Each holds audiences (instances of this app),
 * listed on AudiencesPage. People are invited to a company, once, and can then
 * read every audience in it. Joining is not done here: an invitation reaches the
 * app as an opened link, and the app-level `InvitationPrompt` redeems it.
 */
export default function CompaniesPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { client, accountId, target, source, passkey, after } = useSignedIn();
  const { showToast } = useToast();
  const where = describeTarget(target);

  const [namespaces, setNamespaces] = useState<NamespaceRow[]>([]);
  const [listing, setListing] = useState(true);
  const [name, setName] = useState("");
  // Your name in the new company: asked here, once, and used by every
  // audience in it. Offered from the last company you named yourself in.
  const [selfName, setSelfName] = useState(() => lastUsedName() || getUsername());

  // One key names the action in flight ("create", `invite:<id>`), so clicking
  // Invite on one row does not read as the whole page locking up.
  const [pending, setPending] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<{ id: string; code: string; appOnly?: boolean } | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [pendingDelete, setPendingDelete] = useState<NamespaceRow | null>(null);
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
      if (showSpinner) setListing(true);
      try {
        setNamespaces(await listCompanies(client, source));
      } catch (e) {
        setError(describeError(e));
      } finally {
        after();
        setListing(false);
      }
    },
    [client, source, after],
  );

  // Keyed on the navigation too: a joined company lands on this page, which
  // React Router does not remount.
  useEffect(() => {
    void load();
  }, [load, location.key]);

  // Close an open card menu on an outside click.
  useEffect(() => {
    if (!menuOpenId) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpenId(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpenId]);

  const create = useCallback(() => {
    const companyName = name.trim();
    const yourName = selfName.trim();
    if (!companyName || !yourName) return;
    void run("create", async (onStatus) => {
      onStatus("Creating the company — approve with your passkey…");
      const created = await createCompany(client, companyName, passkey, source);
      // Best effort: the company exists either way, and its first audience
      // asks for the name once if this did not land.
      await setCompanyName(client, created.namespaceId, accountId, yourName).catch(() => {});
      setName("");
      if (created.warning) showToast(created.warning, "error");
      // Straight into it: it has no audiences yet, and making one is the next step.
      navigate(`/companies/${created.namespaceId}`);
    });
  }, [name, selfName, client, accountId, passkey, source, run, navigate, showToast]);

  // "Connect to an existing organization": an audience goes into an org the
  // account has for another app only on this explicit choice.
  const loadOtherOrgs = useCallback(async () => {
    try {
      return await otherOrgs(client, source);
    } finally {
      after();
    }
  }, [client, source, after]);
  const connectOrg = useCallback(
    async (org: OtherOrg) => {
      try {
        await createAudience(client, source, org.orgId, CONNECTED_AUDIENCE_NAME, passkey);
      } finally {
        after();
      }
      navigate(`/companies/${org.orgId}`);
    },
    [client, source, passkey, after, navigate],
  );

  const inviteTo = useCallback(
    (ns: NamespaceRow) => {
      void run(`invite:${ns.namespaceId}`, async (onStatus) => {
        onStatus("Approve the invitation with your passkey…");
        const { token, appOnly } = await mintInvite(client, ns.namespaceId, passkey(), source);
        setInvite({ id: ns.namespaceId, code: inviteLink(token, null, ns.namespaceId), appOnly });
        showToast(`Invite ready for “${ns.name}”.`);
      });
    },
    [client, passkey, source, run, showToast],
  );

  const removeSpace = useCallback(
    (ns: NamespaceRow) => {
      setPendingDelete(null);
      void run(`delete:${ns.namespaceId}`, async (onStatus) => {
        onStatus("Approve the deletion with your passkey…");
        await client.orgs.delete({ org: ns.namespaceId }, { confirm: passkeyConfirm(passkey()) });
        onStatus("Refreshing your companies…");
        await load(false);
        showToast(`Deleted \u201c${ns.name}\u201d.`);
      });
    },
    [client, passkey, run, load, showToast],
  );

  const exitSpace = useCallback(
    (ns: NamespaceRow) => {
      void run(`leave:${ns.namespaceId}`, async (onStatus) => {
        onStatus("Approve leaving with your passkey…");
        const left = await leaveCompany(client, ns.namespaceId, source, passkey, accountId);
        // An org that keeps its apps apart: Mero Updates only. When it was the
        // last app there, the organization itself is offered too.
        if (
          left.left === "app" &&
          left.lastApp &&
          window.confirm(`${PRODUCT_NAME} was your last app in this organization. Leave the organization too?`)
        ) {
          onStatus("Approve leaving the organization with your passkey…");
          await leaveCompanyOrg(client, ns.namespaceId, passkey, accountId);
        }
        onStatus("Refreshing your companies…");
        await load(false);
        showToast(`Left \u201c${ns.name}\u201d.`);
      });
    },
    [client, accountId, source, passkey, run, load, showToast],
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
            <span className={styles.nodeTag} title={where}>
              <span className={styles.nodeDot} aria-hidden />
              {where}
            </span>
            <LogoutButton />
          </>
        }
      />

      <main className={styles.main}>
        <div className={styles.pageHead}>
          <div>
            <h1 className={styles.title}>Your companies</h1>
            <p className={styles.sub}>
              A company is a private space for investor relations. Invite
              someone once and they can read every audience inside it.
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
                if (e.key === "Enter" && name.trim() && selfName.trim()) create();
              }}
            />
            <input
              className={styles.input}
              aria-label="Your name in this company"
              placeholder="Your name in this company"
              value={selfName}
              maxLength={64}
              onChange={(e) => setSelfName(e.target.value)}
              data-testid="self-name-input"
              onKeyDown={(e) => {
                if (e.key === "Enter" && name.trim() && selfName.trim()) create();
              }}
            />
            <button
              className={styles.btn}
              onClick={create}
              disabled={pending === "create" || !name.trim() || !selfName.trim()}
              data-testid="create-space"
            >
              {pending !== "create" && <PlusIcon size={16} />}
              {pending === "create" ? "Creating…" : "Create"}
            </button>
          </div>
          <ConnectExistingOrg appName="Mero Updates" load={loadOtherOrgs} onConnect={connectOrg} />
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
          <h2 className={styles.sectionTitle}>Companies</h2>
          {!listing && namespaces.length > 0 && (
            <span className={styles.count}>{namespaces.length}</span>
          )}
        </div>

        {listing ? (
          <div className={styles.grid} aria-busy="true">
            <div className={styles.skeleton} />
            <div className={styles.skeleton} />
            <div className={styles.skeleton} />
          </div>
        ) : namespaces.length === 0 ? (
          (
            <div className={styles.emptyCard} data-testid="spaces-empty">
              <span className={styles.emptyTile} aria-hidden>
                <LayersIcon size={20} />
              </span>
              <strong>No companies yet</strong>
              <span>
                Founders: create yours above. Investors: open the invitation
                link a founder sent you.
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
                      {ns.audienceCount} audience
                      {ns.audienceCount === 1 ? "" : "s"} · {ns.memberCount}{" "}
                      member{ns.memberCount === 1 ? "" : "s"}
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
                    <button
                      className={styles.dropdownItem}
                      onClick={() => {
                        setMenuOpenId(null);
                        inviteTo(ns);
                      }}
                      data-testid="invite-btn"
                    >
                      <UserPlusIcon size={15} />
                      Invite
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
                    {/* The owner deletes; anyone else leaves. */}
                    {ns.role === "owner" && (
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
                    {ns.role !== "owner" && (
                      <>
                        <div className={styles.dropdownSep} />
                        <button
                          className={`${styles.dropdownItem} ${styles.dropdownDanger}`}
                          onClick={() => {
                            setMenuOpenId(null);
                            exitSpace(ns);
                          }}
                          data-testid="leave-space"
                        >
                          <LogOutIcon size={15} />
                          Leave
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
      </main>

      {/* A confirm step rather than `window.confirm`: deleting a company deletes
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
          inside it will be deleted, with every update, reply and ask in them.
          This happens for everyone in the company, and it cannot be undone.
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
        appOnly={invite?.appOnly === true}
        onClose={() => setInvite(null)}
      />
    </div>
  );
}
