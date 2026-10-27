/**
 * An application's id, computed the way merod computes it.
 *
 * core's `ApplicationId::for_bundle(package, signer_id)` is
 * `sha256(borsh((package, signer_id)))`: the package name and the publisher's
 * signing key together decide which app a bundle IS, and the version is not an
 * input, so every version a publisher ships under one package installs as the
 * same application. A node learns the id when it installs the bundle; an
 * account installs nothing, so it has to derive the id from the same two
 * inputs — both of which the registry's bundle listing carries.
 */
/** A bundle entry as `GET {registry}/api/v2/bundles?package=…` lists it. */
export interface RegistryBundle {
    package?: string;
    signerId?: string;
    appVersion?: string;
    yanked?: boolean;
    publishedAt?: string;
}
/**
 * `sha256(borsh((pkg, signerId)))` as lowercase hex: core's
 * `ApplicationId::for_bundle`. A borsh tuple is its fields concatenated.
 */
export declare function applicationIdForBundle(pkg: string, signerId: string): Promise<string>;
/**
 * The entry a package resolves to: its newest version that is not yanked. The
 * one rule for "latest", shared by the version lookup and the id derivation so
 * the two cannot disagree about which bundle an account is founding on.
 */
export declare function selectLatestBundle<B extends RegistryBundle>(bundles: readonly B[]): (B & {
    appVersion: string;
}) | undefined;
/** The registry's listing of `pkg`, every version. */
export declare function fetchRegistryBundles(registryUrl: string, pkg: string, fetchFn?: typeof fetch): Promise<RegistryBundle[]>;
export interface ResolvedApplication {
    applicationId: string;
    signerId: string;
    version: string;
}
/**
 * The application id an account founds `pkg` on, learned from the registry.
 *
 * Refused when the non-yanked versions of `pkg` name more than one publisher:
 * that is two different applications under one package name (the id binds the
 * signer), and picking either silently would commit the founder — who signs
 * `TargetApplicationSet` naming the id — to an app it did not choose.
 */
export declare function resolveApplicationIdFromRegistry(registryUrl: string, pkg: string, deps?: {
    fetch?: typeof fetch;
}): Promise<ResolvedApplication>;
