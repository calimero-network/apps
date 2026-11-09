import Foundation
import MeroKit

/// The device's passkey for a sign-up, with its second prompt on a tap of its own.
///
/// On core rc.9+ a sign-up prompts twice: the passkey is made
/// (`register/begin` + `create`), then the node answers `412
/// CONFIRM_REQUIRED` and the new passkey signs the account it creates
/// (`get`). MeroKit 0.6.0 does both in `CalimeroClient.signUp`. Asked back to
/// back, the system sheet or a password manager can refuse the second request,
/// so here `get` first waits for `awaitTap` (the screen's "Confirm" button),
/// like the web app's sign-up. `create` passes straight through, and the
/// relying party is always the node's (`options.rp.id`, the 412's `rpId`).
struct SignUpPasskey: PasskeyProvider {
    let base: any PasskeyProvider
    /// Returns once the person taps to confirm; throws ``PasskeyCancelled`` if they back out.
    let awaitTap: @Sendable () async throws -> Void

    func create(options: JSONValue) async throws -> RegistrationJSON {
        try await base.create(options: options)
    }

    func get(challenge: Data, rpId: String, allowCredentials: [String]?) async throws -> AssertionJSON {
        try await awaitTap()
        return try await base.get(challenge: challenge, rpId: rpId, allowCredentials: allowCredentials)
    }
}
