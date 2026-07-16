import React from 'react';
import styled from 'styled-components';
import { useNavigate } from 'react-router-dom';
import { tokens as t, STATUSES } from '../../theme';
import { APP_ROUTE } from '../../config';
import PriorityGlyph from '../../components/PriorityGlyph';
import StatusDot from '../../components/StatusDot';
import AvatarGlyph from '../../components/AvatarGlyph';
import LabelChip from '../../components/LabelChip';
import { useAppCtx } from './appContext';

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

/** Kanban board grouped by status, secondary to the list view. */
export default function BoardPage(): React.ReactElement {
  const { data } = useAppCtx();
  const navigate = useNavigate();

  return (
    <Wrap>
      {STATUSES.map((status) => {
        const cards = data.issues.filter((i) => i.status === status);
        return (
          <Col key={status}>
            <ColHead>
              <StatusDot status={status} />
              <span className="g-name">{status}</span>
              <span className="g-count">{cards.length}</span>
            </ColHead>
            {cards.map((issue) => (
              <Card
                key={issue.id}
                data-testid="item-issue"
                data-issue-id={issue.id}
                onClick={() => navigate(`${APP_ROUTE}/issues/${issue.id}`)}
              >
                <div className="top">
                  <PriorityGlyph priority={issue.priority} boxSize={13} />
                  <span className="bc-id">{shortId(issue.id)}</span>
                </div>
                <div className="bc-title">{issue.title}</div>
                <div className="bottom">
                  <span className="labels">
                    {issue.labels.slice(0, 2).map((l) => <LabelChip key={l} label={l} />)}
                  </span>
                  <AvatarGlyph seed={issue.assignee} size="sm" keyFallback={!!issue.assignee} />
                </div>
              </Card>
            ))}
          </Col>
        );
      })}
    </Wrap>
  );
}

const Wrap = styled.div`
  display: flex; gap: 14px; padding: 18px 16px 40px;
  overflow-x: auto; flex: 1; align-items: flex-start;
`;
const Col = styled.div`flex: 0 0 268px; display: flex; flex-direction: column; gap: 9px;`;
const ColHead = styled.div`
  display: flex; align-items: center; gap: 8px; padding: 4px 4px 2px;
  .g-name { font-size: 12.5px; font-weight: 600; }
  .g-count { font-size: 11.5px; color: ${t.color.text3}; font-variant-numeric: tabular-nums; }
`;
const Card = styled.div`
  background: ${t.color.panel}; border: 1px solid ${t.color.border};
  border-radius: ${t.radius}; padding: 11px 12px;
  display: flex; flex-direction: column; gap: 9px; cursor: pointer;
  transition: background 150ms ease-out, border-color 150ms ease-out;
  &:hover { background: ${t.color.raised}; border-color: ${t.color.borderStrong}; }
  .top { display: flex; align-items: center; gap: 8px; }
  .bc-id { font-family: ${t.font.mono}; font-size: 11px; color: ${t.color.text3}; }
  .bc-title { font-size: 12.5px; line-height: 1.4; color: ${t.color.text}; }
  .bottom { display: flex; align-items: center; gap: 8px; }
  .labels { display: inline-flex; gap: 5px; flex: 1 1 auto; }
`;
