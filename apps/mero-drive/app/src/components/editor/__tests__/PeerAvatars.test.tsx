import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PeerAvatars, type Peer } from '../PeerAvatars';

const peer = (id: string, name: string): Peer => ({
  id,
  name,
  colour: '#e11d74',
});

describe('PeerAvatars', () => {
  it('renders nothing when nobody else is here', () => {
    render(<PeerAvatars peers={[]} />);
    expect(screen.queryByRole('group')).toBeNull();
  });

  it('shows each peer as a named monogram', () => {
    render(<PeerAvatars peers={[peer('a', 'Alice Lin'), peer('b', 'Bob')]} />);
    expect(screen.getByRole('group').getAttribute('aria-label')).toBe(
      'Also here: Alice Lin, Bob',
    );
    expect(screen.getByTitle('Alice Lin').textContent).toBe('AL');
    expect(screen.getByTitle('Bob').textContent).toBe('BO');
  });

  it('collapses peers beyond three into a count', () => {
    const peers = ['A', 'B', 'C', 'D', 'E'].map((n) => peer(n, n));
    render(<PeerAvatars peers={peers} />);
    expect(screen.getByTitle('D, E').textContent).toBe('+2');
  });
});
