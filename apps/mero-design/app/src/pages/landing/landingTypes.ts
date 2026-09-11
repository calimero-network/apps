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

/**
 * One section of the `/docs` page — this app's real documentation, not a link
 * to somebody else's.
 *
 * Every field is optional except the heading, because the sections genuinely
 * differ in shape: "What it is" is prose, "Concepts" is a term list, "Getting
 * started" is ordered steps, "Troubleshooting" is symptom and fix. Rendering
 * whichever ones are present beats forcing six sections into one mould.
 */
export interface DocsSection {
  /** Anchor id, also the TOC link target. */
  id: string;
  heading: string;
  paragraphs?: string[];
  /**
   * What a Calimero noun means IN THIS APP — `namespace` → "a vault",
   * `context` → "a board". The single most useful thing a per-app doc can say,
   * because the platform words are the ones a newcomer cannot map.
   */
  concepts?: { term: string; def: string }[];
  /** Ordered, numbered. Getting started, inviting someone. */
  steps?: { title: string; body: string }[];
  bullets?: string[];
}

/** One captioned beat of the hero animation, for the `/preview` page. */
export interface PreviewStep {
  title: string;
  body: string;
}

/**
 * The login popup, wired in by the generator for every app that depends on
 * `@calimero-network/mero-react` — which is thirteen of the fourteen.
 *
 * ⚠️ A component, not a direct import, for two reasons. `mero-sign` has no
 * mero-react dependency at all (it signs in through its own sidebar and passes
 * `onConnect`), so a top-level import in the shared template would fail to
 * build there. And the component calls `useMero()`, which throws outside a
 * `MeroProvider` — the two canvas games render this page into a detached root
 * with no provider above it, and they also pass `onConnect`. Keeping it in the
 * config means the import only exists where the provider does.
 */
export interface LoginPopupProps {
  isOpen: boolean;
  onClose: () => void;
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
  /**
   * The app's own logo mark, served from `public/` — the SAME asset as the
   * browser tab favicon and the Tauri icon, so the three never diverge. An SVG
   * because the header renders it at 24px and a 512px raster is wasteful there.
   */
  markSrc: string;
  /** The 512x512 raster, for anywhere a bitmap is genuinely wanted. */
  iconSrc: string;
  availability: Availability;
  /**
   * The localStorage key this app's OWN theme switch uses, for the apps that
   * ship one. Set it and the landing toggle writes that key too, so choosing
   * dark here is still dark after sign-in. Omit it for apps with no theme of
   * their own — the landing then keeps its choice to itself.
   */
  themeStorageKey?: string;
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
  /** Per-app hero animation. Falls back to the shared peer-sync animation. */
  animation?: ComponentType;
  /**
   * The `/docs` page. Written per app: what it stores, how the platform's nouns
   * map onto this app's, how to invite people, what happens offline, and what
   * to do when something looks wrong.
   */
  docs: DocsSection[];
  /** The `/preview` page: what each beat of the animation is showing. */
  previewSteps: PreviewStep[];
  /**
   * Opens the node-connection + sign-in popup. Absent only where the app has no
   * mero-react dependency; see `LoginPopupProps`.
   */
  loginPopup?: ComponentType<LoginPopupProps>;
}
