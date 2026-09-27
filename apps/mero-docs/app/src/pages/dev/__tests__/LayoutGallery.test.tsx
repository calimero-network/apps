import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import LayoutGallery from '../LayoutGallery';

describe('LayoutGallery', () => {
  it('renders the Atoms section discovered from ./gallery', async () => {
    render(
      <ThemeProvider>
        <LayoutGallery />
      </ThemeProvider>,
    );
    expect(await screen.findByRole('heading', { name: 'Atoms' })).toBeTruthy();
  });

  it('wraps sections in a 375px frame when Mobile 375 is toggled', async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <LayoutGallery />
      </ThemeProvider>,
    );
    await screen.findByRole('heading', { name: 'Atoms' });
    const region = screen.getByRole('region', { name: 'Atoms' });
    expect(within(region).queryByTestId('mobile-frame')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Mobile 375' }));
    expect(within(region).getByTestId('mobile-frame')).toBeTruthy();
  });
});
