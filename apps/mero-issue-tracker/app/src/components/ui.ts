// Layout primitives every routed view composes, so the pages hold layout and
// behaviour rather than re-deriving the same frosted blocks.
import styled from 'styled-components';
import { tokens as t } from '../theme';

/** A routed view's scroll column, under the floating header. */
export const Page = styled.div`
  flex: 1 1 auto; min-height: 0; min-width: 0; overflow-y: auto;
  padding: 16px 16px 48px;
  display: flex; flex-direction: column; gap: 14px;
  > * { flex-shrink: 0; }
  @media (max-width: 720px) { padding: 12px 10px 40px; gap: 12px; }
`;

/**
 * Frosted frame panel; the text and controls inside stay sharp.
 *
 * ⚠️ backdrop-filter makes this the containing block for any `position: fixed`
 * descendant, so a dialog rendered INSIDE a Panel is trapped in it. Render
 * dialogs as siblings of panels (every view does), never as children.
 */
export const Panel = styled.section`
  background: ${t.color.glass}; border: 1px solid ${t.color.edge}; border-radius: ${t.radiusLg};
  -webkit-backdrop-filter: ${t.blur}; backdrop-filter: ${t.blur}; box-shadow: ${t.shadow};
  min-width: 0;
  @media (max-width: 720px) { border-radius: 18px; }
`;

/** "Nothing here (yet)": a quiet dashed card with a heading and a line. */
export const EmptyCard = styled.div`
  color: ${t.color.text3}; font-size: 13px; padding: 56px 24px; text-align: center; line-height: 1.6;
  margin: 24px auto; max-width: 460px; width: 100%;
  background: ${t.color.glass}; border: 1px dashed ${t.color.borderStrong}; border-radius: ${t.radiusLg};
  strong { color: ${t.color.text}; display: block; font-size: 15px; font-weight: 650; margin-bottom: 6px; letter-spacing: -0.01em; }
`;

/** A small, quiet, rounded count beside a heading. */
export const Count = styled.span`
  display: inline-flex; align-items: center; justify-content: center; min-width: 22px; height: 20px;
  padding: 0 7px; border-radius: ${t.radiusPill}; font-size: 11px; font-weight: 650;
  font-variant-numeric: tabular-nums; color: ${t.color.text2}; background: ${t.color.raised2};
`;
