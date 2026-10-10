import type { ReactElement, SVGProps } from "react";

/**
 * The editor's icon set: 16-unit line icons drawn with `currentColor`, so they
 * follow the theme. Inline rather than a dependency because a modeller needs
 * glyphs (a cone, a torus, a sun) no general icon set has.
 */
type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 16, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.3}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconCube = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 1.8 13.5 4.8v6.4L8 14.2 2.5 11.2V4.8z" />
    <path d="M2.5 4.8 8 7.8l5.5-3M8 7.8v6.4" />
  </Svg>
);
export const IconSphere = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="5.8" />
    <ellipse cx="8" cy="8" rx="5.8" ry="2.2" />
    <ellipse cx="8" cy="8" rx="2.2" ry="5.8" />
  </Svg>
);
export const IconIco = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 1.8 13.6 5.2 12 12 4 12 2.4 5.2z" />
    <path d="M8 1.8 4 12M8 1.8 12 12M2.4 5.2h11.2M4 12l4 2.4 4-2.4" />
  </Svg>
);
export const IconCylinder = (p: IconProps) => (
  <Svg {...p}>
    <ellipse cx="8" cy="3.8" rx="4.6" ry="1.8" />
    <path d="M3.4 3.8v8.4c0 1 2 1.8 4.6 1.8s4.6-.8 4.6-1.8V3.8" />
  </Svg>
);
export const IconCone = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 1.8 3.2 12.2M8 1.8l4.8 10.4" />
    <ellipse cx="8" cy="12.2" rx="4.8" ry="1.9" />
  </Svg>
);
export const IconTorus = (p: IconProps) => (
  <Svg {...p}>
    <ellipse cx="8" cy="8" rx="6.2" ry="3.8" />
    <ellipse cx="8" cy="7.6" rx="2.4" ry="1.2" />
  </Svg>
);
export const IconPlane = (p: IconProps) => (
  <Svg {...p}>
    <path d="M1.6 10.4 6 5.4h8.4L10 10.4z" />
  </Svg>
);
export const IconCapsule = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4.6" y="1.6" width="6.8" height="12.8" rx="3.4" />
    <path d="M4.6 5.6c1.8 1 5 1 6.8 0M4.6 10.4c1.8 1 5 1 6.8 0" />
  </Svg>
);
export const IconMesh = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.2 4.4 8 1.8l5.8 2.6-1 7.4L8 14.2l-4.8-2.4z" />
    <path d="M2.2 4.4 8 7.4l5.8-3M8 7.4l-4.8 4.4M8 7.4l4.8 4.4M8 7.4v6.8" />
  </Svg>
);
export const IconEmpty = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 1.8v12.4M1.8 8h12.4M3.8 3.8l8.4 8.4" />
  </Svg>
);
export const IconPoint = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="2.4" />
    <path d="M8 1.6v2M8 12.4v2M1.6 8h2M12.4 8h2M3.5 3.5l1.4 1.4M11.1 11.1l1.4 1.4M3.5 12.5l1.4-1.4M11.1 4.9l1.4-1.4" />
  </Svg>
);
export const IconSpot = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="3.4" r="1.8" />
    <path d="M6.4 4.4 3 13.4h10L9.6 4.4" />
  </Svg>
);
export const IconSun = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="5.6" r="2.8" />
    <path d="M8 9.6v4.8M5.4 12.6 8 14.4l2.6-1.8" />
  </Svg>
);
export const IconCursor = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.2 2.2 12.6 7.6 8.4 8.6 6.6 12.8z" />
  </Svg>
);
export const IconMove = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 1.6v12.8M1.6 8h12.8M8 1.6 6.4 3.2M8 1.6l1.6 1.6M8 14.4l-1.6-1.6M8 14.4l1.6-1.6M1.6 8l1.6-1.6M1.6 8l1.6 1.6M14.4 8l-1.6-1.6M14.4 8l-1.6 1.6" />
  </Svg>
);
export const IconRotate = (p: IconProps) => (
  <Svg {...p}>
    <path d="M13 8a5 5 0 1 1-1.6-3.7" />
    <path d="M11.6 1.8v2.6H9" />
  </Svg>
);
export const IconScale = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2" y="7" width="7" height="7" />
    <path d="M7 2h7v7M14 2 9 7" />
  </Svg>
);
export const IconEye = (p: IconProps) => (
  <Svg {...p}>
    <path d="M1.4 8S3.8 3.4 8 3.4 14.6 8 14.6 8 12.2 12.6 8 12.6 1.4 8 1.4 8z" />
    <circle cx="8" cy="8" r="2" />
  </Svg>
);
export const IconEyeOff = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.4 10.4C1.8 9.4 1.4 8 1.4 8S3.8 3.4 8 3.4c1 0 1.9.2 2.7.6M13.4 5.4c.8 1.2 1.2 2.6 1.2 2.6S12.2 12.6 8 12.6c-.9 0-1.8-.2-2.6-.6M2 14 14 2" />
  </Svg>
);
export const IconChevron = (p: IconProps) => (
  <Svg {...p}>
    <path d="m6 4 4 4-4 4" />
  </Svg>
);
export const IconUsers = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="6" cy="5.4" r="2.4" />
    <path d="M1.8 13.6c.6-2.4 2.2-3.6 4.2-3.6s3.6 1.2 4.2 3.6" />
    <path d="M10.6 3.2a2.4 2.4 0 0 1 0 4.6M12.2 10.2c1 .6 1.7 1.8 2 3.4" />
  </Svg>
);
export const IconGrid = (p: IconProps) => (
  <Svg {...p}>
    <path d="M1.6 5.6h12.8M1.6 10.4h12.8M5.6 1.6v12.8M10.4 1.6v12.8" />
  </Svg>
);
export const IconMagnet = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 2.4v5.2a5 5 0 0 0 10 0V2.4h-3v5.2a2 2 0 0 1-4 0V2.4z" />
    <path d="M3 5h3M10 5h3" />
  </Svg>
);
export const IconWire = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="6" />
    <ellipse cx="8" cy="8" rx="2.6" ry="6" />
    <path d="M2 8h12" />
  </Svg>
);
export const IconSolid = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="6" fill="currentColor" fillOpacity={0.55} />
  </Svg>
);
export const IconMaterial = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 2a6 6 0 0 0 0 12z" fill="currentColor" fillOpacity={0.7} />
    <circle cx="10.4" cy="5.6" r="1.1" fill="currentColor" />
  </Svg>
);
export const IconOrtho = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.4" y="3.4" width="11.2" height="9.2" />
    <path d="M2.4 8h11.2M8 3.4v9.2" />
  </Svg>
);
export const IconPerspective = (p: IconProps) => (
  <Svg {...p}>
    <path d="M1.6 3.2 14.4 1.6v12.8L1.6 12.8z" />
    <path d="M1.6 8h12.8M8 2.4v11.2" />
  </Svg>
);
export const IconUndo = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 4.6H10a3.6 3.6 0 0 1 0 7.2H5" />
    <path d="M7 2.4 4.6 4.6 7 6.8" />
  </Svg>
);
export const IconRedo = (p: IconProps) => (
  <Svg {...p}>
    <path d="M11 4.6H6a3.6 3.6 0 0 0 0 7.2h5" />
    <path d="M9 2.4l2.4 2.2L9 6.8" />
  </Svg>
);
export const IconPlus = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 2.6v10.8M2.6 8h10.8" />
  </Svg>
);
export const IconVertex = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.4 12.6 8 3.2l5.6 9.4z" strokeOpacity={0.6} />
    <circle cx="8" cy="3.2" r="1.6" fill="currentColor" />
    <circle cx="2.4" cy="12.6" r="1.3" fill="currentColor" />
    <circle cx="13.6" cy="12.6" r="1.3" fill="currentColor" />
  </Svg>
);
export const IconClose = (p: IconProps) => (
  <Svg {...p}>
    <path d="m4 4 8 8M12 4l-8 8" />
  </Svg>
);
export const IconLink = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6.6 9.4 9.4 6.6" />
    <path d="M7 4.6 8.4 3.2a2.8 2.8 0 0 1 4 4L11 8.6M9 11.4l-1.4 1.4a2.8 2.8 0 0 1-4-4L5 7.4" />
  </Svg>
);

const BY_KIND: Record<string, (p: IconProps) => ReactElement> = {
  cube: IconCube,
  sphere: IconSphere,
  icosphere: IconIco,
  cylinder: IconCylinder,
  cone: IconCone,
  torus: IconTorus,
  plane: IconPlane,
  capsule: IconCapsule,
  mesh: IconMesh,
  group: IconEmpty,
  point_light: IconPoint,
  spot_light: IconSpot,
  directional_light: IconSun,
};

export function KindIcon({ kind, ...p }: IconProps & { kind: string }) {
  const Icon = BY_KIND[kind] ?? IconMesh;
  return <Icon {...p} />;
}
