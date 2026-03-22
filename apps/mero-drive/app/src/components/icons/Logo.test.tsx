import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LogoWithText } from './Logo';

describe('LogoWithText', () => {
  it('renders the Mero Drive brand name', () => {
    const html = renderToStaticMarkup(<LogoWithText />);

    expect(html).toContain('Mero Drive');
    expect(html).not.toContain('MeroDocs');
  });
});
