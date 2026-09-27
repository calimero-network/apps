import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DocTagRow } from '../DocTagRow';

const TAGS = [
  { key: 'roadmap', name: 'roadmap', color: '#3b82f6' },
  { key: 'q3', name: 'q3', color: '#64748b' },
];

const ADD = <button type="button">Add tag</button>;

describe('DocTagRow', () => {
  it('lets an editor remove each tag and shows the add trigger', async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    render(
      <DocTagRow tags={TAGS} canEdit onRemove={onRemove} addTrigger={ADD} />,
    );
    expect(screen.getByText('Tags')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Remove tag q3' }));
    expect(onRemove).toHaveBeenCalledWith('q3');
    expect(screen.getByRole('button', { name: 'Add tag' })).toBeTruthy();
  });

  it('shows tags read-only without remove buttons or the add trigger', () => {
    render(
      <DocTagRow
        tags={TAGS}
        canEdit={false}
        onRemove={() => {}}
        addTrigger={ADD}
      />,
    );
    expect(screen.getByText('roadmap')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders nothing when read-only with no tags', () => {
    const { container } = render(
      <DocTagRow
        tags={[]}
        canEdit={false}
        onRemove={() => {}}
        addTrigger={ADD}
      />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('shows the label and add trigger to an editor with no tags', () => {
    render(
      <DocTagRow tags={[]} canEdit onRemove={() => {}} addTrigger={ADD} />,
    );
    expect(screen.getByText('Tags')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add tag' })).toBeTruthy();
  });
});
