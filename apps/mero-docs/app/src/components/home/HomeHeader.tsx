import * as React from 'react';

// Sizes a Button for the header's actions slot (30px tall, as the mockup), so every caller's actions line up.
export const headerActionClass =
  'h-[30px] gap-1.5 rounded-md px-3 text-[12.5px] [&_svg]:size-3.5';

interface Props {
  title: React.ReactNode;
  subtitle: string;
  actions?: React.ReactNode;
}

export function HomeHeader({ title, subtitle, actions }: Props) {
  return (
    <div className="flex flex-col gap-3 px-4 pb-2.5 pt-5 md:flex-row md:items-end md:justify-between md:px-7 md:pt-[22px]">
      <div className="min-w-0">
        <h1 className="flex min-w-0 items-center gap-2.5 text-xl font-semibold leading-[30px] tracking-[-0.015em] text-foreground">
          {title}
        </h1>
        <p className="mt-[3px] text-[12.5px] text-muted-foreground">
          {subtitle}
        </p>
      </div>
      {actions && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      )}
    </div>
  );
}
