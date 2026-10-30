import Foundation
import MeroKit

/// An invitation link in the shape every Calimero 1.0 app shares (the SDK's
/// `MeroKitUI.InvitationLinkPayload`, mirrored as ``Payload`` so this package
/// needs only `MeroKit`), so a link minted here opens in any client of
/// the package. (Kotlin `ModelsInvitation`.)
///
/// - payload: `{"invitation": {"orgId": "<studio>", "token": "inv_…"}, "namespaceId": "<studio>", "contextId": "<scene>"}`
/// - token: `base58(deflate(payload))` (``InviteCodec``)
/// - link: `https://links.calimero.network/com.calimero.mero-models/join?invitation=<token>`
///
/// The invite token admits to the studio (the organization); `contextId` only
/// says which scene (app instance) to open afterwards.
public struct ModelsInvitation: Sendable {
    public let invitation: OrgInvitation
    public let contextId: String

    public init(invitation: OrgInvitation, contextId: String) {
        self.invitation = invitation
        self.contextId = contextId
    }

    /// The studio it admits to: the organization the node minted the token
    /// for, so a tampered wrapper cannot redirect a join.
    public var namespaceId: String { invitation.orgId }

    /// The link's JSON: `MeroKitUI.InvitationLinkPayload`'s shape. Decoding
    /// ignores any other field.
    struct Payload: Codable {
        var invitation: OrgInvitation
        var namespaceId: String
        var contextId: String?
    }

    /// The shareable token.
    public func token() throws -> String {
        try InviteCodec.encode(Payload(invitation: invitation, namespaceId: namespaceId, contextId: contextId))
    }

    /// The shareable link.
    public func link() throws -> String {
        InviteLink.invitation(token: try token(), slug: ModelsFormat.packageName)
    }

    /// Mint a link to a scene: an invite token to its studio, plus the scene to open.
    public static func mint(backend: any MeroAppBackend, namespaceId: String, contextId: String) async throws -> String {
        let invitation = try await backend.createInvitation(namespaceId: namespaceId)
        return try ModelsInvitation(invitation: invitation, contextId: contextId).link()
    }

    /// Parse a link (https or `calimero://`), a bare token or the raw JSON.
    /// `nil` when it holds no Mero Models invitation, and for another app's link.
    public static func parse(_ input: String) -> ModelsInvitation? {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        if trimmed.hasPrefix("{") { return parse(json: trimmed) }
        guard let token = InviteLink.token(fromPasted: trimmed, expectedSlug: ModelsFormat.packageName),
            let payload = try? InviteCodec.decode(Payload.self, from: token)
        else { return nil }
        return from(payload)
    }

    /// The payload as JSON: an invite token and a scene to open. The node judges the rest.
    public static func parse(json: String) -> ModelsInvitation? {
        guard let payload = try? JSONDecoder().decode(Payload.self, from: Data(json.utf8)) else {
            return nil
        }
        return from(payload)
    }

    private static func from(_ payload: Payload) -> ModelsInvitation? {
        guard !payload.invitation.orgId.isEmpty, !payload.invitation.token.isEmpty,
            let contextId = payload.contextId, !contextId.isEmpty
        else { return nil }
        return ModelsInvitation(invitation: payload.invitation, contextId: contextId)
    }
}

/// Redeeming an invitation link: confirm, join the studio, then open the
/// scene. (Kotlin `InvitationModel`; the web app's `useJoinFromInvitation`.)
@MainActor
public final class InvitationModel: ObservableObject {
    public enum Stage: Equatable {
        case idle
        case confirm
        case joining
        case joined(namespaceId: String, contextId: String)
        case failed(String)
    }

    @Published public private(set) var stage: Stage = .idle
    public private(set) var invitation: ModelsInvitation?
    private let attempts: Int
    private let retryDelay: UInt64

    public init(attempts: Int = 4, retryDelayMs: UInt64 = 1500) {
        self.attempts = attempts
        self.retryDelay = retryDelayMs * 1_000_000
    }

    /// Read a link or a pasted code. `false` (and a failed stage) when it is not
    /// a Mero Models invitation.
    @discardableResult
    public func open(_ raw: String) -> Bool {
        guard let parsed = ModelsInvitation.parse(raw) else {
            invitation = nil
            stage = .failed("This isn't a Mero Models invitation. Check the link and try again.")
            return false
        }
        invitation = parsed
        stage = .confirm
        return true
    }

    /// Join: redeem the invite token on the node, then make sure the scene is
    /// reachable. `backend` is read again after `didJoin`, which re-reads what
    /// the account sees.
    public func accept(
        backend: @escaping @MainActor () -> (any MeroAppBackend)?,
        didJoin: @escaping @MainActor () async -> Void
    ) async {
        guard let invitation, let current = backend() else {
            stage = .failed("Sign in to join.")
            return
        }
        stage = .joining
        let namespaceId = invitation.namespaceId
        do {
            _ = try await current.joinNamespace(namespaceId: namespaceId, invitation: invitation.invitation)
        } catch {
            let text = "\(error)".lowercased()
            if !(text.contains("already a member") || text.contains("already member") || text.contains("already joined")) {
                stage = .failed(ModelsFormat.errorText(error))
                return
            }
        }
        await didJoin()
        // The scene is an app instance of the studio: membership in the org
        // reaches it once the node commits the redemption. Ask a few times.
        for attempt in 0..<attempts {
            if attempt > 0 { try? await Task.sleep(nanoseconds: retryDelay) }
            guard let now = backend() else { break }
            if (try? await now.isMember(contextId: invitation.contextId)) == true { break }
            if (try? await now.joinContext(contextId: invitation.contextId)) != nil { break }
        }
        stage = .joined(namespaceId: namespaceId, contextId: invitation.contextId)
    }

    /// Not now, or done.
    public func reset() {
        invitation = nil
        stage = .idle
    }
}
