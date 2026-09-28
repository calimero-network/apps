import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DocLinkCard } from '../DocLinkCard';

describe('DocLinkCard', () => {
  it('shows the target title, folder, update, excerpt and tags', () => {
    render(
      <DocLinkCard
        state="ok"
        title="API spec v2"
        folderPath={['Engineering', 'Specs']}
        folderColor="#10b981"
        updatedLabel="Sep 20 by You"
        excerpt="Seat-based pricing does not fit a peer-to-peer product."
        tags={[{ key: 'api', name: 'api', color: '#10b981' }]}
      />,
    );
    expect(screen.getByText('API spec v2')).toBeTruthy();
    expect(
      screen.getByText('Engineering / Specs · updated Sep 20 by You'),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'Seat-based pricing does not fit a peer-to-peer product.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('api')).toBeTruthy();
  });

  it('leaves out the excerpt and tag row when there are none', () => {
    render(
      <DocLinkCard
        state="ok"
        title="Budget FY27"
        folderPath={['Finance']}
        updatedLabel="Sep 12 by You"
        tags={[]}
      />,
    );
    expect(screen.queryByTestId('doc-link-card-excerpt')).toBeNull();
    expect(screen.queryByTestId('doc-link-card-tags')).toBeNull();
  });

  it('announces loading', () => {
    render(<DocLinkCard state="loading" />);
    expect(screen.getByRole('status').textContent).toBe('Loading document…');
  });

  it.each([
    ['deleted', 'This document was deleted'],
    ['no-access', 'This is in a folder you cannot open'],
    ['other-workspace', 'This links to another workspace'],
  ] as const)('explains the %s state', (state, text) => {
    render(<DocLinkCard state={state} />);
    expect(screen.getByText(text)).toBeTruthy();
  });

  it('says the document could not be loaded, with a retry when offered', () => {
    const onRetry = vi.fn();
    const { rerender } = render(
      <DocLinkCard state="unavailable" onRetry={onRetry} />,
    );
    expect(screen.getByText("Couldn't load this document")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);

    rerender(<DocLinkCard state="unavailable" />);
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });
});
