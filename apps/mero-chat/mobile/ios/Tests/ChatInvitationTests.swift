import MeroKit
import XCTest

/// Invitations in the web app's format, both directions.
final class ChatInvitationTests: XCTestCase {
    /// What the web app shares for the rc32 fixture invitation named "Design Team":
    /// `bs58.encode(fflate.deflateSync(JSON.stringify({ invitation, groupAlias })))`,
    /// produced with the real fflate 0.8.2 + bs58 6.0.0 (`app/src/utils/invitation.ts`).
    private let webToken = """
        55L2SEartCEi5Ro6GcwCifui2FxH8J7ga1vpv5XbwmCndTuBEmUCjfNcwZBuzeALQf93eJYMTihkrNr2crYvJmyv9cXUCXpMGC8G\
        2DU6c7qtNLmHMGDPVhM6knCorywsqVB6kN2PGVt8FRi9CKrKVkAHzngJbsUpqCBPuh8LnFSeKvU11JgSkphnXYhEh82chkoHgZMX\
        e1TAkirspNKEpcUXcSUTxqgDPnv3u9TUTghQpKCRtZ9UZY1NQGsLvtXYpBshhQbhYB83YU6UTgHm4LYR6vSfQMUgWD3cSRDv58tL\
        rMQL4fBSNYWQDmC16gEApYqfaLVcoXitvvc9WXiwLyjoYfqSRt6g7zcCgnRAeU5oQvg1hkVpjb93XpYmw5b8gzEvQYyA3hFSmjEX\
        AtxDF7pmHztL2oHTp2WcP4t5nVSPVhwFsSht595dfw7xN1McexYnwq7nwq1ScHjs7bYMtzZgMFerfVNKx2wzVUurTdeKj3a9gUnG\
        gdH42WKSZZKqM7mfZ2bnkDVQnaC5KgV2VAyozUoZSkq6Jghqst8kcaxifyV4DqePTzsrhHp5BACV6tfAUyzcrFBKbjezyDE2SrSy\
        nE8E8uyg7XgXqxBwLwXJVttgibeeGozKcApobdXaYdXfdXCQbgH6aG9VhMbKS44nLYdbeoLjUY5LF1V9hvSrjJhedVYYR7B79wHj\
        hFrG1EotzRHBdDWzzbqV4o4zGibtyyzaNJeVQAjjzhQmuNVUH1f1sRuwEfRysgKqkWdfvmi1HBfykWRgNFXfTca8dn4YeYRvfZPV\
        ryYAGxeK1yD3YeLJijacmp4yaHTaEBZbPCvhLXaZbBgSbcTqzsTXnBXdTwK5bZSn8PSQo5kiZ2dX3E4uFhQ5zhKGisf4vJ4jXbrj\
        RrazTw1SKEzn1e8JGjFfU
        """

    func testDecodesATokenTheWebAppProduced() throws {
        let parsed = try XCTUnwrap(ChatInvitation.parse(webToken))
        XCTAssertEqual(parsed.workspaceName, "Design Team")
        XCTAssertEqual(parsed.namespaceId, ChatFixtures.namespaceId)
        XCTAssertEqual(parsed.invitation.inviterAccount, ChatFixtures.account)
        XCTAssertEqual(parsed.invitation.invitation.admitters, [ChatFixtures.account])
    }

    func testDecodesTheWebAppsLinkAndTheCalimeroDeepLink() throws {
        let https = "https://links.calimero.network/com.calimero.chat/join?invitation=\(webToken)"
        let deep = "calimero://com.calimero.chat/join?invitation=\(webToken)"
        XCTAssertEqual(ChatInvitation.parse(https)?.namespaceId, ChatFixtures.namespaceId)
        XCTAssertEqual(ChatInvitation.parse(deep)?.namespaceId, ChatFixtures.namespaceId)
    }

    func testRefusesAnotherAppsInvitationLink() {
        let foreign = "https://links.calimero.network/com.calimero.mero-docs/join?invitation=\(webToken)"
        XCTAssertNil(ChatInvitation.parse(foreign))
    }

    func testOurLinkRoundTripsAndKeepsTheSignedBytes() throws {
        let signed = try ChatFixtures.signedInvitation()
        let link = try ChatInvitation(invitation: signed, workspaceName: "Team").link()
        XCTAssertTrue(link.hasPrefix("https://links.calimero.network/com.calimero.chat/join?invitation="), link)

        let parsed = try XCTUnwrap(ChatInvitation.parse(link))
        XCTAssertEqual(parsed.workspaceName, "Team")
        XCTAssertEqual(parsed.namespaceId, ChatFixtures.namespaceId)
        // The signature covers the inner invitation exactly: it must survive unchanged.
        let before = try JSONEncoder().encode(signed)
        let after = try JSONEncoder().encode(parsed.invitation)
        XCTAssertEqual(
            try JSONDecoder().decode(JSONValue.self, from: before),
            try JSONDecoder().decode(JSONValue.self, from: after))
    }

    func testAcceptsTheOtherPayloadShapesTheWebAppAccepts() throws {
        let signed = ChatFixtures.signedInvitationJSON
        // A bare signed invitation, and one under a `data` envelope with `groupName`.
        XCTAssertEqual(ChatInvitation.parse(json: signed)?.namespaceId, ChatFixtures.namespaceId)
        let enveloped = #"{"data":{"invitation":\#(signed),"groupName":"New","groupAlias":"Old"}}"#
        XCTAssertEqual(ChatInvitation.parse(json: enveloped)?.workspaceName, "New")
        // camelCase `inviterSignature`.
        let camel = signed.replacingOccurrences(of: "\"inviter_signature\"", with: "\"inviterSignature\"")
        let parsed = try XCTUnwrap(ChatInvitation.parse(json: camel))
        XCTAssertTrue(parsed.invitation.inviterSignature.hasPrefix("80ff4f74"))
    }

    func testRejectsWhatIsNotAnInvitation() {
        XCTAssertNil(ChatInvitation.parse(""))
        XCTAssertNil(ChatInvitation.parse("hello"))
        XCTAssertNil(ChatInvitation.parse(json: #"{"invitation":{"nope":1}}"#))
    }
}
