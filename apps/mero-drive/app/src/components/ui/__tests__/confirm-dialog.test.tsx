import React, { useState } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmOptions, ConfirmProvider, useConfirm } from '../confirm-dialog';

function Harness({ opts }: { opts: ConfirmOptions }) {
  const confirm = useConfirm();
  const [result, setResult] = useState('pending');
  return (
    <>
      <button onClick={async () => setResult(String(await confirm(opts)))}>
        Ask
      </button>
      <span data-testid="result">{result}</span>
    </>
  );
}

async function open(opts: ConfirmOptions) {
  const user = userEvent.setup();
  render(
    <ConfirmProvider>
      <Harness opts={opts} />
    </ConfirmProvider>,
  );
  await user.click(screen.getByRole('button', { name: 'Ask' }));
  await screen.findByRole('dialog', { name: opts.title });
  return user;
}

const result = () => screen.getByTestId('result').textContent;

describe('ConfirmProvider', () => {
  it('resolves false on Escape and returns focus to the opener', async () => {
    const user = await open({ title: 'Sure?' });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(result()).toBe('false'));
    expect(screen.queryByRole('dialog')).toBeNull();
    // Enter reaching the opener proves focus returned to it.
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('dialog')).toBeTruthy();
  });

  it('resolves true when confirmed', async () => {
    const user = await open({ title: 'Sure?', confirmLabel: 'Do it' });
    await user.click(screen.getByRole('button', { name: 'Do it' }));
    await waitFor(() => expect(result()).toBe('true'));
  });

  it('focuses Cancel first for destructive actions, so Enter cancels', async () => {
    const user = await open({
      title: 'Delete?',
      confirmLabel: 'Delete',
      destructive: true,
    });
    await user.keyboard('{Enter}');
    await waitFor(() => expect(result()).toBe('false'));
  });

  it('focuses the confirm button for non-destructive actions, so Enter confirms', async () => {
    const user = await open({ title: 'Leave?', confirmLabel: 'Leave' });
    await user.keyboard('{Enter}');
    await waitFor(() => expect(result()).toBe('true'));
  });
});
