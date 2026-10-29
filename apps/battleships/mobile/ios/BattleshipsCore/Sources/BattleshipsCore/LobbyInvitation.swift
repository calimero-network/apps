import Foundation
import MeroKit

/// A lobby invitation in the web app's format (`app/src/utils/invitation.ts`), so a link minted
/// on either side opens on the other. (Kotlin `LobbyInvitation`.)
///
/// - payload: the recursive shape the web reader takes,
///   `{"invitations": [{"groupId": "<namespace hex>", "invitation": <SignedGroupOpenInvitation>,
///   "groupAlias": "<lobby name>"}], "__lobbyName": "<lobby name>", "__inviterKey": "<player key>"}`;
///   the single `{"invitation": {…}, "inviter_signature": …}` shape is read too
/// - token: `base58(deflate(payload))` (``InviteCodec``)
/// - link: `https://links.calimero.network/com.calimero.battleships/join?invitation=<token>`
public struct LobbyInvitation: Sendable {
    public let invitation: SignedGroupOpenInvitation
    public let lobbyName: String?
    /// The inviter's player key, so the joiner has someone to challenge straight away.
    public let inviterKey: String?

    public init(invitation: SignedGroupOpenInvitation, lobbyName: String? = nil, inviterKey: String? = nil) {
        self.invitation = invitation
        self.lobbyName = lobbyName
        self.inviterKey = inviterKey
    }

    /// The namespace it admits to: the hex of its SIGNED `group_id`, never a field beside it, so a
    /// tampered wrapper cannot redirect a join.
    public var namespaceId: String {
        Hex.lower(invitation.invitation.groupId.map { UInt8(truncatingIfNeeded: $0) })
    }

    public var title: String {
        if let lobbyName, !lobbyName.isEmpty { return lobbyName }
        return "a lobby"
    }

    // MARK: Encoding

    public func token() throws -> String {
        var entry: [String: JSONValue] = [
            "groupId": .string(namespaceId),
            "invitation": try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(invitation)),
        ]
        var payload: [String: JSONValue] = [:]
        if let lobbyName = lobbyName?.trimmingCharacters(in: .whitespaces), !lobbyName.isEmpty {
            entry["groupAlias"] = .string(lobbyName)
            payload[Self.lobbyNameKey] = .string(lobbyName)
        }
        if let inviterKey, Self.isKey(inviterKey) { payload[Self.inviterKeyKey] = .string(inviterKey) }
        payload["invitations"] = .array([.object(entry)])
        return try InviteCodec.encode(JSONValue.object(payload))
    }

    public func link() throws -> String {
        InviteLink.invitation(token: try token(), slug: Battleships.packageName)
    }

    // MARK: Decoding

    static let lobbyNameKey = "__lobbyName"
    static let inviterKeyKey = "__inviterKey"

    /// A link (https or `calimero://`), a bare token or raw JSON. `nil` when it holds no lobby
    /// invitation, and for another app's link.
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
            case .object(let fields) = root
        else { return nil }
        let name = fields[lobbyNameKey]?.stringValue?.trimmingCharacters(in: .whitespaces)
        let key = fields[inviterKeyKey]?.stringValue.flatMap { isKey($0) ? $0 : nil }
        var signedValue: JSONValue?
        var alias: String?
        if case .array(let list)? = fields["invitations"], let first = list.first {
            signedValue = first["invitation"]
            alias = first["groupAlias"]?.stringValue
        } else if isSignedEnvelope(root) {
            signedValue = root
            alias = fields["groupAlias"]?.stringValue
        }
        guard let signedValue, let signed = decodeSigned(signedValue) else { return nil }
        let title = [name, alias].compactMap { $0 }.first { !$0.isEmpty }
        return LobbyInvitation(invitation: signed, lobbyName: title, inviterKey: key)
    }

    private static func isSignedEnvelope(_ value: JSONValue) -> Bool {
        guard case .object(let fields) = value, case .object? = fields["invitation"] else { return false }
        return fields["inviter_signature"]?.stringValue != nil || fields["inviterSignature"]?.stringValue != nil
    }

    /// The envelope verbatim, with a camelCase signature key renamed to core's spelling.
    private static func decodeSigned(_ value: JSONValue) -> SignedGroupOpenInvitation? {
        guard isSignedEnvelope(value), case .object(var fields) = value else { return nil }
        if fields["inviter_signature"] == nil, let camel = fields["inviterSignature"] {
            fields["inviter_signature"] = camel
            fields.removeValue(forKey: "inviterSignature")
        }
        guard let data = try? JSONEncoder().encode(JSONValue.object(fields)) else { return nil }
        return try? JSONDecoder().decode(SignedGroupOpenInvitation.self, from: data)
    }

    static func isKey(_ value: String) -> Bool {
        let trimmed = value.trimmingCharacters(in: .whitespaces)
        return trimmed.count == 64 && trimmed.allSatisfy(\.isHexDigit)
    }
}
