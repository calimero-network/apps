import Foundation
import MeroKit

/// An invitation in the web app's format (`app/src/utils/invitation.ts`), so a
/// link minted on either side opens on the other. (Kotlin `ModelsInvitation`.)
///
/// - payload: `{"invitation": <SignedGroupOpenInvitation>, "namespaceId": "<studio>", "contextId": "<scene>"}`
/// - token: `base58(deflate(payload))` (``InviteCodec``)
/// - link: `https://links.calimero.network/com.calimero.mero-models/join?invitation=<token>`
///
/// The signed invitation grants the studio (the namespace); `contextId` only
/// says which scene to open afterwards.
public struct ModelsInvitation: Sendable {
    public let invitation: SignedGroupOpenInvitation
    /// The payload's own `namespaceId`, used only when the signed id is unreadable.
    public let payloadNamespaceId: String
    public let contextId: String

    public init(invitation: SignedGroupOpenInvitation, namespaceId: String, contextId: String) {
        self.invitation = invitation
        self.payloadNamespaceId = namespaceId
        self.contextId = contextId
    }

    /// The studio it admits to: the hex of its SIGNED `group_id`, so a tampered
    /// wrapper cannot redirect a join.
    public var namespaceId: String {
        let signed = Hex.encode(invitation.invitation.groupId.map { UInt8(truncatingIfNeeded: $0) })
        return signed.isEmpty ? payloadNamespaceId : signed
    }

    private struct Payload: Encodable {
        let invitation: SignedGroupOpenInvitation
        let namespaceId: String
        let contextId: String
    }

    /// The shareable token.
    public func token() throws -> String {
        try InviteCodec.encode(Payload(invitation: invitation, namespaceId: namespaceId, contextId: contextId))
    }

    /// The shareable link, the only form the web app offers.
    public func link() throws -> String {
        InviteLink.invitation(token: try token(), slug: ModelsFormat.packageName)
    }

    /// Mint a link to a scene: an invitation to its studio, signed with this
    /// device's key, plus the scene to open.
    public static func mint(backend: any MeroAppBackend, namespaceId: String, contextId: String) async throws -> String {
        let signed = try await backend.createInvitation(namespaceId: namespaceId)
        return try ModelsInvitation(invitation: signed, namespaceId: namespaceId, contextId: contextId).link()
    }

    /// Parse a link (https or `calimero://`), a bare token or the raw JSON.
    /// `nil` when it holds no Mero Models invitation, and for another app's link.
    public static func parse(_ input: String) -> ModelsInvitation? {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        if trimmed.hasPrefix("{") { return parse(json: trimmed) }
        guard let token = InviteLink.token(fromPasted: trimmed, expectedSlug: ModelsFormat.packageName),
            let json = InviteCodec.decode(token: token)
        else { return nil }
        return parse(json: json)
    }

    /// The web's `parseInvitationPayload`: both ids present, and an envelope
    /// that carries `inviter_signature`. The node judges the rest.
    public static func parse(json: String) -> ModelsInvitation? {
        guard let value = try? JSONDecoder().decode(JSONValue.self, from: Data(json.utf8)),
            let namespaceId = value["namespaceId"]?.stringValue, !namespaceId.isEmpty,
            let contextId = value["contextId"]?.stringValue, !contextId.isEmpty,
            case .object(let envelope)? = value["invitation"], envelope["inviter_signature"] != nil,
            let data = try? JSONEncoder().encode(JSONValue.object(envelope)),
            let signed = try? JSONDecoder().decode(SignedGroupOpenInvitation.self, from: data)
        else { return nil }
        return ModelsInvitation(invitation: signed, namespaceId: namespaceId, contextId: contextId)
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

    /// Join. `backend` is read again after `didJoin`, which may hand the
    /// session the admitting relay.
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
        // The scene sits in the studio's root group: membership follows the
        // studio's once peers apply it. Ask a few times, joining if it is open.
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
