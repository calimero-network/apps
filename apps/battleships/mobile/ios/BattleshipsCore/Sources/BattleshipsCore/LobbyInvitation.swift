import Foundation
import MeroKit

/// A lobby invitation: Calimero 1.0's org invite token in the SDK's link shape
/// (`MeroKitUI.InvitationLinkPayload`), plus the lobby's name and the inviter's key.
/// (Kotlin `LobbyInvitation`.)
///
/// - payload: `{"invitation": {"orgId": "<org>", "token": "inv_…"}, "namespaceId": "<org>",
///   "__lobbyName": "<lobby name>", "__inviterKey": "<player key>"}`; the SDK reads the first two
///   fields and ignores the rest
/// - token: `base58(deflate(payload))` (``InviteCodec``)
/// - link: `https://links.calimero.network/com.calimero.battleships/join?invitation=<token>`
///
/// The token is a bearer secret the org's node minted (`POST /orgs/{org}/invites`); redeeming it
/// (`POST /invites/{token}/redeem`) is what admits, so a wrapper naming another org cannot
/// redirect a join: the node joins the org the token belongs to.
public struct LobbyInvitation: Sendable {
    public let invitation: OrgInvitation
    public let lobbyName: String?
    /// The inviter's player key, so the joiner has someone to challenge straight away.
    public let inviterKey: String?

    public init(invitation: OrgInvitation, lobbyName: String? = nil, inviterKey: String? = nil) {
        self.invitation = invitation
        self.lobbyName = lobbyName
        self.inviterKey = inviterKey
    }

    /// The org (lobby) it admits to.
    public var namespaceId: String { invitation.orgId }

    public var title: String {
        if let lobbyName, !lobbyName.isEmpty { return lobbyName }
        return "a lobby"
    }

    // MARK: Encoding

    public func token() throws -> String {
        var payload: [String: JSONValue] = [
            "invitation": .object(["orgId": .string(invitation.orgId), "token": .string(invitation.token)]),
            "namespaceId": .string(invitation.orgId),
        ]
        if let lobbyName = lobbyName?.trimmingCharacters(in: .whitespaces), !lobbyName.isEmpty {
            payload[Self.lobbyNameKey] = .string(lobbyName)
        }
        if let inviterKey, Self.isKey(inviterKey) { payload[Self.inviterKeyKey] = .string(inviterKey) }
        return try InviteCodec.encode(JSONValue.object(payload))
    }

    public func link() throws -> String {
        InviteLink.invitation(token: try token(), slug: Battleships.packageName)
    }

    // MARK: Decoding

    static let lobbyNameKey = "__lobbyName"
    static let inviterKeyKey = "__inviterKey"

    /// A link (https or `calimero://`), a bare token or raw JSON. `nil` when it holds no lobby
    /// invitation, and for another app's link. Pre-1.0 signed invitations are not read: a 1.0
    /// cluster cannot redeem them.
    public static func parse(_ input: String) -> LobbyInvitation? {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        if trimmed.hasPrefix("{") { return parse(json: trimmed) }
        guard let token = InviteLink.token(fromPasted: trimmed, expectedSlug: Battleships.packageName),
            let json = InviteCodec.decode(token: token)
        else { return nil }
        return parse(json: json)
    }

    public static func parse(json: String) -> LobbyInvitation? {
        guard let root = try? JSONDecoder().decode(JSONValue.self, from: Data(json.utf8)),
            case .object(let fields) = root,
            let token = fields["invitation"]?["token"]?.stringValue, !token.isEmpty
        else { return nil }
        let org = fields["invitation"]?["orgId"]?.stringValue ?? fields["namespaceId"]?.stringValue ?? ""
        guard !org.isEmpty else { return nil }
        let name = fields[lobbyNameKey]?.stringValue?.trimmingCharacters(in: .whitespaces)
        let key = fields[inviterKeyKey]?.stringValue.flatMap { isKey($0) ? $0 : nil }
        return LobbyInvitation(
            invitation: OrgInvitation(orgId: org, token: token), lobbyName: name?.isEmpty == false ? name : nil,
            inviterKey: key)
    }

    static func isKey(_ value: String) -> Bool {
        let trimmed = value.trimmingCharacters(in: .whitespaces)
        return trimmed.count == 64 && trimmed.allSatisfy(\.isHexDigit)
    }
}
