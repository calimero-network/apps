import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LinkTargetCard } from '../LinkTargetCard';

vi.mock('@/lib/copyLink', () => ({ copyLink: vi.fn() }));

afterEach(() => vi.clearAllMocks());

describe('LinkTargetCard', () => {
  it('names the folder for no-access', () => {
    render(
      <LinkTargetCard
        kind="no-access"
        folderName="Finance"
        onGoHome={vi.fn()}
        linkUrl="https://x/doc"
      />,
    );
    expect(screen.getByText('This document is in Finance')).toBeTruthy();
    expect(
      screen.getByText('Ask a folder manager to add you, then open this link again.'),
    ).toBeTruthy();
  });

  it('falls back to a generic name when no alias is known', () => {
    render(
      <LinkTargetCard kind="no-access" onGoHome={vi.fn()} linkUrl="https://x/doc" />,
    );
    expect(screen.getByText('This document is in a restricted folder')).toBeTruthy();
  });

  it('shows the deleted copy', () => {
    render(<LinkTargetCard kind="deleted" onGoHome={vi.fn()} linkUrl="https://x/doc" />);
    expect(screen.getByText('This document was deleted or moved')).toBeTruthy();
  });

  it('shows the not-in-workspace copy', () => {
    render(
      <LinkTargetCard kind="not-in-workspace" onGoHome={vi.fn()} linkUrl="https://x/doc" />,
    );
    expect(screen.getByText('You are not in this workspace')).toBeTruthy();
  });

  it('Go to Home calls the handler', () => {
    const onGoHome = vi.fn();
    render(<LinkTargetCard kind="deleted" onGoHome={onGoHome} linkUrl="https://x/doc" />);
    fireEvent.click(screen.getByRole('button', { name: 'Go to Home' }));
    expect(onGoHome).toHaveBeenCalledTimes(1);
  });

  it('Copy link copies the current link', async () => {
    const { copyLink } = await import('@/lib/copyLink');
    render(<LinkTargetCard kind="deleted" onGoHome={vi.fn()} linkUrl="https://x/doc" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(copyLink).toHaveBeenCalledWith('https://x/doc');
  });
});
