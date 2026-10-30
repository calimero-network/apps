import Foundation
import MeroKit

/// An invitation: Calimero 1.0's org invite token in the SDK's link shape
/// (``OrgInvitation``), plus which vault to open:
///
/// - payload: `{"invitation": "inv_…", "namespaceId": "<team org>", "name": "<team name>",
///   "contextId"?, "kind": "namespace" | "vault", "vaultId"?, "vaultName"?}`
/// - token: `base58(deflate(payload))` (``InviteCodec``)
/// - link: `https://links.calimero.network/com.calimero.mero-pass/join?invitation=<token>`
///
/// The token always grants the TEAM (an org; redeemed with
/// `POST /invites/{token}/redeem`); a vault invite only says which vault to open
/// afterwards. No vault secret travels in it, but the token itself is a bearer
/// secret until it is used up. A pre-1.0 signed invitation is refused: a 1.0
/// cluster cannot redeem it.
public struct PassInvitation: Sendable {
    public enum Kind: String, Sendable { case team = "namespace", vault }

    public let invitation: OrgInvitation
    public let kind: Kind
    public let teamName: String?
    public let vaultId: String?
    public let vaultName: String?
    public let contextId: String?
    /// The web's invite-only vault form (`"inviteOnly": true`): a vault the
    /// team invitation does not open by itself; a phone cannot admit to it yet
    /// (``MeroAppBackend`` admits to orgs only).
    public let isInviteOnlyVault: Bool

    public init(
        invitation: OrgInvitation, kind: Kind = .team, teamName: String? = nil, vaultId: String? = nil,
        vaultName: String? = nil, contextId: String? = nil, isInviteOnlyVault: Bool = false
    ) {
        self.invitation = invitation
        self.kind = kind
        self.teamName = teamName
        self.vaultId = vaultId
        self.vaultName = vaultName
        self.contextId = contextId
        self.isInviteOnlyVault = isInviteOnlyVault
    }

    /// The team (org) it admits to.
    public var namespaceId: String { invitation.namespaceId }

    /// What to call it in a prompt: the vault for a vault invite, else the team.
    public var title: String {
        if kind == .vault, let vaultName, !vaultName.isEmpty { return vaultName }
        if let teamName, !teamName.isEmpty { return teamName }
        return "a team"
    }

    // MARK: Encoding

    public func token() throws -> String {
        let base = OrgInvitation(
            namespaceId: invitation.namespaceId, token: invitation.token, contextId: contextId?.nilIfBlank,
            name: teamName?.nilIfBlank)
        guard case .object(var payload) = try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(base))
        else { return try base.encoded() }
        payload["kind"] = .string(kind.rawValue)
        if let vaultId = vaultId?.nilIfBlank { payload["vaultId"] = .string(vaultId) }
        if let vaultName = vaultName?.nilIfBlank { payload["vaultName"] = .string(vaultName) }
        if isInviteOnlyVault { payload["inviteOnly"] = .bool(true) }
        return try InviteCodec.encode(JSONValue.object(payload))
    }

    public func link() throws -> String {
        InviteLink.invitation(token: try token(), slug: PassConstants.packageName)
    }

    // MARK: Decoding

    /// A link (https or `calimero://`), a bare token, or raw JSON. `nil` when
    /// it holds no invitation, and for another app's link.
    public static func parse(_ input: String) -> PassInvitation? {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        if trimmed.hasPrefix("{") { return parse(json: trimmed) }
        let token: String?
        if trimmed.range(of: "^[A-Za-z0-9]+$", options: .regularExpression) != nil {
            token = trimmed
        } else {
            token = InviteLink.token(fromPasted: trimmed, expectedSlug: PassConstants.packageName)
        }
        guard let token, let json = InviteCodec.decode(token: token) else { return nil }
        return parse(json: json)
    }

    /// The payload, under an optional `data` envelope, including the web's older `room*` names.
    public static func parse(json: String) -> PassInvitation? {
        guard let parsed = try? JSONDecoder().decode(JSONValue.self, from: Data(json.utf8)) else { return nil }
        let inner = parsed["data"] ?? parsed
        guard let data = try? JSONEncoder().encode(inner),
            let base = try? JSONDecoder().decode(OrgInvitation.self, from: data)
        else { return nil }
        let rawKind = inner["kind"]?.stringValue
        let kind: Kind = rawKind == "vault" || rawKind == "room" ? .vault : .team
        return PassInvitation(
            invitation: base, kind: kind,
            teamName: (base.name ?? inner["groupName"]?.stringValue ?? inner["groupAlias"]?.stringValue)?.nilIfBlank,
            vaultId: (inner["vaultId"]?.stringValue ?? inner["roomId"]?.stringValue)?.nilIfBlank,
            vaultName: (inner["vaultName"]?.stringValue ?? inner["roomName"]?.stringValue)?.nilIfBlank,
            contextId: base.contextId?.nilIfBlank,
            isInviteOnlyVault: inner["inviteOnly"]?.boolValue ?? false)
    }
}
