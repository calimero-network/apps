/**
 * The "TEE enabled" indicator on the Members page and in the sidebar footer.
 * Rendered to static markup: the suite runs in node, without a DOM.
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import TeeBadge from './TeeBadge';

const render = (props: React.ComponentProps<typeof TeeBadge>) =>
  renderToStaticMarkup(React.createElement(TeeBadge, props));

describe('TeeBadge', () => {
  it('renders nothing when the workspace has no TEE node', () => {
    expect(render({ mode: null })).toBe('');
  });

  it('says TEE enabled, and in which mode, when a TEE node is admitted', () => {
    const html = render({ mode: 'Relay' });

    expect(html).toContain('data-testid="tee-badge"');
    expect(html).toContain('TEE enabled');
    expect(html).toContain('Relay');
    expect(html).toContain('A hardware-attested node keeps this workspace in sync');
  });

  it('shows only the shield in compact form, with the explanation as its tooltip', () => {
    const html = render({ mode: 'Replica', compact: true });

    expect(html).toContain('aria-label="TEE enabled (Replica)"');
    expect(html).toContain('A hardware-attested node keeps this workspace in sync');
  });
});
