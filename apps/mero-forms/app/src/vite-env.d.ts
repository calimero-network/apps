/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Where public links open (see `.env.example`); unset: this page's origin. */
  readonly VITE_PUBLIC_FORM_ORIGIN?: string;
  /** The Turnstile site key for forms the contract checks itself; the team may set its own. */
  readonly VITE_TURNSTILE_SITE_KEY?: string;
}
