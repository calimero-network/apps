import Foundation
import MeroKit

/// A team invitation in the web app's format (`utils/invitation.ts`,
/// `InviteModal`, `InvitationPrompt`), so a link minted on either side opens
/// on the other:
///
/// - payload: `{"invitation": <SignedGroupOpenInvitation>, "groupName"?: …, "__teamName"?: "<team name>"}`
/// - token: `base58(deflate(payload))` (``InviteCodec``)
/// - link: `https://links.calimero.network/com.calimero.mero-pixart/join?invitation=<token>`
///
/// (Kotlin `PixartInvitation`.)
public struct PixartInvitation: Sendable {
    public let invitation: SignedGroupOpenInvitation
    public let teamName: String?

    public init(invitation: SignedGroupOpenInvitation, teamName: String? = nil) {
        self.invitation = invitation
        self.teamName = teamName
    }

    /// The team it admits to: the hex of its SIGNED `group_id`.
    public var namespaceId: String {
        Hex.encode(invitation.invitation.groupId.map { UInt8(truncatingIfNeeded: $0) })
    }

    public var title: String { teamName ?? "a team" }

    private struct Payload: Encodable {
        let invitation: SignedGroupOpenInvitation
        let teamName: String?
        enum CodingKeys: String, CodingKey {
            case invitation
            case teamName = "__teamName"
        }
    }

    /// The shareable link.
    public func link() throws -> String {
        let token = try InviteCodec.encode(Payload(invitation: invitation, teamName: teamName?.nilIfBlank))
        return InviteLink.invitation(token: token, slug: PixartFormat.packageName)
    }

    /// A link (https or `calimero://`), a bare token, or raw JSON; `nil` when
    /// it holds no invitation, and for another app's link.
    public static func parse(_ input: String) -> PixartInvitation? {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        if trimmed.hasPrefix("{") { return parse(json: trimmed) }
        guard let token = InviteLink.token(fromPasted: trimmed, expectedSlug: PixartFormat.packageName),
            let json = InviteCodec.decode(token: token)
        else { return nil }
        return parse(json: json)
    }

    /// The decoded payload (the web's `parseTeamInvitation`).
    public static func parse(json: String) -> PixartInvitation? {
        guard let root = try? JSONDecoder().decode(JSONValue.self, from: Data(json.utf8)) else { return nil }
        let name = (root["__teamName"]?.stringValue ?? root["groupName"]?.stringValue)?.nilIfBlank
        if let wrapped = root["invitation"], isEnvelope(wrapped), let signed = decodeSigned(wrapped) {
            return PixartInvitation(invitation: signed, teamName: name)
        }
        if isEnvelope(root), let signed = decodeSigned(root) { return PixartInvitation(invitation: signed, teamName: name) }
        return nil
    }

    private static func isEnvelope(_ value: JSONValue) -> Bool {
        guard case .object(let fields) = value, case .object? = fields["invitation"] else { return false }
        return fields["inviter_signature"]?.stringValue != nil || fields["inviterSignature"]?.stringValue != nil
    }

    private static func decodeSigned(_ value: JSONValue) -> SignedGroupOpenInvitation? {
        guard case .object(var fields) = value else { return nil }
        if fields["inviter_signature"] == nil, let camel = fields["inviterSignature"] {
            fields["inviter_signature"] = camel
            fields.removeValue(forKey: "inviterSignature")
        }
        guard let data = try? JSONEncoder().encode(JSONValue.object(fields)) else { return nil }
        return try? JSONDecoder().decode(SignedGroupOpenInvitation.self, from: data)
    }
}

/// Redeeming an invitation link: confirm, join the team, then open it. (Kotlin
/// `InvitationModel`; the web's `InvitationPrompt`.)
@MainActor
public final class InvitationModel: ObservableObject {
    public enum Stage: Equatable {
        case idle
        case confirm(title: String)
        case joining(title: String)
        case joined(teamId: String, name: String)
        case failed(String)
    }

    @Published public private(set) var stage: Stage = .idle
    public private(set) var invitation: PixartInvitation?

    public init() {}

    /// Read a link. `false` (and a failed stage) when it is not a Mero PixArt invitation.
    @discardableResult
    public func open(_ raw: String) -> Bool {
        guard let parsed = PixartInvitation.parse(raw) else {
            invitation = nil
            stage = .failed("This isn't a Mero PixArt invitation. Check the link and try again.")
            return false
        }
        invitation = parsed
        stage = .confirm(title: parsed.title)
        return true
    }

    /// Join the team. `didJoin` may hand the session the admitting relay.
    public func accept(
        backend: @escaping @MainActor () -> (any MeroAppBackend)?,
        didJoin: @escaping @MainActor () async -> Void
    ) async {
        guard let invitation, let current = backend() else {
            stage = .failed("Sign in to join.")
            return
        }
        stage = .joining(title: invitation.title)
        do {
            _ = try await current.joinNamespace(namespaceId: invitation.namespaceId, invitation: invitation.invitation)
        } catch {
            let text = "\(error)".lowercased()
            if !(text.contains("already a member") || text.contains("already member") || text.contains("already joined")) {
                stage = .failed(PixartFormat.errorText(error))
                return
            }
        }
        await didJoin()
        stage = .joined(teamId: invitation.namespaceId, name: invitation.teamName ?? "Team")
    }

    public func reset() {
        invitation = nil
        stage = .idle
    }
}

extension String {
    var nilIfBlank: String? {
        let t = trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? nil : t
    }
}
