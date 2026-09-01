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
    <Chip>
      <span className="ld" style={{ background: labelColor(label) }} />
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
  font-size: 11px;
  color: ${t.color.text2};
  border: 1px solid ${t.color.borderStrong};
  border-radius: 20px;
  padding: 1px 8px;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  .ld { width: 6px; height: 6px; border-radius: 50%; display: inline-block; }
  button {
    background: none; border: none; cursor: pointer; padding: 0;
    color: ${t.color.text3}; font-size: 13px; line-height: 1;
    &:hover { color: ${t.color.text}; }
  }
`;
