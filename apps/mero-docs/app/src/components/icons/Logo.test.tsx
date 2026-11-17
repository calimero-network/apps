import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LogoWithText } from './Logo';

describe('LogoWithText', () => {
  it('renders the Hyperfeed Docs brand name', () => {
    const view = renderToStaticMarkup(<LogoWithText />);

    expect(view).toContain('Hyperfeed Docs');
    expect(view).not.toContain('MeroDocs');
  });
});
