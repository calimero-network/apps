import React from 'react';
import styled from 'styled-components';
import { tokens as t, PRIORITY_COLOR } from '../theme';
import { IconBang } from './icons';

// How many of the three ascending bars are filled with the priority colour.
const FILLED: Record<string, number> = { low: 1, medium: 2, high: 3, urgent: 3 };
const LABEL: Record<string, string> = {
  low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent',
};

/** Bar-chart priority glyph; urgent renders as a tinted warning square. */
export default function PriorityGlyph({
  priority,
  boxSize = 15,
}: {
  priority: string;
  boxSize?: number;
}): React.ReactElement {
  const label = LABEL[priority] ?? priority;
  if (priority === 'urgent') {
    return (
      <UrgentBox style={{ width: boxSize, height: boxSize }} title={label}>
        <IconBang size={Math.round(boxSize * 0.6)} />
      </UrgentBox>
    );
  }
  const filled = FILLED[priority] ?? 0;
  const color = PRIORITY_COLOR[priority] ?? t.color.text3;
  return (
    <Bars title={label}>
      {[0, 1, 2].map((i) => (
        <i key={i} style={{ background: i < filled ? color : t.color.text3 }} />
      ))}
    </Bars>
  );
}

const Bars = styled.span`
  display: inline-flex;
  align-items: flex-end;
  gap: 1.5px;
  height: 12px;
  i {
    width: 3px;
    border-radius: 1px;
    display: inline-block;
  }
  i:nth-child(1) { height: 5px; }
  i:nth-child(2) { height: 8px; }
  i:nth-child(3) { height: 11px; }
`;

const UrgentBox = styled.span`
  border-radius: 4px;
  background: rgba(229, 105, 95, 0.16);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: ${t.color.urgent};
  flex: 0 0 auto;
`;
