import * as React from 'react';

import { cn } from '@/lib/utils';

// The compact 32px field used in popovers and dialogs.
const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      'h-8 w-full rounded-md border border-input bg-card px-2.5 text-[13px] text-foreground placeholder:text-muted-foreground/80 focus-visible:border-primary-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    {...props}
  />
));
Input.displayName = 'Input';

export { Input };
