import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { tokens as t } from '../../theme';
import { truncateKey } from '../../utils/display';
import { describeError } from '../../utils/errors';
import AvatarGlyph from '../../components/AvatarGlyph';
import SetAliasModal from '../../components/SetAliasModal';
import MemberRoleControl from '../../components/MemberRoleControl';
import { effectiveFor } from '../../hooks/useMemberRoles';
import {
  CAP,
  ROLE_ADMIN,
  ROLE_MEMBER,
  canInvite,
  defaultIsUsable,
  describeCapabilities,
  isAdminRole,
  normaliseRole,
} from '../../utils/roles';
import { useAppCtx } from './appContext';

/**
 * Workspace members: who is in the namespace, what role they hold, and — the
 * part that actually matters — what each of them can DO.
 *
 * ── Why this page was rebuilt around the ACCOUNT ─────────────────────────────
 *
 * It used to render `[currentUser, ...members]`. `members` are ACCOUNTS (that is
 * what `listGroupMembers` keys rows by) while `currentUser` is the context
 * EXECUTOR key. Since rc.27 both are 64 hex and neither the client nor the node
 * objects to the wrong one, so the two never collided loudly — they just
 * produced a phantom extra row for the signed-in person, always rendered as a
 * truncated key because names are stored against the account, and never marked
 * "You" on their real row.
 *
 * Attaching a Role control to that list would have written promotions against a
 * principal that exists nowhere in the roster. So every row here is an account,
 * and the executor key does not appear on this page at all.
 *
 * ── Why a role badge alone would be a lie ────────────────────────────────────
 *
 * `Admin` bypasses the capability bitmask; `Member` is subject to it, via a
 * per-member override or, failing that, the group default. A page that showed
 * only the role would happily display "Member" for someone who can do nothing
 * whatsoever, which is exactly the state an unrepaired namespace leaves people
 * in. So each row states its effective permissions, read back from the node.
 */
export default function MembersPage(): React.ReactElement {
  const { members, aliases, openInvite, ws } = useAppCtx();
  const roles = ws.roles;
  const selfAccount = ws.selfIdentity ?? '';
  const [showAliasModal, setShowAliasModal] = useState(false);
  const [firstJoin, setFirstJoin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyAccount, setBusyAccount] = useState<string | null>(null);
  const [repairing, setRepairing] = useState(false);

  // Accounts only. `selfAccount` is included explicitly because the roster can
  // lag a fresh join by a refetch, and a person missing from their own member
  // list is alarming in a way the truth does not warrant.
  const accounts = useMemo(
    () => Array.from(new Set([selfAccount, ...members].filter(Boolean))),
    [selfAccount, members],
  );

  // Refresh the roster whenever this page is opened.
  //
  // The list is otherwise only refetched when a GroupMembership event arrives,
  // and an invited teammate who joins while you are looking at the board then
  // never appears here until you reload the whole app — the inviter's own
  // Members page kept showing one member while the node's roster already had
  // two. It is also what the Role control is gated on, so a stale list reads as
  // "promoting people does not work" rather than as "this list is old".
  //
  // Held in a ref because both callbacks are recreated on every render; this
  // must run on open and on workspace change, not on every paint.
  const refreshRef = useRef<() => void>(() => {});
  refreshRef.current = () => {
    void ws.refetchMembers();
    void roles.refetch();
  };
  useEffect(() => { refreshRef.current(); }, [ws.activeNs]);

  // One-shot nudge: once names have settled, prompt for one if this member has
  // none. Keyed by ACCOUNT, which is what member names are stored against.
  const promptedRef = useRef(false);
  useEffect(() => {
    if (promptedRef.current || !aliases.loaded || !selfAccount) return;
    promptedRef.current = true;
    if (!aliases.hasAlias(selfAccount)) {
      setFirstJoin(true);
      setShowAliasModal(true);
    }
  }, [aliases, selfAccount]);

  const run = useCallback(async (account: string, op: () => Promise<void>) => {
    setBusyAccount(account);
    setError(null);
    try {
      await op();
    } catch (err) {
      // Surfaced, never swallowed: the common failure is the node REFUSING a
      // promotion from someone without MANAGE_MEMBERS, and a silent failure
      // there is indistinguishable from success in the promoter's browser.
      setError(describeError(err));
    } finally {
      setBusyAccount(null);
    }
  }, []);

  const selfCanInvite = canInvite({
    role: roles.roles.get(selfAccount),
    override: roles.overrides.get(selfAccount),
    groupDefault: roles.defaultCapabilities,
  });

  // Only offered once the default has actually been READ (null means we could
  // not read it, and offering to repair an unknown is how you overwrite a
  // deliberate setting).
  const defaultNeedsRepair =
    roles.defaultCapabilities !== null && !defaultIsUsable(roles.defaultCapabilities);

  return (
    <Wrap>
      <Head>
        <h2>Members</h2>
        <div className="actions">
          <button
            className="secondary"
            data-testid="set-alias-btn"
            onClick={() => { setFirstJoin(false); setShowAliasModal(true); }}
          >
            Set my alias
          </button>
          <button
            className="primary"
            data-testid="open-invite-btn"
            onClick={openInvite}
            disabled={!selfCanInvite}
            title={selfCanInvite ? undefined : 'You do not have permission to invite people to this workspace.'}
          >
            Invite
          </button>
        </div>
      </Head>

      {defaultNeedsRepair && (
        <Notice data-testid="default-caps-notice">
          <div>
            <strong>New members join without permissions.</strong>
            <p>
              Anyone invited to this workspace will be able to open it but not add a
              repository or invite anyone else. This happens when the permission
              defaults could not be set when the workspace was created.
            </p>
          </div>
          {roles.canManageMembers && (
            <button
              className="fix"
              data-testid="repair-default-caps"
              disabled={repairing}
              onClick={() => {
                setRepairing(true);
                setError(null);
                void roles
                  .repairDefaultCapabilities()
                  .catch((err) => setError(describeError(err)))
                  .finally(() => setRepairing(false));
              }}
            >
              {repairing ? 'Fixing…' : 'Fix defaults'}
            </button>
          )}
        </Notice>
      )}

      {error && <ErrorBanner data-testid="members-error">{error}</ErrorBanner>}

      <Table>
        <Row className="head">
          <span>Member</span><span>Account</span><span>Role</span><span>Can</span>
        </Row>
        {accounts.map((account) => {
          const you = account === selfAccount;
          const hasAlias = aliases.hasAlias(account);
          const label = you ? 'You' : aliases.resolve(account);
          const role = roles.roles.get(account);
          const effective = effectiveFor(account, roles);
          const allowed = describeCapabilities(effective);
          return (
            <Row key={account} data-testid="member-row" data-account={account}>
              <span className="user">
                <AvatarGlyph
                  seed={hasAlias ? aliases.resolve(account) : account}
                  size="md"
                  keyFallback={!you && !hasAlias}
                />
                <span className={`alias${!you && !hasAlias ? ' faded' : ''}`}>{label}</span>
                {you && <span className="you-badge">You</span>}
              </span>
              <span className="key">{truncateKey(account)}</span>
              <span>
                <MemberRoleControl
                  account={account}
                  role={normaliseRole(role)}
                  isSelf={you}
                  canManage={roles.canManageMembers}
                  busy={busyAccount === account}
                  onChange={(next) => run(account, () => roles.setRole(account, next))}
                />
              </span>
              <span className="caps" data-testid="member-caps">
                {allowed.length > 0 ? (
                  allowed.map((c) => <em key={c}>{c}</em>)
                ) : (
                  <em className="none">Nothing yet</em>
                )}
                {/* Toggles only make sense for a Member: an Admin bypasses the
                    bitmask, so a switch here would appear to change something
                    and change nothing. */}
                {roles.canManageMembers && !isAdminRole(role) && (
                  <span className="toggles">
                    <CapToggle
                      label="Add repos"
                      bit={CAP.CAN_CREATE_CONTEXT}
                      effective={effective}
                      disabled={busyAccount === account}
                      onToggle={(next) => run(account, () => roles.setCapabilities(account, next))}
                    />
                    <CapToggle
                      label="Invite"
                      bit={CAP.CAN_INVITE_MEMBERS}
                      effective={effective}
                      disabled={busyAccount === account}
                      onToggle={(next) => run(account, () => roles.setCapabilities(account, next))}
                    />
                  </span>
                )}
              </span>
            </Row>
          );
        })}
      </Table>

      <Foot>
        {roles.defaultCapabilities !== null && (
          <span data-testid="default-caps-summary">
            New members get: {describeCapabilities(roles.defaultCapabilities).join(', ') || 'nothing'}.
          </span>
        )}
        <span>
          {ROLE_ADMIN}s can do everything in this workspace; {ROLE_MEMBER}s get the
          permissions above.
        </span>
      </Foot>

      {showAliasModal && selfAccount && (
        <SetAliasModal
          firstJoin={firstJoin}
          onSave={(alias) => aliases.setAlias(alias, selfAccount)}
          onClose={() => setShowAliasModal(false)}
        />
      )}
    </Wrap>
  );
}

/**
 * One permission switch, writing an explicit per-member override.
 *
 * The new mask is computed from the member's EFFECTIVE permissions, not from
 * their stored override — the override is normally `0`, meaning "inherit the
 * default", and `0 | bit` would quietly strip every other permission they had.
 */
function CapToggle({
  label,
  bit,
  effective,
  disabled,
  onToggle,
}: {
  label: string;
  bit: number;
  effective: number;
  disabled: boolean;
  onToggle: (nextMask: number) => void;
}): React.ReactElement {
  const on = (effective & bit) === bit;
  return (
    <button
      type="button"
      className={`toggle${on ? ' on' : ''}`}
      data-testid={`cap-toggle-${bit}`}
      aria-pressed={on}
      disabled={disabled}
      onClick={() => onToggle(on ? effective & ~bit : effective | bit)}
    >
      {on ? '✓' : '+'} {label}
    </button>
  );
}

const Wrap = styled.div`padding: 24px 24px 60px; overflow-y: auto; flex: 1;`;
const Head = styled.div`
  display: flex; align-items: center; margin-bottom: 18px; gap: 8px;
  h2 { font-size: 15px; font-weight: 600; margin: 0; }
  .actions { margin-left: auto; display: flex; gap: 8px; }
  button {
    border-radius: ${t.radius}; font-size: 12.5px; font-weight: 500; padding: 6px 11px;
    border: 1px solid ${t.color.border}; cursor: pointer;
  }
  .secondary { background: ${t.color.raised}; color: ${t.color.text}; &:hover:not(:disabled) { background: ${t.color.raised2}; } &:disabled { opacity: 0.5; cursor: default; } }
  .primary {
    background: ${t.color.accent}; color: ${t.color.onAccent}; border-color: transparent; font-weight: 600;
    &:hover:not(:disabled) { background: #b6ff5e; }
    &:disabled { opacity: 0.45; cursor: not-allowed; }
  }
`;
const Notice = styled.div`
  display: flex; gap: 14px; align-items: flex-start; margin-bottom: 14px;
  padding: 13px 15px; border-radius: 8px;
  border: 1px solid ${t.color.accentBorder}; background: ${t.color.accentDim};
  strong { font-size: 13px; font-weight: 600; display: block; margin-bottom: 3px; }
  p { margin: 0; font-size: 12.5px; line-height: 1.55; color: ${t.color.text2}; }
  .fix {
    margin-left: auto; flex: none; align-self: center; cursor: pointer;
    background: ${t.color.accent}; color: ${t.color.onAccent}; border: 1px solid transparent;
    border-radius: ${t.radius}; font-size: 12.5px; font-weight: 600; padding: 7px 13px;
    &:disabled { opacity: 0.6; cursor: default; }
  }
`;
const ErrorBanner = styled.div`
  margin-bottom: 14px; padding: 10px 14px; border-radius: 8px; font-size: 12.5px;
  border: 1px solid ${t.color.danger}; color: ${t.color.danger};
  background: ${t.color.panel};
`;
const Table = styled.div`
  width: 100%; border: 1px solid ${t.color.border}; border-radius: 8px;
  overflow: hidden; background: ${t.color.panel};
`;
const Row = styled.div`
  display: grid; grid-template-columns: 1.3fr 1.1fr 130px 1.5fr;
  align-items: center; gap: 12px; padding: 11px 16px;
  border-bottom: 1px solid ${t.color.border};
  &:last-child { border-bottom: none; }
  &.head { background: ${t.color.raised}; }
  &.head span { font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: ${t.color.text3}; font-weight: 600; }
  .user { display: flex; align-items: center; gap: 10px; }
  .alias { font-size: 13px; font-weight: 500; }
  .alias.faded { color: ${t.color.text3}; font-family: ${t.font.mono}; font-size: 12px; font-weight: 400; }
  .key { font-family: ${t.font.mono}; font-size: 12px; color: ${t.color.text2}; }
  .you-badge {
    font-size: 10.5px; color: ${t.color.accent}; border: 1px solid ${t.color.accentBorder};
    background: ${t.color.accentDim}; border-radius: 4px; padding: 1px 6px; font-weight: 600;
  }
  .caps { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; }
  .caps em {
    font-style: normal; font-size: 11px; padding: 2px 7px; border-radius: 4px;
    background: ${t.color.raised}; color: ${t.color.text2}; border: 1px solid ${t.color.border};
  }
  .caps em.none { color: ${t.color.text3}; font-style: italic; }
  .toggles { display: inline-flex; gap: 5px; margin-left: 4px; }
  .toggle {
    font-size: 11px; padding: 2px 7px; border-radius: 4px; cursor: pointer;
    border: 1px dashed ${t.color.border}; background: transparent; color: ${t.color.text3};
    &:hover:not(:disabled) { color: ${t.color.text}; border-color: ${t.color.borderStrong}; }
    &.on { border-style: solid; border-color: ${t.color.accentBorder}; color: ${t.color.accent}; }
    &:disabled { opacity: 0.5; cursor: default; }
  }
`;
const Foot = styled.div`
  display: flex; flex-direction: column; gap: 4px; margin-top: 12px;
  font-size: 12px; color: ${t.color.text3}; line-height: 1.5;
`;
