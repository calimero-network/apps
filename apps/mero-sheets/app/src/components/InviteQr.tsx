import { useMemo } from 'react';
import styled from 'styled-components';
import { renderSVG } from 'uqr';
import { C } from '../theme';

/** A QR code of the invitation link, for handing it to a phone. */
export default function InviteQr({ link }: { link: string }) {
  const svg = useMemo(() => renderSVG(link, { border: 1 }), [link]);
  return <Qr aria-label="QR code for this invitation link" role="img" dangerouslySetInnerHTML={{ __html: svg }} />;
}

const Qr = styled.div`
  width: 120px; height: 120px; margin: 12px auto 0; padding: 6px;
  background: #fff; border: 1px solid ${C.line}; border-radius: 12px;
  svg { width: 100%; height: 100%; display: block; }
`;
