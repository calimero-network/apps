import React from 'react';
import styled from 'styled-components';
import { useNavigate } from 'react-router-dom';
import { tokens as t, STATUSES, STATUS_COLOR } from '../../theme';
import { APP_ROUTE } from '../../config';
import PriorityGlyph from '../../components/PriorityGlyph';
import StatusDot from '../../components/StatusDot';
import AvatarGlyph from '../../components/AvatarGlyph';
import LabelChip from '../../components/LabelChip';
import { EmptyCard } from '../../components/ui';
import { matchesQuery } from '../../utils/search';
import { relativeTime, shortIssueId } from '../../utils/display';
import { useAppCtx } from './appContext';

/** Kanban board grouped by status, secondary to the list view: one frosted
 *  lane per status, solid cards on it. On a phone the lanes scroll sideways
 *  inside the board, one lane to a screen, never the page. */
export default function BoardPage(): React.ReactElement {
  const { data, aliases, searchQuery } = useAppCtx();
  const navigate = useNavigate();

  const issues = data.issues.filter((i) => matchesQuery(i, searchQuery));

  if (searchQuery.trim() && issues.length === 0) {
    return (
      <EmptyCard>
        <strong>Nothing here</strong>
        No issues match "{searchQuery.trim()}".
      </EmptyCard>
    );
  }

  return (
    <Wrap>
      {STATUSES.map((status) => {
        const cards = issues.filter((i) => i.status === status);
        return (
          <Col key={status} aria-label={status} style={{ '--status': STATUS_COLOR[status] } as React.CSSProperties}>
            <ColHead>
              <StatusDot status={status} size={9} />
              <span className="g-name">{status}</span>
              <span className="g-count">{cards.length}</span>
            </ColHead>
            <div className="cards">
              {cards.length === 0 && <span className="empty">No issues</span>}
              {cards.map((issue) => (
                <Card
                  key={issue.id}
                  data-testid="item-issue"
                  data-issue-id={issue.id}
                  onClick={() => navigate(`${APP_ROUTE}/issues/${issue.id}`)}
                >
                  <div className="top">
                    <PriorityGlyph priority={issue.priority} boxSize={15} />
                    <span className="bc-id">{shortIssueId(issue.id)}</span>
                    <span className="bc-time">{relativeTime(issue.created_at)}</span>
                  </div>
                  <div className="bc-title">{issue.title}</div>
                  <div className="bottom">
                    <span className="labels">
                      {issue.labels.slice(0, 2).map((l) => <LabelChip key={l} label={l} />)}
                    </span>
                    <AvatarGlyph
                      seed={issue.assignee && aliases.hasAlias(issue.assignee) ? aliases.resolve(issue.assignee) : issue.assignee}
                      size="sm"
                      title={issue.assignee ? aliases.resolve(issue.assignee) : undefined}
                      keyFallback={!!issue.assignee && !aliases.hasAlias(issue.assignee)}
                    />
                  </div>
                </Card>
              ))}
            </div>
          </Col>
        );
      })}
    </Wrap>
  );
}

const Wrap = styled.div`
  display: flex; gap: 14px; padding: 16px 16px 24px;
  overflow-x: auto; flex: 1 1 auto; min-height: 0; min-width: 0; align-items: stretch;
  @media (max-width: 720px) {
    padding: 12px 10px 20px; gap: 10px;
    scroll-snap-type: x mandatory; scroll-padding: 0 10px;
  }
`;
/* A lane: lighter frost than a panel, so the solid cards on it lead. It holds
   nothing position: fixed, so its blur traps nothing. */
const Col = styled.section`
  flex: 1 0 220px; max-width: 360px; min-height: 0;
  display: flex; flex-direction: column;
  background: ${t.color.lane}; border: 1px solid ${t.color.edge}; border-radius: ${t.radiusLg};
  -webkit-backdrop-filter: ${t.blur}; backdrop-filter: ${t.blur}; box-shadow: ${t.shadow};
  .cards {
    flex: 1 1 auto; min-height: 0; overflow-y: auto;
    display: flex; flex-direction: column; gap: 9px; padding: 2px 9px 10px;
  }
  .empty {
    padding: 22px 8px; text-align: center; font-size: 12.5px; color: ${t.color.text3};
    border: 1px dashed ${t.color.borderStrong}; border-radius: 14px;
  }
  @media (max-width: 720px) { flex: 0 0 82%; max-width: none; scroll-snap-align: start; }
`;
const ColHead = styled.div`
  display: flex; align-items: center; gap: 9px; padding: 14px 14px 10px;
  border-top: 3px solid var(--status); border-radius: ${t.radiusLg} ${t.radiusLg} 0 0;
  .g-name { font-size: 13.5px; font-weight: 700; letter-spacing: -0.01em; }
  .g-count {
    margin-left: auto; min-width: 22px; height: 20px; padding: 0 7px; border-radius: ${t.radiusPill};
    display: inline-flex; align-items: center; justify-content: center;
    font-size: 11px; font-weight: 700; font-variant-numeric: tabular-nums;
    color: var(--status); background: color-mix(in srgb, var(--status) 14%, transparent);
  }
`;
const Card = styled.div`
  background: ${t.color.panel}; border-radius: 14px; padding: 12px 13px;
  box-shadow: ${t.shadowCard};
  display: flex; flex-direction: column; gap: 10px; cursor: pointer;
  transition: box-shadow 150ms ease-out, transform 150ms ease-out;
  &:hover { box-shadow: ${t.shadowLift}; transform: translateY(-1px); }
  @media (prefers-reduced-motion: reduce) { &:hover { transform: none; } }
  .top { display: flex; align-items: center; gap: 8px; }
  .bc-id {
    font-family: ${t.font.mono}; font-size: 11px; color: ${t.color.text3};
    padding: 1px 6px; border-radius: 6px; background: ${t.color.raised2};
  }
  .bc-time { margin-left: auto; font-size: 11.5px; color: ${t.color.text3}; font-variant-numeric: tabular-nums; }
  .bc-title { font-size: 13.5px; font-weight: 600; line-height: 1.4; color: ${t.color.text}; letter-spacing: -0.005em; }
  .bottom { display: flex; align-items: center; gap: 8px; }
  .labels { display: inline-flex; flex-wrap: wrap; gap: 5px; flex: 1 1 auto; min-width: 0; }
`;
