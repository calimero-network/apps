import Foundation
import MeroKit

/// An invitation in the web app's format (`app/src/lib/inviteCodec.ts` and
/// `inviteLink.ts`), so a link minted on a phone opens in the browser and the
/// other way round:
///
/// - payload: JSON `{invitation, kind: "namespace" | "room", groupId, groupAlias?, roomId?, contextId?, roomName?}`
/// - token: `base58(deflate(payload))`
/// - link: `https://links.calimero.network/com.calimero.mero-stream/join?invitation=<token>`
///
/// A stream link lands on the stream's rooms; a room link drops the person
/// straight into that call. Both grant the same thing (the namespace).
public struct StreamInvitation: Sendable {
    /// The registry package, which is also the links' slug (`APP_SLUG`).
    public static let packageName = "com.calimero.mero-stream"

    public enum Kind: String, Sendable { case namespace, room }

    public let invitation: SignedGroupOpenInvitation
    public let kind: Kind
    /// The namespace (stream) it admits to.
    public let namespaceId: String
    public let namespaceName: String?
    public let roomId: String?
    public let contextId: String?
    public let roomName: String?

    public init(
        invitation: SignedGroupOpenInvitation, kind: Kind, namespaceId: String, namespaceName: String? = nil,
        roomId: String? = nil, contextId: String? = nil, roomName: String? = nil
    ) {
        self.invitation = invitation
        self.kind = kind
        self.namespaceId = namespaceId
        self.namespaceName = namespaceName
        self.roomId = roomId
        self.contextId = contextId
        self.roomName = roomName
    }

    /// Whether it drops the person into one call.
    public var opensRoom: Bool { kind == .room && roomId != nil && contextId != nil }

    private struct Payload: Encodable {
        let invitation: SignedGroupOpenInvitation
        let kind: String
        let groupId: String
        let groupAlias: String?
        let roomId: String?
        let contextId: String?
        let roomName: String?
    }

    /// The shareable link.
    public func link() throws -> String {
        let token = try InviteCodec.encode(
            Payload(
                invitation: invitation, kind: kind.rawValue, groupId: namespaceId, groupAlias: namespaceName,
                roomId: roomId, contextId: contextId, roomName: roomName))
        return InviteLink.invitation(token: token, slug: Self.packageName)
    }

    /// Read a link (https, `calimero://`, the older `?invite=` form) or a bare
    /// token. Nil when it is not a Mero Stream invitation, including another
    /// app's link.
    public static func parse(_ input: String) -> StreamInvitation? {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard var token = InviteLink.token(fromPasted: trimmed, expectedSlug: packageName) else { return nil }
        if token == trimmed, let legacy = queryValue(trimmed, "invite") { token = legacy }
        guard let json = InviteCodec.decode(token: token) else { return nil }
        return parse(json: json)
    }

    /// Read the decoded payload, as the web's `decodeInvite` does: the
    /// envelope may sit under `data`, or the JSON may be the bare signed
    /// invitation; the namespace is the one the signed body names.
    public static func parse(json: String) -> StreamInvitation? {
        guard var root = try? JSONDecoder().decode(JSONValue.self, from: Data(json.utf8)) else { return nil }
        if let inner = root["data"], case .object = inner { root = inner }
        let envelope: JSONValue
        var isBare = false
        if let wrapped = root["invitation"], isSigned(wrapped) {
            envelope = wrapped
        } else if isSigned(root) {
            envelope = root
            isBare = true
        } else {
            return nil
        }
        guard let data = try? JSONEncoder().encode(envelope),
            let signed = try? JSONDecoder().decode(SignedGroupOpenInvitation.self, from: data)
        else { return nil }
        let signedGroup = signed.invitation.groupId.map { String(format: "%02x", $0 & 0xFF) }.joined()
        if isBare {
            guard !signedGroup.isEmpty else { return nil }
            return StreamInvitation(invitation: signed, kind: .namespace, namespaceId: signedGroup)
        }
        var namespaceId = signedGroup
        if namespaceId.isEmpty { namespaceId = root["groupId"]?.stringValue ?? "" }
        // A chained invitation (a namespace step then a room step): the namespace is its first step's group.
        if case .array(let chain)? = root["chain"],
            let step = chain.first(where: { $0["kind"]?.stringValue == "namespace" }),
            let group = step["groupId"]?.stringValue, !group.isEmpty
        {
            namespaceId = group
        }
        guard !namespaceId.isEmpty else { return nil }
        let kind: Kind = root["kind"]?.stringValue == "room" ? .room : .namespace
        return StreamInvitation(
            invitation: signed, kind: kind, namespaceId: namespaceId,
            namespaceName: (root["groupAlias"] ?? root["groupName"])?.stringValue,
            roomId: root["roomId"]?.stringValue, contextId: root["contextId"]?.stringValue,
            roomName: root["roomName"]?.stringValue)
    }

    private static func isSigned(_ value: JSONValue) -> Bool {
        guard case .object(let fields) = value else { return false }
        return (fields["inviter_signature"] != nil || fields["inviterSignature"] != nil) && fields["invitation"] != nil
    }

    private static func queryValue(_ link: String, _ name: String) -> String? {
        guard let q = link.firstIndex(of: "?") else { return nil }
        for pair in link[link.index(after: q)...].split(separator: "&") {
            let parts = pair.split(separator: "=", maxSplits: 1)
            if parts.count == 2, parts[0] == name {
                return String(parts[1]).removingPercentEncoding ?? String(parts[1])
            }
        }
        return nil
    }
}
