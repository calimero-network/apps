import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LogoWithText } from './Logo';

describe('LogoWithText', () => {
  it('renders the Mero Drive brand name', () => {
    const view = renderToStaticMarkup(<LogoWithText />);

    expect(view).toContain('Mero Drive');
    expect(view).not.toContain('MeroDocs');
  });
});
