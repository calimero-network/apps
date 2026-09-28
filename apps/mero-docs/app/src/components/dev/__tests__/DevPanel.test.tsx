import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import DevPanel from '../DevPanel';

vi.mock('../devNode', () => ({
  selectedDevNode: () => 1,
  fetchDevNodes: async () => ({
    applicationId: 'app',
    nodes: [{ index: 1, url: 'http://n1', online: true, accessToken: '', refreshToken: '' }],
  }),
  setDevNodeOnline: vi.fn(),
}));

// Below md the rig panel would cover a phone screen, so it starts as a pill there.
describe('DevPanel below md', () => {
  it('starts as a pill that opens the panel, and Hide folds it back', async () => {
    render(<DevPanel />);
    const panel = await screen.findByTestId('dev-panel');
    const pill = screen.getByRole('button', { name: 'Rig - node 1' });
    expect(panel.className).toContain('max-md:hidden');
    expect(pill.className).toContain('md:hidden');

    fireEvent.click(pill);
    expect(panel.className).not.toContain('max-md:hidden');
    expect(pill.className).toMatch(/(^| )hidden( |$)/);

    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    expect(panel.className).toContain('max-md:hidden');
  });
});
