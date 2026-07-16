import React from 'react';
import styled from 'styled-components';
import { tokens as t } from '../theme';
import { avatarColor, initial, truncateKey } from '../utils/display';

type Size = 'sm' | 'md' | 'lg';

const DIMS: Record<Size, { box: number; font: number; radius: number }> = {
  sm: { box: 18, font: 10, radius: 4 },
  md: { box: 20, font: 11, radius: 5 },
  lg: { box: 26, font: 12, radius: 6 },
};

/**
 * Deterministic colored rounded-square avatar built from a seed string (alias or
 * public key). When there is no alias, `keyFallback` renders the leading key
 * chars in mono on a neutral chip. `null`/empty seed renders an unassigned dash.
 */
export default function AvatarGlyph({
  seed,
  size = 'md',
  keyFallback = false,
  title,
}: {
  seed: string | null | undefined;
  size?: Size;
  keyFallback?: boolean;
  title?: string;
}): React.ReactElement {
  const dims = DIMS[size];
  if (!seed) {
    return <Box $dims={dims} $key title={title ?? 'unassigned'}>—</Box>;
  }
  if (keyFallback) {
    return (
      <Box $dims={dims} $key title={title ?? seed}>
        {truncateKey(seed).slice(0, 2)}
      </Box>
    );
  }
  return (
    <Box $dims={dims} style={{ background: avatarColor(seed) }} title={title ?? seed}>
      {initial(seed)}
    </Box>
  );
}

const Box = styled.span<{ $dims: { box: number; font: number; radius: number }; $key?: boolean }>`
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  user-select: none;
  font-weight: 600;
  width: ${({ $dims }) => $dims.box}px;
  height: ${({ $dims }) => $dims.box}px;
  font-size: ${({ $dims }) => $dims.font}px;
  border-radius: ${({ $dims }) => $dims.radius}px;
  color: ${({ $key }) => ($key ? t.color.text2 : t.color.bg)};
  background: ${({ $key }) => ($key ? t.color.raised2 : 'transparent')};
  ${({ $key }) => ($key ? `font-family: ${t.font.mono}; font-size: 9px;` : '')}
`;
