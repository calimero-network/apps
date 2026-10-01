// The few line icons the vault screen needs that mero-icons does not ship.
// Same grammar as that set: 24px box, 1.5 stroke, round joins, currentColor,
// so they sit beside its icons without a visible seam.

import type { SVGProps } from 'react';

type IconProps = { size?: number } & SVGProps<SVGSVGElement>;

function Base({ size = 16, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export function CopyIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="9" y="9" width="11" height="11" />
      <path d="M5 15V4h11" />
    </Base>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </Base>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 5v14M5 12h14" />
    </Base>
  );
}

export function UsersIcon(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5" />
      <path d="M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.8c1.9.7 3.1 2.4 3.5 5.2" />
    </Base>
  );
}

export function GridIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="4" y="4" width="6.5" height="6.5" />
      <rect x="13.5" y="4" width="6.5" height="6.5" />
      <rect x="4" y="13.5" width="6.5" height="6.5" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" />
    </Base>
  );
}

export function TagIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M3.5 12.5V4h8.5l8.5 8.5-8.5 8.5z" />
      <circle cx="8" cy="8.5" r="1.2" />
    </Base>
  );
}

export function ActivityIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M3 12h4l3-7 4 14 3-7h4" />
    </Base>
  );
}

export function LogOutIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M10 4H4v16h6M15 8l4 4-4 4M9 12h10" />
    </Base>
  );
}

export function BackIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M19 12H5M11 6l-6 6 6 6" />
    </Base>
  );
}

export function OpenIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6" />
    </Base>
  );
}

export function ShieldIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 3 4.5 6v5.5c0 4.5 3.2 8 7.5 9.5 4.3-1.5 7.5-5 7.5-9.5V6z" />
      <path d="m9 12 2 2 4-4" />
    </Base>
  );
}
