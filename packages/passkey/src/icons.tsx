/** The control's line icons: 24-unit strokes in `currentColor`, hidden from assistive tech. */
const svg = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  focusable: false,
};

/** A key with a person: the passkey mark. */
export function PasskeyIcon() {
  return (
    <svg {...svg}>
      <circle cx="9" cy="7.5" r="3.5" />
      <path d="M2.5 20v-1.2A5.3 5.3 0 0 1 7.8 13.5h2.4c.9 0 1.7.2 2.5.6" />
      <circle cx="18" cy="12" r="2.5" />
      <path d="M18 14.5V21l1.5-1.4L18 18.2l1.5-1.4" />
    </svg>
  );
}

export function PlusIcon() {
  return (
    <svg {...svg} width={16} height={16}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function AlertIcon() {
  return (
    <svg {...svg} width={16} height={16}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5M12 16.5v.01" />
    </svg>
  );
}

/** A life buoy: getting back in. */
export function LifebuoyIcon() {
  return (
    <svg {...svg} width={15} height={15}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3.5" />
      <path d="m5.6 5.6 3.9 3.9M14.5 14.5l3.9 3.9M18.4 5.6l-3.9 3.9M9.5 14.5l-3.9 3.9" />
    </svg>
  );
}

export function ClockIcon() {
  return (
    <svg {...svg}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

/** A shield with a mark: something about the account's safety. */
export function ShieldIcon() {
  return (
    <svg {...svg}>
      <path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.3 7.5 9.5 4.3-1.2 7.5-4.9 7.5-9.5V6L12 3Z" />
      <path d="M12 8.5v4M12 15.5v.01" />
    </svg>
  );
}

export function ArrowLeftIcon() {
  return (
    <svg {...svg} width={15} height={15}>
      <path d="M19 12H5M11 6l-6 6 6 6" />
    </svg>
  );
}

export function ExternalIcon() {
  return (
    <svg {...svg} width={16} height={16}>
      <path d="M14 4h6v6M20 4l-9 9" />
      <path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
    </svg>
  );
}

export function Spinner() {
  return <span className="cp-passkey__spinner" aria-hidden="true" />;
}
