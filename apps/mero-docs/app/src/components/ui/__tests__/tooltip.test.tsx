import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../tooltip';

describe('TooltipContent', () => {
  it('renders outside the trigger row, so its text is not part of the row text', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <TooltipProvider>
        <div>
          <Tooltip>
            <TooltipTrigger>Row</TooltipTrigger>
            <TooltipContent>Tip text</TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>,
    );
    await user.hover(screen.getByRole('button', { name: 'Row' }));
    expect(await screen.findByRole('tooltip')).toBeTruthy();
    expect(container.textContent).toBe('Row');
  });
});
