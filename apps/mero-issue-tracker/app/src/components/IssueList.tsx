import React from 'react';
import styled from 'styled-components';
import { tokens as t, STATUSES } from '../theme';
import type { IssueView } from '../hooks/useItems';
import type { UseAliasesReturn } from '../hooks/useAliases';
import { relativeTime } from '../utils/display';
import PriorityGlyph from './PriorityGlyph';
import StatusDot from './StatusDot';
import AvatarGlyph from './AvatarGlyph';
import LabelChip from './LabelChip';

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

/** Issue rows grouped by status with live per-group counts. */
export default function IssueList({
  issues,
  aliases,
  query,
  onOpen,
}: {
  issues: IssueView[];
  aliases: UseAliasesReturn;
  /** Active search query, only used to word the empty state. */
  query?: string;
  onOpen: (id: string) => void;
}): React.ReactElement {
  const groups = STATUSES
    .map((status) => ({ status, rows: issues.filter((i) => i.status === status) }))
    .filter((g) => g.rows.length > 0);

  if (issues.length === 0) {
    return (
      <Empty>
        {query?.trim() ? `No issues match "${query.trim()}".` : 'No issues match these filters.'}
      </Empty>
    );
  }

  return (
    <Scroll>
      {groups.map(({ status, rows }) => (
        <React.Fragment key={status}>
          <GroupHeader>
            <StatusDot status={status} />
            <span className="g-name">{status}</span>
            <span className="g-count" data-testid={`count-${status}`}>{rows.length}</span>
          </GroupHeader>
          {rows.map((issue) => (
            <Row
              key={issue.id}
              data-testid="item-issue"
              data-issue-id={issue.id}
              onClick={() => onOpen(issue.id)}
            >
              <span className="prio"><PriorityGlyph priority={issue.priority} /></span>
              <span className="issue-id">{shortId(issue.id)}</span>
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
                <StatusDot status={issue.status} />
                <span className="time">{relativeTime(issue.created_at)}</span>
              </span>
            </Row>
          ))}
        </React.Fragment>
      ))}
    </Scroll>
  );
}

const Scroll = styled.div`overflow-y: auto; flex: 1 1 auto;`;
const GroupHeader = styled.div`
  display: flex; align-items: center; gap: 8px;
  padding: 7px 16px; background: ${t.color.panel};
  border-bottom: 1px solid ${t.color.border};
  position: sticky; top: 0; z-index: 1;
  .g-name { font-size: 12.5px; font-weight: 600; }
  .g-count { font-size: 11.5px; color: ${t.color.text3}; font-variant-numeric: tabular-nums; }
`;
const Row = styled.div`
  display: flex; align-items: center; gap: 11px;
  padding: 0 16px; height: 40px;
  border-bottom: 1px solid ${t.color.border};
  cursor: pointer; transition: background 150ms ease-out;
  &:hover { background: rgba(255,255,255,0.035); }
  .prio { flex: 0 0 auto; display: inline-flex; }
  .issue-id {
    font-family: ${t.font.mono}; font-size: 11.5px; color: ${t.color.text3};
    width: 62px; flex: 0 0 auto; font-variant-numeric: tabular-nums;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .issue-title {
    flex: 1 1 auto; min-width: 0; font-size: 13px; color: ${t.color.text};
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .right { display: flex; align-items: center; gap: 12px; flex: 0 0 auto; }
  .labels { display: inline-flex; gap: 5px; flex: 0 0 auto; }
  .time {
    font-size: 11.5px; color: ${t.color.text3}; width: 30px; text-align: right;
    font-variant-numeric: tabular-nums;
  }
`;
const Empty = styled.div`
  flex: 1; display: flex; align-items: center; justify-content: center;
  color: ${t.color.text3}; font-size: 13px; padding: 60px 20px;
`;
