import Foundation
import MeroKit

/// A lobby invitation: Calimero 1.0's org invite token in the SDK's link shape
/// (``OrgInvitation``), plus the inviter's player key. (Kotlin `LobbyInvitation`.)
///
/// - payload: `{"invitation": "inv_…", "namespaceId": "<org>", "name": "<lobby name>",
///   "__lobbyName": "<lobby name>", "__inviterKey": "<player key>"}`; the SDK reads the first
///   three and ignores the rest
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
    public var namespaceId: String { invitation.namespaceId }

    public var title: String {
        if let lobbyName, !lobbyName.isEmpty { return lobbyName }
        return "a lobby"
    }

    // MARK: Encoding

    public func token() throws -> String {
        let name = lobbyName?.trimmingCharacters(in: .whitespaces)
        let base = OrgInvitation(
            namespaceId: invitation.namespaceId, token: invitation.token, contextId: invitation.contextId,
            name: name?.isEmpty == false ? name : nil)
        guard case .object(var payload) = try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(base))
        else { return try base.encoded() }
        if let name = base.name { payload[Self.lobbyNameKey] = .string(name) }
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
            let base = try? JSONDecoder().decode(OrgInvitation.self, from: Data(json.utf8))
        else { return nil }
        let name = [fields[lobbyNameKey]?.stringValue, base.name]
            .compactMap { $0?.trimmingCharacters(in: .whitespaces) }
            .first { !$0.isEmpty }
        let key = fields[inviterKeyKey]?.stringValue.flatMap { isKey($0) ? $0 : nil }
        return LobbyInvitation(invitation: base, lobbyName: name, inviterKey: key)
    }

    static func isKey(_ value: String) -> Bool {
        let trimmed = value.trimmingCharacters(in: .whitespaces)
        return trimmed.count == 64 && trimmed.allSatisfy(\.isHexDigit)
    }
}
