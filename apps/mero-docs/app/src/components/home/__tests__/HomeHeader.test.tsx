import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HomeHeader } from '../HomeHeader';

describe('HomeHeader', () => {
  it('renders the title as the page heading, the subtitle and the actions', () => {
    render(
      <HomeHeader
        title="Home"
        subtitle="10 documents across 5 folders"
        actions={<button type="button">New document</button>}
      />,
    );
    expect(
      screen.getByRole('heading', { level: 1, name: 'Home' }),
    ).toBeTruthy();
    expect(screen.getByText('10 documents across 5 folders')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New document' })).toBeTruthy();
  });

  it('renders without actions', () => {
    render(<HomeHeader title="Home" subtitle="No documents" />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
