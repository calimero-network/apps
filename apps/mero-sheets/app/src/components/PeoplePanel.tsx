/**
 * PeoplePanel — who is in the workbook, and what each person may do.
 *
 * Two layers, shown side by side:
 *  - The workbook role (owner, editor, commenter, viewer), kept by the
 *    contract and enforced on every write. Owners set it.
 *  - Access to the workspace itself, which is the organization's membership:
 *    an Admin manages people, a Member reads and writes, and a Guest is let in
 *    to read (the workbook roles still decide what they may change). Removing
 *    someone takes them out of every spreadsheet in the workspace at once.
 *    Both changes are approved with the admin's passkey.
 */
import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { APP_DISPLAY_NAME } from '../config';
import { C } from '../theme';
import { closeButton, overlay, sheetHeader, sideSheet } from './glass';
import type { Member } from '../hooks/useSpreadsheet';
import { ROLE_HELP, ROLE_NOTE, WORKBOOK_ROLES } from '../spreadsheet/access';
/** One entry of the workspace org's roster. */
export interface GroupPerson {
  identity: string;
  role: string;
}

const NETWORK_ROLES: { value: string; label: string }[] = [
  { value: 'admin', label: 'Admin' },
  { value: 'member', label: 'Member' },
  { value: 'guest', label: 'Guest' },
];


interface PeoplePanelProps {
  members: Member[];
  group: GroupPerson[];
  selfId: string | null;
  workspaceName: string;
  /** A member id or a group account (the same hex) -> a name, never a raw id. */
  nameOf: (memberId: string) => string;
  /** This user may change workbook roles (an owner, or nobody owns it yet). */
  canManageRoles: boolean;
  /** This user administers the workspace (an owner or admin of its org). */
  isGroupAdmin: boolean;
  onSetRole: (memberId: string, role: string) => Promise<void>;
  onSetGroupRole: (account: string, role: string) => Promise<void>;
  onRemove: (account: string) => Promise<void>;
  /**
   * The signed-in account leaves the workspace (anyone but its owner). Absent:
   * no Leave is offered.
   */
  onLeave?: () => Promise<void>;
  /** The org keeps its apps apart: Leave is this app only, the org and its other apps stay. */
  appOnly?: boolean;
  onClose: () => void;
}

interface Row {
  key: string;
  member: Member | null;
  person: GroupPerson | null;
}

/**
 * Workbook members, matched to the org roster by account; then anyone in the
 * org who has not opened this workbook yet.
 */
export function peopleRows(members: Member[], group: GroupPerson[]): { rows: Row[] } {
  const rows: Row[] = members.map((m) => ({
    key: m.id, member: m, person: group.find((g) => m.account && g.identity === m.account) ?? null,
  }));
  for (const g of group) {
    if (!rows.some((r) => r.person?.identity === g.identity)) rows.push({ key: g.identity, member: null, person: g });
  }
  return { rows };
}

/**
 * The name for a row: a workbook member's, or — for someone in the workspace
 * who has not opened this workbook — the name keyed by their account, which
 * `nameOf` resolves from the workspace's member names.
 */
export function rowName(row: Pick<Row, 'member' | 'person'>, nameOf: (id: string) => string): string {
  return nameOf(row.member ? row.member.id : row.person!.identity);
}

export default function PeoplePanel(props: PeoplePanelProps) {
  const { members, group, selfId, onClose } = props;
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const { rows } = peopleRows(members, group);

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
        <Note data-testid="role-note">{ROLE_NOTE}</Note>
        <List>
          {rows.map(({ key, member, person }) => {
            const self = !!member && member.id === selfId;
            const name = rowName({ member, person }, props.nameOf);
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
                        disabled={!props.isGroupAdmin || self || person.role === 'owner'}
                        data-testid="field-network-role"
                        onChange={(e) => void run(() => props.onSetGroupRole(person.identity, e.target.value))}
                      >
                        {NETWORK_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                        {!NETWORK_ROLES.some((r) => r.value === person.role) && (
                          <option value={person.role}>{person.role[0].toUpperCase() + person.role.slice(1)}</option>
                        )}
                      </select>
                    </label>
                  )}
                  {person && props.isGroupAdmin && !self && person.role !== 'owner' && (
                    <RemoveBtn type="button" onClick={() => setConfirming(person.identity)} data-testid="action-remove-member">
                      Remove
                    </RemoveBtn>
                  )}
                </div>
                {confirming === person?.identity && (
                  <Confirm role="alertdialog" aria-label={`Remove ${name}`}>
                    <p>
                      Remove {name} from every spreadsheet in {props.workspaceName}? They lose access to all of
                      them at once.
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
        {props.onLeave && (
          <LeaveRow>
            {confirmLeave ? (
              <Confirm role="alertdialog" aria-label={`Leave ${props.workspaceName}`}>
                <p>
                  {props.appOnly
                    ? `Leave ${APP_DISPLAY_NAME} in ${props.workspaceName}? You stay in the organization and its other apps.`
                    : `Leave ${props.workspaceName}? You lose every spreadsheet in it, and need a new invitation to come back.`}
                </p>
                <div>
                  <button type="button" onClick={() => setConfirmLeave(false)}>Cancel</button>
                  <button
                    type="button"
                    className="danger"
                    data-testid="action-confirm-leave"
                    onClick={() => void run(async () => { await props.onLeave!(); setConfirmLeave(false); })}
                  >
                    Leave
                  </button>
                </div>
              </Confirm>
            ) : (
              <RemoveBtn type="button" onClick={() => setConfirmLeave(true)} data-testid="action-leave-workspace">
                Leave workspace
              </RemoveBtn>
            )}
          </LeaveRow>
        )}
        <Help>
          <p><b>Workbook</b> roles are this spreadsheet&apos;s: owners set them, and the contract checks every write.</p>
          <p><b>Workspace</b> access is the organization&apos;s: admins invite and remove people, and approve each change with their passkey.</p>
        </Help>
      </Panel>
    </Overlay>
  );
}

const Overlay = styled.div`
  ${overlay}
  z-index: 200;
  display: flex; justify-content: flex-end;
`;
const Panel = styled.div`
  ${sideSheet}
  --sheet-w: 460px;
`;
const Header = styled.div`
  ${sheetHeader}
`;
const CloseBtn = styled.button`
  ${closeButton}
`;
const Err = styled.p`margin: 0; padding: 8px 18px; font-size: 12.5px; color: ${C.danger}; border-bottom: 1px solid ${C.line};`;
const Note = styled.p`margin: 0; padding: 8px 18px; font-size: 12px; color: ${C.muted}; border-bottom: 1px solid ${C.line};`;
const List = styled.ul`list-style: none; margin: 0; padding: 0; overflow-y: auto; flex: 1;`;
const Item = styled.li`
  padding: 12px 18px; border-bottom: 1px solid ${C.line}; font-size: 13px; color: ${C.ink};
  .who { display: flex; align-items: baseline; gap: 8px; margin-bottom: 8px; }
  .sub { font-size: 11.5px; color: ${C.mutedSoft}; }
  .controls { display: flex; align-items: end; gap: 10px; flex-wrap: wrap; }
  label { display: flex; flex-direction: column; gap: 3px; font-size: 10.5px; color: ${C.mutedSoft}; text-transform: uppercase; letter-spacing: 0.04em; }
  select {
    font-size: 12.5px; padding: 5px 8px; border-radius: 8px; text-transform: none; letter-spacing: 0;
    color: ${C.ink}; background: var(--glass-sunken); border: 1px solid var(--glass-line);
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
const LeaveRow = styled.div`
  padding: 10px 18px; border-top: 1px solid ${C.line}; display: flex; flex-direction: column; align-items: stretch;
`;
const Help = styled.div`
  padding: 10px 18px 16px; border-top: 1px solid ${C.line};
  p { margin: 4px 0; font-size: 11.5px; line-height: 1.45; color: ${C.mutedSoft}; }
`;
