import Foundation
import MeroKit

/// An invitation in the web app's format (`app/src/lib/inviteCodec.ts`), so a
/// link minted on either side opens on the other:
///
/// - payload: `{"invitation": <SignedGroupOpenInvitation>, "kind": "namespace" | "vault",
///   "groupId": "<team>", "groupAlias": "<team name>", "vaultId", "vaultName", "contextId"}`
/// - token: `base58(deflate(payload))` (``InviteCodec``)
/// - link: `https://links.calimero.network/com.calimero.mero-pass/join?invitation=<token>`
///
/// The signed invitation always grants the TEAM (namespace); a vault invite
/// only says which vault to open afterwards. Nothing secret travels in it.
public struct PassInvitation: Sendable {
    public enum Kind: String, Sendable { case team = "namespace", vault }

    public let invitation: SignedGroupOpenInvitation
    public let kind: Kind
    public let teamName: String?
    public let vaultId: String?
    public let vaultName: String?
    public let contextId: String?
    /// The web's invite-only vault form: a second, vault invitation a phone
    /// cannot redeem yet (``MeroAppBackend`` admits to namespaces only).
    public let isInviteOnlyVault: Bool

    public init(
        invitation: SignedGroupOpenInvitation, kind: Kind = .team, teamName: String? = nil, vaultId: String? = nil,
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

    /// The team it admits to: the hex of its SIGNED `group_id`, never a field
    /// beside it, so a tampered wrapper cannot redirect a join.
    public var namespaceId: String {
        Hex.encode(invitation.invitation.groupId.map { UInt8(truncatingIfNeeded: $0) })
    }

    /// What to call it in a prompt: the vault for a vault invite, else the team.
    public var title: String {
        if kind == .vault, let vaultName, !vaultName.isEmpty { return vaultName }
        if let teamName, !teamName.isEmpty { return teamName }
        return "a team"
    }

    // MARK: Encoding

    private struct Payload: Encodable {
        let invitation: SignedGroupOpenInvitation
        let kind: String
        let groupId: String
        let groupAlias: String?
        let vaultId: String?
        let vaultName: String?
        let contextId: String?
    }

    public func token() throws -> String {
        try InviteCodec.encode(
            Payload(
                invitation: invitation, kind: kind.rawValue, groupId: namespaceId, groupAlias: teamName?.nilIfBlank,
                vaultId: vaultId, vaultName: vaultName?.nilIfBlank, contextId: contextId))
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

    /// The web's `parsePayload`, including its older `room*` names.
    public static func parse(json: String) -> PassInvitation? {
        guard let parsed = try? JSONDecoder().decode(JSONValue.self, from: Data(json.utf8)) else { return nil }
        let inner = parsed["data"] ?? parsed
        if let wrapped = inner["invitation"], isSignedInvitation(wrapped), let signed = decodeSigned(wrapped) {
            let rawKind = inner["kind"]?.stringValue
            let kind: Kind = rawKind == "vault" || rawKind == "room" ? .vault : .team
            var chained = false
            if case .array(let chain)? = inner["chain"] { chained = chain.count > 1 }
            return PassInvitation(
                invitation: signed, kind: kind,
                teamName: (inner["groupName"]?.stringValue ?? inner["groupAlias"]?.stringValue)?.nilIfBlank,
                vaultId: (inner["vaultId"]?.stringValue ?? inner["roomId"]?.stringValue)?.nilIfBlank,
                vaultName: (inner["vaultName"]?.stringValue ?? inner["roomName"]?.stringValue)?.nilIfBlank,
                contextId: inner["contextId"]?.stringValue?.nilIfBlank,
                isInviteOnlyVault: chained)
        }
        if isSignedInvitation(inner), let signed = decodeSigned(inner) { return PassInvitation(invitation: signed) }
        return nil
    }

    private static func isSignedInvitation(_ value: JSONValue) -> Bool {
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
