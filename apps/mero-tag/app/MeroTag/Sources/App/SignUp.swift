import Foundation
import MeroKit
import MeroKitUI

/// Creating an account (core 1.0.0-rc.10): the node asks the new passkey to
/// sign the account it makes, so a sign-up prompts twice; a cluster may take
/// new accounts by invitation only, or not at all.
extension AppState {
    /// Sign up as `name` on the connected cluster, with `invite` when given.
    /// Reads the cluster's sign-up policy first, so an invite-only cluster is
    /// explained before any passkey prompt. A failure lands in the client's
    /// `errorMessage`.
    func signUp(name: String, invite: String?) async -> Bool {
        guard let cloud = client.cloud, let passkey = client.passkeyForNode() else {
            client.errorMessage = "Enter your cluster's address first."
            return false
        }
        isCreatingAccount = true
        defer { isCreatingAccount = false }
        if invite == nil, let policy = try? await cloud.signUpPolicy(), policy.inviteRequired {
            signUpNeedsInvite = true
            client.errorMessage = Self.signUpRequiresInvite(policy.policy)
            return false
        }
        do {
            try await cloud.signUp(passkey, name: name, invite: invite)
        } catch let refused as SignUpRefused {
            if refused.reason != .orgGone && refused.reason != .other { signUpNeedsInvite = true }
            client.errorMessage = Self.describe(refused)
            return false
        } catch {
            client.errorMessage = MeroClient.describe(error)
            return false
        }
        // The client hears the new session through its session observer.
        for _ in 0..<50 where !client.isAuthenticated {
            try? await Task.sleep(nanoseconds: 20_000_000)
        }
        signUpNeedsInvite = false
        return client.isAuthenticated
    }

    /// The org invite token inside a Mero Tag invite link or code, or the
    /// text as it is (a cluster sign-up invite); `nil` when empty.
    static func signUpInvite(from raw: String) -> String? {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }
        return SpaceInvite.decode(pasted: text)?.token ?? text
    }

    static func signUpRequiresInvite(_ policy: SignUpPolicy.Policy) -> String {
        policy == .closed
            ? "This cluster isn't taking new accounts. Sign in with an existing one, or ask the cluster's "
                + "operator for a sign-up invite."
            : "This cluster takes new accounts by invitation only. Paste the invite link or code you were sent."
    }

    static func describe(_ refused: SignUpRefused) -> String {
        switch refused.reason {
        case .inviteOnly: return signUpRequiresInvite(.invite)
        case .closed: return signUpRequiresInvite(.closed)
        case .unknownInvite: return "This cluster doesn't recognize that invite. Check the link or code, or ask for a new one."
        case .expiredInvite: return "That invite has expired or been used up. Ask for a new one."
        case .orgGone: return "The space that invite was for no longer exists."
        case .other: return refused.message.isEmpty ? "This cluster refused the sign-up." : refused.message
        }
    }
}
