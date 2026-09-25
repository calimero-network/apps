import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EditorHeader } from '../EditorHeader';

describe('EditorHeader back button', () => {
  it('names the folder it goes back to', () => {
    const onBack = vi.fn();
    render(
      <EditorHeader documentName="Plan" folderName="Budget" onBack={onBack} />,
    );
    const back = screen.getByRole('button', { name: 'Back to Budget' });
    expect(back.textContent).toContain('Budget');
    fireEvent.click(back);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('falls back to a plain Back while the folder name is unknown', () => {
    render(<EditorHeader documentName="Plan" onBack={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy();
  });
});
