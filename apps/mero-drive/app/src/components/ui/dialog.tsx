import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";

import { cn } from "@/lib/utils";

const Dialog = DialogPrimitive.Root;

const DialogClose = DialogPrimitive.Close;

// A menu item unmounts with its menu, so return focus to the trigger that labels the menu.
function focusReturnTarget(): HTMLElement | null {
  const active = document.activeElement as HTMLElement | null;
  const triggerId = active
    ?.closest('[role="menu"]')
    ?.getAttribute("aria-labelledby");
  return (triggerId && document.getElementById(triggerId)) || active;
}

// First child of the content, so it runs before an autoFocus field or Radix moves focus in.
function CaptureOpener({
  openerRef,
}: {
  openerRef: React.MutableRefObject<HTMLElement | null>;
}) {
  React.useLayoutEffect(() => {
    openerRef.current = focusReturnTarget();
  }, [openerRef]);
  return null;
}

// Radix only returns focus to a Dialog.Trigger, so every dialog returns it to its opener.
const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, onCloseAutoFocus, ...props }, ref) => {
  const openerRef = React.useRef<HTMLElement | null>(null);
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40" />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          "fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-[calc(100vw-2rem)] max-w-md max-h-[85vh] overflow-y-auto rounded-lg border border-border bg-card p-5 text-card-foreground shadow-xl focus:outline-none",
          className
        )}
        onCloseAutoFocus={(e) => {
          onCloseAutoFocus?.(e);
          if (e.defaultPrevented) return;
          e.preventDefault();
          openerRef.current?.focus();
        }}
        {...props}
      >
        <CaptureOpener openerRef={openerRef} />
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("mb-3 flex flex-col gap-1", className)} {...props} />
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("mt-4 flex justify-end gap-2", className)} {...props} />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-base font-semibold", className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
