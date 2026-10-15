import React from 'react';
import styled from 'styled-components';
import { tokens as t, STATUSES, STATUS_COLOR } from '../theme';
import type { IssueView } from '../hooks/useItems';
import type { UseAliasesReturn } from '../hooks/useAliases';
import { relativeTime, shortIssueId } from '../utils/display';
import PriorityGlyph from './PriorityGlyph';
import StatusDot from './StatusDot';
import AvatarGlyph from './AvatarGlyph';
import LabelChip from './LabelChip';
import { EmptyCard, Panel } from './ui';

/** Issue rows grouped by status, one frosted card per status with its live
 *  count. On a phone each row wraps: the title on its own line, the meta
 *  (id, labels, assignee, age) under it. */
export default function IssueList({
  issues,
  aliases,
  query,
  warmingUp,
  onOpen,
}: {
  issues: IssueView[];
  aliases: UseAliasesReturn;
  /** Active search query, only used to word the empty state. */
  query?: string;
  /** The context is still replicating (a join in progress), so "no issues" is
   *  not yet a fact about this board — say so instead of asserting emptiness. */
  warmingUp?: boolean;
  onOpen: (id: string) => void;
}): React.ReactElement {
  const groups = STATUSES
    .map((status) => ({ status, rows: issues.filter((i) => i.status === status) }))
    .filter((g) => g.rows.length > 0);

  if (issues.length === 0) {
    // While the context is syncing we do not KNOW the board is empty — we just
    // cannot read it yet. Claiming "no issues match" during a join is the same
    // class of untruth as the error toasts that used to fire here.
    if (warmingUp) {
      return (
        <EmptyCard data-testid="issues-syncing">
          <strong>Syncing this workspace…</strong>
          Issues appear as soon as your teammates’ nodes send them.
        </EmptyCard>
      );
    }
    return (
      <EmptyCard>
        <strong>Nothing here</strong>
        {query?.trim() ? `No issues match "${query.trim()}".` : 'No issues match these filters.'}
      </EmptyCard>
    );
  }

  return (
    <Groups>
      {groups.map(({ status, rows }) => (
        <Group key={status} aria-label={status}>
          <GroupHeader style={{ '--status': STATUS_COLOR[status] } as React.CSSProperties}>
            <StatusDot status={status} size={9} />
            <span className="g-name">{status}</span>
            <span className="g-count" data-testid={`count-${status}`}>{rows.length}</span>
          </GroupHeader>
          <div className="rows">
            {rows.map((issue) => (
              <Row
                key={issue.id}
                data-testid="item-issue"
                data-issue-id={issue.id}
                onClick={() => onOpen(issue.id)}
              >
                <span className="prio"><PriorityGlyph priority={issue.priority} /></span>
                <span className="issue-id">{shortIssueId(issue.id)}</span>
                <span className="issue-title">{issue.title}</span>
                <span className="right">
                  <span className="labels">
                    {issue.labels.slice(0, 2).map((l) => <LabelChip key={l} label={l} />)}
                  </span>
                  <AvatarGlyph
                    seed={issue.assignee && aliases.hasAlias(issue.assignee) ? aliases.resolve(issue.assignee) : issue.assignee}
                    size="sm"
                    title={issue.assignee ? aliases.resolve(issue.assignee) : undefined}
                    keyFallback={!!issue.assignee && !aliases.hasAlias(issue.assignee)}
                  />
                  <span className="time">{relativeTime(issue.created_at)}</span>
                </span>
              </Row>
            ))}
          </div>
        </Group>
      ))}
    </Groups>
  );
}

const Groups = styled.div`display: flex; flex-direction: column; gap: 14px;`;
const Group = styled(Panel)`
  padding: 6px;
  .rows { display: flex; flex-direction: column; gap: 4px; }
`;
const GroupHeader = styled.div`
  display: flex; align-items: center; gap: 9px;
  padding: 10px 12px 8px;
  .g-name { font-size: 13.5px; font-weight: 700; letter-spacing: -0.01em; }
  .g-count {
    min-width: 22px; height: 20px; padding: 0 7px; border-radius: ${t.radiusPill};
    display: inline-flex; align-items: center; justify-content: center;
    font-size: 11px; font-weight: 700; font-variant-numeric: tabular-nums;
    color: var(--status); background: color-mix(in srgb, var(--status) 14%, transparent);
  }
`;
const Row = styled.div`
  display: flex; align-items: center; gap: 12px;
  padding: 0 12px; min-height: 48px;
  background: ${t.color.panel}; border-radius: 13px;
  box-shadow: 0 0 0 1px ${t.color.border};
  cursor: pointer; transition: box-shadow 150ms ease-out, background 150ms ease-out;
  &:hover { box-shadow: ${t.shadowLift}; }
  .prio { flex: 0 0 auto; display: inline-flex; width: 16px; justify-content: center; }
  .issue-id {
    font-family: ${t.font.mono}; font-size: 11px; color: ${t.color.text3};
    flex: 0 0 auto; font-variant-numeric: tabular-nums; white-space: nowrap;
    padding: 2px 7px; border-radius: 6px; background: ${t.color.raised2};
  }
  .issue-title {
    flex: 1 1 auto; min-width: 0; font-size: 13.5px; font-weight: 550; color: ${t.color.text};
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .right { display: flex; align-items: center; gap: 12px; flex: 0 0 auto; }
  .labels { display: inline-flex; gap: 5px; flex: 0 0 auto; }
  .time {
    font-size: 12px; color: ${t.color.text3}; min-width: 30px; text-align: right;
    font-variant-numeric: tabular-nums;
  }
  @media (max-width: 720px) {
    flex-wrap: wrap; row-gap: 6px; column-gap: 8px; padding: 11px 12px;
    .issue-title { order: -1; flex: 1 1 calc(100% - 28px); white-space: normal; line-height: 1.35; }
    .prio { order: -2; }
    .right { flex: 1 1 auto; gap: 8px; min-width: 0; }
    .labels { flex: 1 1 auto; min-width: 0; overflow: hidden; }
  }
`;
