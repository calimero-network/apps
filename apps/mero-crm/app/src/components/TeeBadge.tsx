import React from 'react';
import styled from 'styled-components';
import { tokens as t } from '../theme';
import type { TeeMode } from '../utils/tee';

export const TEE_EXPLAINER =
  'A hardware-attested node keeps this workspace in sync and available when members are offline.';

/**
 * "TEE enabled": shown where the workspace's members are, in place of listing
 * the TEE node as one of them. Renders nothing without a TEE, so a failed or
 * empty member read simply shows no badge.
 */
export default function TeeBadge({
  mode,
  compact = false,
}: {
  mode: TeeMode | null;
  /** Shield only, the explanation in its tooltip (the sidebar footer). */
  compact?: boolean;
}): React.ReactElement | null {
  if (!mode) return null;
  const title = `${TEE_EXPLAINER} ${mode} mode.`;
  if (compact) {
    return (
      <Shield role="img" aria-label={`TEE enabled (${mode})`} title={title} data-testid="tee-badge">
        <ShieldIcon />
      </Shield>
    );
  }
  return (
    <Badge title={title} data-testid="tee-badge">
      <ShieldIcon />
      TEE enabled
      <span className="mode">{mode}</span>
    </Badge>
  );
}

function ShieldIcon(): React.ReactElement {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0 1.5 2.5v5C1.5 11.6 4.3 15 8 16c3.7-1 6.5-4.4 6.5-8.5v-5L8 0Zm-1 11.4L3.8 8.2l1.1-1.1L7 9.2l4.1-4.1 1.1 1.1L7 11.4Z" />
    </svg>
  );
}

const Shield = styled.span`
  display: inline-flex; align-items: center; flex: 0 0 auto; color: ${t.color.accentText};
`;
const Badge = styled.span`
  display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px;
  border-radius: ${t.radiusPill}; font-size: 11.5px; font-weight: 650;
  color: ${t.color.accentText}; background: ${t.color.accentDim};
  .mode { font-weight: 500; color: ${t.color.text2}; }
`;
