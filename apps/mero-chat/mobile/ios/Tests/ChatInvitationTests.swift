import MeroKit
import XCTest

/// Invitations in the 1.0 link format, and pre-1.0 web links refused.
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

    func testAPreOneTokenTheWebAppProducedIsRefused() {
        // A signed group invitation can't be redeemed on a 1.0 cluster.
        XCTAssertNil(ChatInvitation.parse(webToken))
        XCTAssertNil(ChatInvitation.parse(json: ChatFixtures.signedInvitationJSON))
    }

    func testOurLinkRoundTripsInTheSDKsPayload() throws {
        let link = try ChatInvitation(invitation: ChatFixtures.orgInvitation, workspaceName: "Team").link()
        XCTAssertTrue(link.hasPrefix("https://links.calimero.network/com.calimero.chat/join?invitation="), link)

        let parsed = try XCTUnwrap(ChatInvitation.parse(link))
        XCTAssertEqual(parsed.workspaceName, "Team")
        XCTAssertEqual(parsed.namespaceId, ChatFixtures.namespaceId)
        XCTAssertEqual(parsed.invitation.token, ChatFixtures.orgInvitation.token)

        let token = try XCTUnwrap(InviteLink.token(fromPasted: link))
        let json = try XCTUnwrap(InviteCodec.decode(token: token))
        let root = try JSONDecoder().decode(JSONValue.self, from: Data(json.utf8))
        XCTAssertEqual(root["invitation"]?.stringValue, "inv_3k9Qx2")
        XCTAssertEqual(root["namespaceId"]?.stringValue, ChatFixtures.namespaceId)
        XCTAssertEqual(root["name"]?.stringValue, "Team")
        // The SDK reads the same link.
        XCTAssertEqual(OrgInvitation.parse(link, expectedSlug: ChatConstants.packageName)?.name, "Team")
    }

    func testDecodesTheCalimeroDeepLinkAndRefusesAnotherApps() throws {
        let token = try ChatInvitation(invitation: ChatFixtures.orgInvitation, workspaceName: nil).token()
        XCTAssertEqual(
            ChatInvitation.parse("calimero://com.calimero.chat/join?invitation=\(token)")?.namespaceId,
            ChatFixtures.namespaceId)
        XCTAssertNil(ChatInvitation.parse("https://links.calimero.network/com.calimero.mero-docs/join?invitation=\(token)"))
        XCTAssertNotNil(ChatInvitation.parse(token))
    }

    func testAcceptsAnEnvelopeAndPrefersGroupName() throws {
        let enveloped = #"{"data":{"invitation":"inv_x","namespaceId":"org1","groupName":"New","groupAlias":"Old"}}"#
        let parsed = try XCTUnwrap(ChatInvitation.parse(json: enveloped))
        XCTAssertEqual(parsed.workspaceName, "New")
        XCTAssertEqual(parsed.namespaceId, "org1")
    }

    func testRejectsWhatIsNotAnInvitation() {
        XCTAssertNil(ChatInvitation.parse(""))
        XCTAssertNil(ChatInvitation.parse("hello"))
        XCTAssertNil(ChatInvitation.parse(json: #"{"invitation":{"nope":1}}"#))
        XCTAssertNil(ChatInvitation.parse(json: #"{"invitation":"","namespaceId":"o"}"#))
    }
}
