import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FileUploadButton } from './FileUploadButton';

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

describe('FileUploadButton', () => {
  let onFileSelected: ReturnType<typeof vi.fn<(file: File) => void>>;

  beforeEach(() => {
    onFileSelected = vi.fn();
  });

  it('renders a file input layered on the button (not display:none)', () => {
    render(<FileUploadButton onFileSelected={onFileSelected} />);
    const input = screen.getByLabelText('Upload file') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.style.display).not.toBe('none');
    expect(input.className).toMatch(/opacity-0/);
  });

  it('exposes the file input for screen readers', () => {
    render(<FileUploadButton onFileSelected={onFileSelected} />);
    expect(screen.getByLabelText('Upload file')).toBeTruthy();
  });

  it('calls onFileSelected exactly once when a file is picked', async () => {
    render(<FileUploadButton onFileSelected={onFileSelected} />);
    const input = screen.getByLabelText('Upload file') as HTMLInputElement;

    const file = new File(['test-content'], 'test.txt', { type: 'text/plain' });
    await userEvent.upload(input, file);

    expect(onFileSelected).toHaveBeenCalledTimes(1);
    expect(onFileSelected).toHaveBeenCalledWith(file);
  });

  it('resets input value after selection so the same file can be re-selected', async () => {
    render(<FileUploadButton onFileSelected={onFileSelected} />);
    const input = screen.getByLabelText('Upload file') as HTMLInputElement;

    const file = new File(['data'], 'report.pdf', { type: 'application/pdf' });
    await userEvent.upload(input, file);

    expect(input.value).toBe('');
  });

  it('disables the file input when disabled', () => {
    render(<FileUploadButton onFileSelected={onFileSelected} disabled />);
    const input = screen.getByLabelText('Upload file') as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });

  it('icon variant layers file input on the icon button', () => {
    render(<FileUploadButton onFileSelected={onFileSelected} variant="icon" />);
    const input = screen.getByLabelText('Upload file') as HTMLInputElement;
    expect(input.className).toMatch(/opacity-0/);
  });

  it('renders custom children in default variant', () => {
    render(
      <FileUploadButton onFileSelected={onFileSelected}>
        Custom Upload Text
      </FileUploadButton>,
    );
    expect(screen.getByText('Custom Upload Text')).toBeTruthy();
  });
});
