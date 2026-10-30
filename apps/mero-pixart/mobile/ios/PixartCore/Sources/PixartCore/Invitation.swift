import Foundation
import MeroKit

/// A team invitation: swift-sdk's ``OrgInvitation``, the link payload every Calimero 1.0 app
/// shares, with the team's name to show as its `name`:
///
/// - payload: `{"invitation": "inv_…", "namespaceId": "<team>", "name"?: "<team name>"}`
/// - token: `base58(deflate(payload))` (``InviteCodec``)
/// - link: `https://links.calimero.network/com.calimero.mero-pixart/join?invitation=<token>`
///
/// A PixArt team is a Calimero organization. (Kotlin `PixartInvitation`.)
public struct PixartInvitation: Sendable {
    public let invitation: OrgInvitation

    public init(invitation: OrgInvitation, teamName: String? = nil) {
        self.invitation = OrgInvitation(
            namespaceId: invitation.namespaceId, token: invitation.token, contextId: invitation.contextId,
            name: teamName?.nilIfBlank ?? invitation.name?.nilIfBlank)
    }

    /// The team (organization) it admits to: the one the node minted the token for.
    public var namespaceId: String { invitation.namespaceId }
    public var teamName: String? { invitation.name }

    public var title: String { teamName ?? "a team" }

    /// The shareable link.
    public func link() throws -> String {
        try invitation.link(slug: PixartFormat.packageName)
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

    /// The decoded payload: an ``OrgInvitation``. A pre-1.0 signed invitation is refused.
    public static func parse(json: String) -> PixartInvitation? {
        guard let invitation = try? JSONDecoder().decode(OrgInvitation.self, from: Data(json.utf8)) else { return nil }
        return PixartInvitation(invitation: invitation)
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

    /// Join the team: redeem the invite token on the node. `didJoin` re-reads
    /// what the account sees.
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
