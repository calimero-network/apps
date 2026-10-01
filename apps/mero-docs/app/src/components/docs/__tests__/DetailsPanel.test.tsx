import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  DetailsPanel,
  DetailsSheet,
  type DetailsPanelProps,
} from '../DetailsPanel';

const onOpen = vi.fn();

const PROPS: DetailsPanelProps = {
  folder: { name: 'Product', color: '#3b82f6' },
  created: { dateLabel: 'Sep 3', by: <span>You</span> },
  updated: { relLabel: '2 min ago', by: <span>Bob</span> },
  tags: [{ key: 'roadmap', name: 'roadmap', color: '#3b82f6' }],
  linkedFrom: [
    {
      key: 'doc-4',
      title: 'Roadmap 2026',
      sentence: '…the H2 work depends on Q3 launch plan landing first…',
      sentenceBold: [[24, 38]],
      folderPath: ['Product'],
      folderColor: '#3b82f6',
      onOpen: () => onOpen('doc-4'),
    },
  ],
  linksTo: [
    {
      key: 'doc-7',
      title: 'Pricing notes',
      section: 'Milestones',
      folderPath: ['Product'],
      onOpen: () => onOpen('doc-7'),
    },
    {
      key: 'doc-5',
      title: 'Launch blog post',
      folderPath: ['Marketing'],
      onOpen: () => onOpen('doc-5'),
    },
  ],
  onClose: () => {},
};

describe('DetailsPanel', () => {
  it('lists the folder, created, updated and tags', () => {
    render(<DetailsPanel {...PROPS} />);
    expect(screen.getByRole('heading', { name: 'Details' })).toBeTruthy();
    expect(screen.getAllByRole('term').map((t) => t.textContent)).toEqual([
      'Folder',
      'Created',
      'Updated',
      'Tags',
    ]);
    expect(screen.getAllByRole('definition').map((d) => d.textContent)).toEqual(
      ['Product', 'Sep 3 by You', '2 min ago by Bob', 'roadmap'],
    );
  });

  it('leaves out created and updated when unknown, and says when there are no tags', () => {
    render(
      <DetailsPanel
        {...PROPS}
        created={undefined}
        updated={undefined}
        tags={[]}
      />,
    );
    expect(screen.getAllByRole('term').map((t) => t.textContent)).toEqual([
      'Folder',
      'Tags',
    ]);
    expect(screen.getByText('No tags')).toBeTruthy();
  });

  it('leaves out who when the caller does not know', () => {
    render(<DetailsPanel {...PROPS} created={{ dateLabel: 'Sep 3' }} />);
    expect(screen.getAllByRole('definition')[1].textContent).toBe('Sep 3');
  });

  it('counts and opens backlinks and outgoing links', async () => {
    const user = userEvent.setup();
    render(<DetailsPanel {...PROPS} />);
    const from = screen.getByRole('region', { name: 'Linked from' });
    const to = screen.getByRole('region', { name: 'Links to' });
    expect(within(from).getByTestId('details-count').textContent).toBe('1');
    expect(within(to).getByTestId('details-count').textContent).toBe('2');
    expect(within(from).getByText('Q3 launch plan').tagName).toBe('B');
    expect(within(to).getByText('Linked in “Milestones”')).toBeTruthy();
    expect(
      within(to).getByRole('button', { name: /Launch blog post/ }).textContent,
    ).toBe('Launch blog postMarketing');
    await user.click(
      within(from).getByRole('button', { name: /Roadmap 2026/ }),
    );
    expect(onOpen).toHaveBeenCalledWith('doc-4');
    await user.click(
      within(to).getByRole('button', { name: /Launch blog post/ }),
    );
    expect(onOpen).toHaveBeenCalledWith('doc-5');
  });

  it('says when there are no links either way', () => {
    render(<DetailsPanel {...PROPS} linkedFrom={[]} linksTo={[]} />);
    expect(screen.getByText('No documents link here yet')).toBeTruthy();
    expect(screen.getByText('This document has no links')).toBeTruthy();
    expect(
      screen.getByText('Only documents you can open are listed'),
    ).toBeTruthy();
  });

  it('closes from the close button', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<DetailsPanel {...PROPS} onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: 'Close details' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe('DetailsSheet', () => {
  it('shows the details in a dialog that closes on Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<DetailsSheet {...PROPS} onClose={onClose} />);
    const dialog = await screen.findByRole('dialog', { name: 'Details' });
    expect(within(dialog).getByText('Roadmap 2026')).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });
});
