import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button } from '../button';

// Half-opacity lime on a dark surface still reads as an enabled button.
describe('Button', () => {
  it('drops the primary fill for a muted one when disabled in dark mode', () => {
    render(<Button disabled>Save</Button>);
    const classes = screen.getByRole('button', { name: 'Save' }).className.split(' ');
    expect(classes).toEqual(
      expect.arrayContaining([
        'dark:disabled:bg-muted',
        'dark:disabled:text-muted-foreground',
        'dark:disabled:opacity-100',
      ]),
    );
  });
});
