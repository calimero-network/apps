import { asPlatform, platformName } from "./lib/transcript";

const LETTER = { meet: "M", zoom: "Z", teams: "T", upload: "", other: "" } as const;

/** A small tinted tile for the call's platform; its name for screen readers. */
export function PlatformMark({ platform, size = 34 }: { platform: string; size?: number }) {
  const p = asPlatform(platform);
  return (
    <span
      className={`platform platform-${p}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label={platformName(platform)}
      title={platformName(platform)}
    >
      {p === "upload" ? (
        <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2 8h1M4.5 5v6M7 3v10M9.5 5.5v5M12 6.5v3M14 8h0" />
        </svg>
      ) : p === "other" ? (
        <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="1.5" y="4" width="9" height="8" rx="1.5" />
          <path d="m10.5 7 4-2.5v7l-4-2.5" />
        </svg>
      ) : (
        <span aria-hidden="true">{LETTER[p]}</span>
      )}
    </span>
  );
}
