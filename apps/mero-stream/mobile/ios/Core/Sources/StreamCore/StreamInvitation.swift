import Foundation
import MeroKit

/// An invitation link: swift-sdk's ``OrgInvitation`` (the payload every
/// Calimero 1.0 app shares), plus where to land:
///
/// - payload: JSON `{invitation: "inv_…", namespaceId, contextId?, name?, kind: "namespace" | "room", roomId?, namespaceName?}`
/// - token: `base58(deflate(payload))`
/// - link: `https://links.calimero.network/com.calimero.mero-stream/join?invitation=<token>`
///
/// A stream link lands on the stream's rooms; a room link drops the person
/// straight into that call. Both grant the same thing: membership of the
/// stream's organization. `name` is the room's name for a room link, and
/// `roomId` / `contextId` are both the room's app instance.
///
/// The web app's own link (`<frontend>/?invite=inv_…&stream=<org>&room=<app>&name=…`)
/// is read too, so a link pasted from a browser opens here.
public struct StreamInvitation: Sendable {
    /// The registry package, which is also the links' slug (`APP_SLUG`).
    public static let packageName = "com.calimero.mero-stream"

    public enum Kind: String, Sendable { case namespace, room }

    public let invitation: OrgInvitation
    public let kind: Kind
    public let namespaceName: String?
    public let roomId: String?

    public init(
        invitation: OrgInvitation, kind: Kind, namespaceName: String? = nil, roomId: String? = nil,
        contextId: String? = nil, roomName: String? = nil
    ) {
        self.invitation = OrgInvitation(
            namespaceId: invitation.namespaceId, token: invitation.token, contextId: contextId ?? invitation.contextId,
            name: roomName ?? invitation.name)
        self.kind = kind
        self.namespaceName = namespaceName
        self.roomId = roomId
    }

    /// The stream (organization) it admits to: the one the node minted the token for.
    public var namespaceId: String { invitation.namespaceId }
    /// The room's call (app instance), for a room link.
    public var contextId: String? { invitation.contextId }
    public var roomName: String? { invitation.name }

    /// Whether it drops the person into one call.
    public var opensRoom: Bool { kind == .room && roomId != nil }

    private struct Payload: Codable {
        let invitation: String
        let namespaceId: String
        let contextId: String?
        let name: String?
        let kind: String?
        let roomId: String?
        let namespaceName: String?
    }

    /// The shareable link.
    public func link() throws -> String {
        let token = try InviteCodec.encode(
            Payload(
                invitation: invitation.token, namespaceId: namespaceId, contextId: contextId, name: roomName,
                kind: kind.rawValue, roomId: roomId, namespaceName: namespaceName))
        return InviteLink.invitation(token: token, slug: Self.packageName)
    }

    /// Read a link (https, `calimero://`, the older `?invite=` form) or a bare
    /// token. Nil when it is not a Mero Stream invitation, including another
    /// app's link.
    public static func parse(_ input: String) -> StreamInvitation? {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        if let web = parseWebLink(trimmed) { return web }
        guard var token = InviteLink.token(fromPasted: trimmed, expectedSlug: packageName) else { return nil }
        if token == trimmed, let legacy = queryValue(trimmed, "invite") { token = legacy }
        guard let json = InviteCodec.decode(token: token) else { return nil }
        return parse(json: json)
    }

    /// Read the decoded payload. Only an ``OrgInvitation`` (an `inv_…` token
    /// and its organization) is an invitation; a pre-1.0 signed one is not.
    public static func parse(json: String) -> StreamInvitation? {
        let data = Data(json.utf8)
        guard let invitation = try? JSONDecoder().decode(OrgInvitation.self, from: data),
            let payload = try? JSONDecoder().decode(Payload.self, from: data)
        else { return nil }
        return StreamInvitation(
            invitation: invitation, kind: payload.kind == Kind.room.rawValue ? .room : .namespace,
            namespaceName: payload.namespaceName, roomId: payload.roomId)
    }

    /// The web frontend's link: `?invite=inv_…&stream=<org>[&room=<app>][&name=…]`.
    static func parseWebLink(_ link: String) -> StreamInvitation? {
        guard let token = queryValue(link, "invite"), token.hasPrefix("inv_"),
            let org = queryValue(link, "stream"), !org.isEmpty
        else { return nil }
        let room = queryValue(link, "room").flatMap { $0.isEmpty ? nil : $0 }
        let name = queryValue(link, "name").flatMap { $0.isEmpty ? nil : $0 }
        return StreamInvitation(
            invitation: OrgInvitation(namespaceId: org, token: token), kind: room == nil ? .namespace : .room,
            namespaceName: room == nil ? name : nil, roomId: room, contextId: room, roomName: room == nil ? nil : name)
    }

    private static func queryValue(_ link: String, _ name: String) -> String? {
        guard let q = link.firstIndex(of: "?") else { return nil }
        for pair in link[link.index(after: q)...].split(separator: "&") {
            let parts = pair.split(separator: "=", maxSplits: 1)
            if parts.count == 2, parts[0] == name {
                let raw = String(parts[1]).replacingOccurrences(of: "+", with: " ")
                return raw.removingPercentEncoding ?? raw
            }
        }
        return nil
    }
}
