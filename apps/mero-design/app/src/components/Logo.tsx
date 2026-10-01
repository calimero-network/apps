import { useId } from "react";

interface Props {
  size?: number;
}

/**
 * The app mark: a lime vector path between two anchor points, in the Calimero
 * palette. Same geometry as public/favicon.svg and scripts/gen-icons.mjs, so the
 * toolbar, the browser tab and the desktop icon are one picture.
 */
export default function Logo({ size = 28 }: Props) {
  // Several logos can be on one page; a shared gradient id would make them all
  // paint with whichever definition the browser found first.
  const gradient = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-label="Mero Design">
      <defs>
        <linearGradient id={gradient} x1="14" y1="48" x2="50" y2="16" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#93e60c" />
          <stop offset="1" stopColor="#b6ff5e" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill="#0e140f" />
      <path d="M14 48 C 20 20, 40 44, 50 16" fill="none" stroke={`url(#${gradient})`} strokeWidth="6" strokeLinecap="round" />
      <rect x="9" y="43" width="10" height="10" rx="2.5" fill="#f5f8f1" />
      <rect x="45" y="11" width="10" height="10" rx="2.5" fill="#f5f8f1" />
    </svg>
  );
}
