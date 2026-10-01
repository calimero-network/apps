import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { PeerAvatars, type Peer } from '../PeerAvatars';

const peer = (id: string, name: string): Peer => ({
  id,
  name,
  colour: '#e11d74',
});

function renderAvatars(peers: Peer[]) {
  return render(
    <TooltipProvider>
      <PeerAvatars peers={peers} />
    </TooltipProvider>,
  );
}

describe('PeerAvatars', () => {
  it('renders nothing when nobody else is here', () => {
    renderAvatars([]);
    expect(screen.queryByRole('group')).toBeNull();
  });

  it('shows each peer as a monogram and names them all for screen readers', () => {
    renderAvatars([peer('a', 'Alice Lin'), peer('b', 'Bob')]);
    const group = screen.getByRole('group');
    expect(group.getAttribute('aria-label')).toBe('Also here: Alice Lin, Bob');
    expect(group.textContent).toBe('ALBO');
  });

  it('collapses peers beyond three into a count', () => {
    renderAvatars(['A', 'B', 'C', 'D', 'E'].map((n) => peer(n, n)));
    expect(screen.getByRole('group').textContent).toContain('+2');
  });

  it('lists every full name, hidden ones included, in a tooltip', async () => {
    renderAvatars(
      ['Alice Lin', 'Bob', 'Carol', 'Dan Ortiz'].map((n) => peer(n, n)),
    );
    fireEvent.focus(screen.getByRole('group'));
    const tooltip = await screen.findByRole('tooltip');
    for (const name of ['Alice Lin', 'Bob', 'Carol', 'Dan Ortiz']) {
      expect(tooltip.textContent).toContain(name);
    }
  });
});
