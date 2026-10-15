import React from 'react';
import styled from 'styled-components';
import { tokens as t } from '../theme';
import { labelColor } from '../utils/display';

/** Rounded label pill with a deterministic colour dot. Optional remove button. */
export default function LabelChip({
  label,
  onRemove,
}: {
  label: string;
  onRemove?: () => void;
}): React.ReactElement {
  return (
    <Chip style={{ '--label': labelColor(label) } as React.CSSProperties}>
      <span className="ld" />
      {label}
      {onRemove && (
        <button
          type="button"
          data-testid="action-remove_label"
          aria-label={`Remove ${label}`}
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
        >×</button>
      )}
    </Chip>
  );
}

const Chip = styled.span`
  font-size: 11.5px;
  font-weight: 600;
  color: ${t.color.text2};
  background: color-mix(in srgb, var(--label) 16%, transparent);
  border-radius: 999px;
  padding: 2px 9px;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  line-height: 1.4;
  .ld { width: 7px; height: 7px; border-radius: 50%; display: inline-block; background: var(--label); }
  button {
    background: none; border: none; cursor: pointer; padding: 0 0 0 1px;
    color: ${t.color.text3}; font-size: 14px; line-height: 1;
    &:hover { color: ${t.color.text}; }
  }
`;
