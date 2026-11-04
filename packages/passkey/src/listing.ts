/**
 * The listing page: what a copy of an app no Calimero Cloud cluster serves
 * (a static host such as Vercel, built without `VITE_CALIMERO_CLUSTER`) shows
 * instead of signing in. A Cloud node signs people in only on the copy it
 * serves from the app's bundle, at `https://{label}.apps.calimero.network/`
 * (`appUrl`), so the page sends people there, and offers deploying the app on
 * Calimero Cloud. Framework-free: `renderListing` builds it into an element
 * for an app that is not React; `<AppListing>` is the React form.
 */
import { CLOUD_DEPLOY, appUrl } from "@calimero-apps/connect";

export interface ListingProps {
  /** The app's display name ("KV Store"). */
  name: string;
  /** One line on what the app is. */
  description?: string;
  /** The app's package id: the node-served URL is computed from it. */
  package: string;
  /**
   * A development build (`import.meta.env.DEV`): also shows how to run it
   * against local nodes, `pnpm dev:local {dir}`.
   */
  dev?: boolean;
  /** The app's directory under `apps/`, for the dev hint (default: `name`). */
  dir?: string;
  /** Another apps domain than Calimero Cloud's. */
  appsDomain?: string;
}

/** Every string and link the listing shows. */
export interface ListingCopy {
  title: string;
  description: string | null;
  openLabel: string;
  openUrl: string;
  note: string;
  deployLabel: string;
  deployUrl: string;
  /** `pnpm dev:local {dir}`, in development builds only. */
  devCommand: string | null;
}

export function listingCopy(props: ListingProps): ListingCopy {
  const { name, description, dev = false, dir, appsDomain } = props;
  return {
    title: name,
    description: description?.trim() || null,
    openLabel: `Open ${name}`,
    openUrl: appUrl(props.package, appsDomain),
    note: `This link works once ${name} runs on Calimero Cloud.`,
    deployLabel: "Deploy your own on Calimero Cloud",
    deployUrl: CLOUD_DEPLOY,
    devCommand: dev ? `pnpm dev:local ${dir ?? name}` : null,
  };
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
  testId?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  if (testId) node.dataset.testid = testId;
  return node;
}

/**
 * Builds the listing into `container` (replacing what it holds) and returns
 * its root, for an app that is not React. The same markup and copy as
 * `<AppListing>`, styled by `passkey.css`.
 */
export function renderListing(container: HTMLElement, props: ListingProps, className?: string): HTMLElement {
  const copy = listingCopy(props);
  const root = el("section", className ? `cp-listing ${className}` : "cp-listing", undefined, "app-listing");
  root.append(el("h2", "cp-listing__title", copy.title));
  if (copy.description) root.append(el("p", "cp-listing__description", copy.description));
  const open = el("a", "cp-listing__open", copy.openLabel, "listing-open");
  open.href = copy.openUrl;
  root.append(open, el("p", "cp-listing__note", copy.note));
  const deploy = el("a", "cp-listing__deploy", copy.deployLabel, "listing-deploy");
  deploy.href = copy.deployUrl;
  root.append(deploy);
  if (copy.devCommand) {
    const hint = el("p", "cp-listing__dev", "For local play run ", "listing-dev");
    hint.append(el("code", "", copy.devCommand), ".");
    root.append(hint);
  }
  container.replaceChildren(root);
  return root;
}
