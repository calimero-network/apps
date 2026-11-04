import { listingCopy, type ListingProps } from "./listing";

export interface AppListingProps extends ListingProps {
  className?: string;
}

/**
 * The listing page every app shows on a copy no Calimero Cloud cluster serves
 * (session status `listing`): the app's name and one line on it, "Open {name}"
 * at the copy Calimero Cloud serves, and a link to deploy it there. Themed by
 * the same `--passkey-*` tokens as `<PasskeySignIn>`.
 */
export function AppListing({ className, ...props }: AppListingProps) {
  const copy = listingCopy(props);
  return (
    <section className={className ? `cp-listing ${className}` : "cp-listing"} data-testid="app-listing">
      <h2 className="cp-listing__title">{copy.title}</h2>
      {copy.description && <p className="cp-listing__description">{copy.description}</p>}
      <a className="cp-listing__open" data-testid="listing-open" href={copy.openUrl}>
        {copy.openLabel}
      </a>
      <p className="cp-listing__note">{copy.note}</p>
      <a className="cp-listing__deploy" data-testid="listing-deploy" href={copy.deployUrl}>
        {copy.deployLabel}
      </a>
      {copy.devCommand && (
        <p className="cp-listing__dev" data-testid="listing-dev">
          For local play run <code>{copy.devCommand}</code>.
        </p>
      )}
    </section>
  );
}
