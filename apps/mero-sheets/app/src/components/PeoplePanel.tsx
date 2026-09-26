/**
 * PeoplePanel — who is in the workbook, and what each person may do.
 *
 * Two layers, shown side by side:
 *  - The workbook role (owner, editor, commenter, viewer), kept by the
 *    contract and enforced on every write. Owners set it.
 *  - Access to the workspace itself, which is core's group membership: an
 *    Admin manages people, a Member reads and writes, and Read only is refused
 *    by every node, not just this app. Removing someone takes them out of
 *    every spreadsheet in the workspace and rotates the group key, so they get
 *    nothing written after that.
 *
 * And an always-on copy: TEE replicas (hardware-attested, read-only nodes)
 * that admit themselves when their measurements match the workspace's
 * admission policy, so the data stays available while everyone is offline.
 */
import React, { useEffect, useState } from 'react';
import styled, { keyframes } from 'styled-components';
import { C } from '../theme';
import type { Member } from '../hooks/useSpreadsheet';
import { ROLE_HELP, WORKBOOK_ROLES } from '../spreadsheet/access';

/** One entry of core's group roster. */
export interface GroupPerson {
  identity: string;
  role: string;
}

const NETWORK_ROLES: { value: string; label: string }[] = [
  { value: 'Admin', label: 'Admin' },
  { value: 'Member', label: 'Member' },
  { value: 'ReadOnly', label: 'Read only' },
];

/** The workspace's rule for admitting always-on replicas. */
export interface ReplicaPolicy {
  /** Approved image measurements; none means no replica is admitted. */
  mrtd: string[];
  tcbStatuses: string[];
}

interface PeoplePanelProps {
  members: Member[];
  group: GroupPerson[];
  selfId: string | null;
  workspaceName: string;
  nameOf: (memberId: string) => string;
  /** This user may change workbook roles (an owner, or nobody owns it yet). */
  canManageRoles: boolean;
  /** This user administers the workspace group. */
  isGroupAdmin: boolean;
  onSetRole: (memberId: string, role: string) => Promise<void>;
  onSetGroupRole: (account: string, role: string) => Promise<void>;
  onRemove: (account: string) => Promise<void>;
  /** The replica admission policy, once read (null while unknown). */
  policy: ReplicaPolicy | null;
  onSetPolicy: (policy: ReplicaPolicy) => Promise<void>;
  onClose: () => void;
}

interface Row {
  key: string;
  member: Member | null;
  person: GroupPerson | null;
}

export default function PeoplePanel(props: PeoplePanelProps) {
  const { members, group, selfId, onClose } = props;
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Workbook members, matched to the group roster by account; then anyone in
  // the group who has not opened this workbook yet.
  const rows: Row[] = members.map((m) => ({
    key: m.id, member: m, person: group.find((g) => m.account && g.identity === m.account) ?? null,
  }));
  for (const g of group) {
    if (!rows.some((r) => r.person?.identity === g.identity)) rows.push({ key: g.identity, member: null, person: g });
  }

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    try { await fn(); } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  };

  return (
    <Overlay onClick={onClose} role="presentation">
      <Panel role="dialog" aria-modal="true" aria-label="People" onClick={(e) => e.stopPropagation()}>
        <Header>
          <span className="title">People</span>
          <CloseBtn onClick={onClose} aria-label="Close people">×</CloseBtn>
        </Header>
        {error && <Err role="alert">{error}</Err>}
        <List>
          {rows.map(({ key, member, person }) => {
            const self = !!member && member.id === selfId;
            const name = member ? props.nameOf(member.id) : `${person!.identity.slice(0, 8)}…`;
            return (
              <Item key={key} data-testid="item-Person">
                <div className="who">
                  <strong>{name}</strong>
                  {!member && <span className="sub">hasn&apos;t opened this workbook</span>}
                  {member?.account && !person && group.length > 0 && (
                    <span className="sub" data-testid="person-removed">no longer in the workspace</span>
                  )}
                </div>
                <div className="controls">
                  {member && (
                    <label>
                      <span>Workbook</span>
                      <select
                        value={member.role}
                        disabled={!props.canManageRoles}
                        title={ROLE_HELP[member.role as keyof typeof ROLE_HELP] ?? ''}
                        data-testid="field-workbook-role"
                        onChange={(e) => void run(() => props.onSetRole(member.id, e.target.value))}
                      >
                        {WORKBOOK_ROLES.map((r) => <option key={r} value={r}>{r[0].toUpperCase() + r.slice(1)}</option>)}
                      </select>
                    </label>
                  )}
                  {person && (
                    <label>
                      <span>Workspace</span>
                      <select
                        value={person.role}
                        disabled={!props.isGroupAdmin || self}
                        data-testid="field-network-role"
                        onChange={(e) => void run(() => props.onSetGroupRole(person.identity, e.target.value))}
                      >
                        {NETWORK_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                        {!NETWORK_ROLES.some((r) => r.value === person.role) && (
                          <option value={person.role}>{person.role === 'ReadOnlyTee' ? 'Always-on replica' : person.role}</option>
                        )}
                      </select>
                    </label>
                  )}
                  {person && props.isGroupAdmin && !self && (
                    <RemoveBtn type="button" onClick={() => setConfirming(person.identity)} data-testid="action-remove-member">
                      Remove
                    </RemoveBtn>
                  )}
                </div>
                {confirming === person?.identity && (
                  <Confirm role="alertdialog" aria-label={`Remove ${name}`}>
                    <p>
                      Remove {name} from every spreadsheet in {props.workspaceName}? They keep what they already
                      synced, but the group key rotates, so nothing written after this reaches them.
                    </p>
                    <div>
                      <button type="button" onClick={() => setConfirming(null)}>Cancel</button>
                      <button
                        type="button"
                        className="danger"
                        data-testid="action-confirm-remove"
                        onClick={() => void run(async () => { await props.onRemove(person.identity); setConfirming(null); })}
                      >
                        Remove
                      </button>
                    </div>
                  </Confirm>
                )}
              </Item>
            );
          })}
        </List>
        <AlwaysOn
          replicas={group.filter((g) => g.role === 'ReadOnlyTee').length}
          policy={props.policy}
          canEdit={props.isGroupAdmin}
          onSave={(p) => run(() => props.onSetPolicy(p))}
        />
        <Help>
          <p><b>Workbook</b> roles are this spreadsheet&apos;s: owners set them, and the contract checks every write.</p>
          <p><b>Workspace</b> access is the network&apos;s: <i>Read only</i> is refused by every node, and removing someone rotates the key.</p>
        </Help>
      </Panel>
    </Overlay>
  );
}

function AlwaysOn({ replicas, policy, canEdit, onSave }: {
  replicas: number;
  policy: ReplicaPolicy | null;
  canEdit: boolean;
  onSave: (p: ReplicaPolicy) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [mrtd, setMrtd] = useState('');
  const on = !!policy && policy.mrtd.length > 0;
  const lines = (s: string) => s.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
  return (
    <Section data-testid="always-on">
      <h4>Always-on copy</h4>
      <p>
        {replicas > 0
          ? `${replicas} always-on replica${replicas === 1 ? '' : 's'} hold${replicas === 1 ? 's' : ''} a read-only copy, so the workspace stays available while everyone is offline.`
          : 'No always-on replica yet: the workspace is available while at least one member is online.'}
      </p>
      <p className="muted">
        {policy === null ? 'Reading the admission policy…'
          : on ? `Replicas running one of ${policy.mrtd.length} approved image${policy.mrtd.length === 1 ? '' : 's'} admit themselves, read-only.`
            : 'Replicas are not admitted.'}
      </p>
      {canEdit && !editing && (
        <div className="row">
          <button type="button" onClick={() => { setMrtd((policy?.mrtd ?? []).join('\n')); setEditing(true); }} data-testid="action-edit-replicas">
            {on ? 'Change approved images' : 'Admit replicas…'}
          </button>
          {on && <button type="button" onClick={() => void onSave({ mrtd: [], tcbStatuses: [] })}>Stop admitting</button>}
        </div>
      )}
      {canEdit && editing && (
        <div>
          <label htmlFor="mrtd">Approved image measurements (MRTD), one per line, from your replica provider</label>
          <textarea id="mrtd" value={mrtd} onChange={(e) => setMrtd(e.target.value)} rows={3} data-testid="field-mrtd" />
          <div className="row">
            <button type="button" disabled={lines(mrtd).length === 0}
              onClick={() => void onSave({ mrtd: lines(mrtd), tcbStatuses: ['UpToDate'] }).then(() => setEditing(false))}
              data-testid="action-save-replicas">
              Admit
            </button>
            <button type="button" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      )}
    </Section>
  );
}

const slideIn = keyframes`from { transform: translateX(100%); opacity: 0; } to { transform: none; opacity: 1; }`;
const fadeIn = keyframes`from { opacity: 0; } to { opacity: 1; }`;

const Overlay = styled.div`
  position: fixed; inset: 0; z-index: 200;
  background: rgba(14, 20, 15, 0.3); backdrop-filter: blur(2px);
  animation: ${fadeIn} 0.18s ease;
  display: flex; justify-content: flex-end;
`;
const Panel = styled.div`
  width: 460px; max-width: 100vw; height: 100%;
  background: ${C.paper}; border-left: 1px solid ${C.line};
  display: flex; flex-direction: column;
  animation: ${slideIn} 0.22s cubic-bezier(0.22, 1, 0.36, 1);
  box-shadow: -20px 0 60px -20px rgba(14, 20, 15, 0.25);
`;
const Header = styled.div`
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 18px; border-bottom: 1px solid ${C.line};
  .title { font-size: 15px; font-weight: 700; color: ${C.ink}; }
`;
const CloseBtn = styled.button`
  width: 30px; height: 30px; font-size: 20px; color: ${C.mutedSoft};
  background: transparent; border: none; border-radius: 8px; cursor: pointer;
  &:hover { background: ${C.paper2}; color: ${C.ink}; }
`;
const Err = styled.p`margin: 0; padding: 8px 18px; font-size: 12.5px; color: ${C.danger}; border-bottom: 1px solid ${C.line};`;
const List = styled.ul`list-style: none; margin: 0; padding: 0; overflow-y: auto; flex: 1;`;
const Item = styled.li`
  padding: 12px 18px; border-bottom: 1px solid ${C.line}; font-size: 13px; color: ${C.ink};
  .who { display: flex; align-items: baseline; gap: 8px; margin-bottom: 8px; }
  .sub { font-size: 11.5px; color: ${C.mutedSoft}; }
  .controls { display: flex; align-items: end; gap: 10px; flex-wrap: wrap; }
  label { display: flex; flex-direction: column; gap: 3px; font-size: 10.5px; color: ${C.mutedSoft}; text-transform: uppercase; letter-spacing: 0.04em; }
  select {
    font-size: 12.5px; padding: 5px 8px; border-radius: 8px; text-transform: none; letter-spacing: 0;
    color: ${C.ink}; background: ${C.paper2}; border: 1px solid ${C.line};
    &:disabled { opacity: 0.6; }
  }
`;
const RemoveBtn = styled.button`
  margin-left: auto; font-size: 12px; padding: 5px 10px; border-radius: 8px; cursor: pointer;
  color: ${C.danger}; background: none; border: 1px solid ${C.line};
  &:hover { border-color: ${C.danger}; }
`;
const Confirm = styled.div`
  margin-top: 10px; padding: 10px 12px; border-radius: 10px; border: 1px solid ${C.danger};
  p { margin: 0 0 8px; font-size: 12.5px; line-height: 1.45; }
  div { display: flex; gap: 8px; justify-content: flex-end; }
  button { font-size: 12px; padding: 5px 10px; border-radius: 8px; cursor: pointer; background: none; border: 1px solid ${C.line}; color: ${C.ink}; }
  .danger { color: #fff; background: ${C.danger}; border-color: ${C.danger}; }
`;
const Section = styled.section`
  padding: 12px 18px; border-top: 1px solid ${C.line};
  h4 { margin: 0 0 6px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: ${C.mutedSoft}; }
  p { margin: 0 0 6px; font-size: 12.5px; line-height: 1.45; color: ${C.ink}; }
  .muted { color: ${C.muted}; }
  label { display: block; font-size: 11.5px; color: ${C.muted}; margin: 4px 0; }
  textarea { width: 100%; box-sizing: border-box; font: 11.5px ui-monospace, 'SF Mono', Menlo, monospace; color: ${C.ink}; background: ${C.paper2}; border: 1px solid ${C.line}; border-radius: 8px; padding: 6px 8px; }
  .row { display: flex; gap: 8px; margin-top: 6px; }
  button { font-size: 12px; padding: 5px 10px; border-radius: 8px; cursor: pointer; background: none; border: 1px solid ${C.line}; color: ${C.ink}; }
  button:disabled { opacity: 0.5; }
`;

const Help = styled.div`
  padding: 10px 18px 16px; border-top: 1px solid ${C.line};
  p { margin: 4px 0; font-size: 11.5px; line-height: 1.45; color: ${C.mutedSoft}; }
`;
