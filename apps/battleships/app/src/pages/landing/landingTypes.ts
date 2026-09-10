/**
 * The contract between the shared landing template and one app's config.
 *
 * GENERATED FILE — do not edit here. The source of truth is
 * `scripts/landing/template/landingTypes.ts`; every app's copy is written by
 * `pnpm landing:generate` and `pnpm landing:check` fails CI if a copy drifts.
 *
 * The two things an app owns by hand are `landing.config.ts` (its content) and
 * its animation component. Everything else is identical in all fourteen apps,
 * which is what stops "one unified landing page" decaying back into fourteen.
 */
import type { ComponentType } from 'react';

/** A `@calimero-network/mero-icons` component (lucide-shaped: `size`, `strokeWidth`). */
export type IconComponent = ComponentType<{ size?: number | string; strokeWidth?: number | string }>;

/**
 * Where the app actually runs. Drives a hero badge AND real behaviour, because a
 * badge nobody acts on is decoration:
 *
 *  - `web+desktop` — the default. Both CTAs offered.
 *  - `desktop`     — the app needs the Calimero desktop for its node/SSO. The web
 *                    page IS the front door, so the desktop CTA is promoted and
 *                    "Connect to node" is suppressed. `mero-meet`.
 *  - `web`         — the desktop is not a supported target. Keep "Connect to node"
 *                    primary; the badge explains rather than warns. `mero-stream`.
 */
export type Availability = 'web+desktop' | 'desktop' | 'web';

export interface Feature {
  /** A mero-icons component. Never an emoji — an emoji is a fixed-colour bitmap that cannot follow the dark palette. */
  icon: IconComponent;
  title: string;
  body: string;
}

export interface FaqItem {
  q: string;
  a: string;
}

export interface LandingConfig {
  /** `name` from `[package.metadata.calimero]`. */
  name: string;
  /** `package` from the same table — the identity, e.g. `com.calimero.mero-sheets`. */
  packageId: string;
  /** `description` from the same table. Used as the hero lede. */
  tagline: string;
  /** Directory under `apps/`, for the GitHub link. */
  dir: string;
  /** The app's own 512x512 icon, served from `public/`. */
  iconSrc: string;
  availability: Availability;
  /** Shown as an extra badge. `mero-stream` only, so far. */
  experimental?: boolean;
  /** True for apps that run with no node at all — `mero-blocks`, `merraria`. */
  playableOffline?: boolean;
  /** Three short proofs under the hero CTAs. */
  trust: [string, string, string];
  /** Two or three plain-language paragraphs: what this is, who for, why it differs. */
  explainer: string[];
  features: Feature[];
  /** Appended to the shared FAQ. */
  faq?: FaqItem[];
  /** Route the primary CTA goes to. Almost always `/login`. */
  loginPath?: string;
  /** Per-app hero animation. Falls back to the shared peer-sync animation. */
  animation?: ComponentType;
}
