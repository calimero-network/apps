import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { TeeBadge } from './TeeBadge';

// This suite runs in `node`, so the badge is rendered to markup rather than
// into a DOM. A TEE node is never counted as a person; this is where it shows.
const render = (mode: 'relay' | 'replica' | null) =>
  renderToStaticMarkup(createElement(TeeBadge, { mode }));

describe('TeeBadge', () => {
  it('says TEE enabled, with the mode and what the node does', () => {
    const html = render('relay');
    expect(html).toContain('TEE enabled');
    expect(html).toContain('Relay');
    expect(html).toContain(
      'A hardware-attested node keeps this workspace in sync and available when members are offline.',
    );
  });

  it('names a read-only TEE node a replica', () => {
    expect(render('replica')).toContain('Replica');
  });

  it('renders nothing without a TEE node', () => {
    expect(render(null)).toBe('');
  });
});
