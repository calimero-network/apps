interface Props {
  size?: number;
  color?: string;
}

export default function Logo({ size = 28, color = "#111" }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="MeroDesign"
    >
      {/* Two overlapping offset squares — design/layers motif */}
      <rect x="3" y="9" width="16" height="16" rx="2.5" fill={color} opacity="0.18" />
      <rect x="9" y="5" width="16" height="16" rx="2.5" stroke={color} strokeWidth="2" fill="none" />
      {/* Pen nib accent */}
      <path
        d="M20 19 L26 25 L23.5 27.5 L17.5 21.5 Z"
        fill={color}
        opacity="0.7"
      />
      <circle cx="21" cy="20" r="1.5" fill={color} />
    </svg>
  );
}
