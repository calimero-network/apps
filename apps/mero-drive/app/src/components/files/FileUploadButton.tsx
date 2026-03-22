import React, { useRef } from 'react';
import { Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * File upload: invisible `<input type="file">` layered on top of the visible button.
 * Clicks hit the real input (user activation), so `change` reliably fires after the
 * OS file dialog — unlike `display:none` + `input.click()` which can close the
 * dialog without firing `change` in some browsers.
 */
interface FileUploadButtonProps {
  onFileSelected: (file: File) => void;
  disabled?: boolean;
  variant?: 'button' | 'icon';
  className?: string;
  children?: React.ReactNode;
}

export const FileUploadButton: React.FC<FileUploadButtonProps> = ({
  onFileSelected,
  disabled = false,
  variant = 'button',
  className = '',
  children,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  /** Sidebar passes `flex-1` so the control fills the row; empty state omits it (shrink-wrap). */
  const fillRow = /\bflex-1\b/.test(className);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onFileSelected(file);
    }
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  };

  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      aria-label="Upload file"
      disabled={disabled}
      className={cn(
        'absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0',
        'disabled:cursor-not-allowed',
      )}
      onChange={handleChange}
    />
  );

  if (variant === 'icon') {
    return (
      <div className={cn('relative inline-flex', className)}>
        <Button
          type="button"
          variant="outline"
          size="icon"
          disabled={disabled}
          className="pointer-events-none"
          tabIndex={-1}
          aria-hidden="true"
          title="Upload File"
        >
          <Upload className="w-4 h-4" />
        </Button>
        {fileInput}
      </div>
    );
  }

  return (
    <div
      className={cn(
        'relative',
        fillRow ? 'flex min-w-0 flex-1' : 'inline-flex',
        className,
      )}
    >
      <Button
        type="button"
        disabled={disabled}
        className={cn('pointer-events-none gap-2', fillRow && 'w-full')}
        tabIndex={-1}
        aria-hidden="true"
      >
        {children ?? (
          <>
            <Upload className="w-4 h-4" />
            Upload File
          </>
        )}
      </Button>
      {fileInput}
    </div>
  );
};
