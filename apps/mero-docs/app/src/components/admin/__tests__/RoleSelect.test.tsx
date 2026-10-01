import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RoleSelect } from '../RoleSelect';

const OPTIONS = ['Manager', 'Editor', 'Guest'] as const;

function renderSelect(reasonFor?: (role: (typeof OPTIONS)[number]) => string | null) {
  const { unmount } = render(
    <RoleSelect
      value="Editor"
      options={OPTIONS}
      onChange={vi.fn()}
      reasonFor={reasonFor}
      ariaLabel="Role"
    />,
  );
  const select = screen.getByRole('combobox', { name: 'Role' });
  return { select, unmount };
}

describe('RoleSelect', () => {
  it('marks a vetoed option disabled with its reason, keeping the plain role label', () => {
    renderSelect((role) => (role === 'Manager' ? 'Only the owner can do that.' : null));
    const manager = screen.getByRole('option', { name: 'Manager' }) as HTMLOptionElement;
    expect(manager.disabled).toBe(true);
    expect(manager.title).toBe('Only the owner can do that.');
  });

  // A fixed width keeps every member row aligned, whatever the options say.
  it('has the same width whether or not options are vetoed', () => {
    const { select, unmount } = renderSelect();
    const plain = select.className;
    unmount();
    const vetoed = renderSelect(() => 'No.').select.className;
    expect(plain).toContain('w-28');
    expect(vetoed).toBe(plain);
  });
});
