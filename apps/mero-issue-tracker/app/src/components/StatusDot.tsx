import React from 'react';
import styled from 'styled-components';
import { STATUS_COLOR } from '../theme';

/** Round status indicator coloured per issue status. */
export default function StatusDot({
  status,
  size = 8,
}: {
  status: string;
  size?: number;
}): React.ReactElement {
  return <Dot style={{ background: STATUS_COLOR[status] ?? '#8A909C', width: size, height: size }} />;
}

const Dot = styled.span`
  border-radius: 50%;
  flex: 0 0 auto;
  display: inline-block;
`;
