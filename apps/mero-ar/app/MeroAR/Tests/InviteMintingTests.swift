import XCTest
import MeroKit
@testable import MeroAR

/// Where a room's invitation comes from: the account signs it on this device
/// (`CloudSignIn.createNamespaceInvitation`), the relay is only asked which
/// namespace the room lives in. Nothing asks the relay's node to mint one.
final class InviteMintingTests: XCTestCase {
    override func setUp() {
        super.setUp()
        RelayStub.reset()
    }

    private static let namespace = String(repeating: "9a", count: 32)

    private static func signed() -> SignedGroupOpenInvitation {
        SignedGroupOpenInvitation(
            invitation: GroupInvitationFromAdmin(
                inviterIdentity: Array(0..<32), groupId: Array(32..<64),
                expirationTimestamp: 1_787_740_000, secretSalt: Array(64..<96)),
            inviterSignature: String(repeating: "5", count: 88),
            inviterAccount: Fixture.account)
    }

    /// Records the namespace it was asked to sign for.
    private final class Minter: @unchecked Sendable {
        var asked: [String] = []
        var mint: MeroARService.InvitationMinter {
            { [self] namespaceId in
                asked.append(namespaceId)
                return InviteMintingTests.signed()
            }
        }
    }

    func testTheInviteIsSignedByTheAccountForTheRoomsNamespace() async throws {
        let ctx = Fixture.context()
        RelayStub.on("GET", "/admin-api/contexts/\(ctx)/group", json: #"{"data":"\#(Self.namespace)"}"#)
        RelayStub.on(
            "POST", "/admin-api/contexts/\(ctx)/query",
            json: #"{"data":{"returns":{"name":"Studio","objectCount":0,"memberCount":1,"worldMapBlob":"","version":1}}}"#)
        let minter = Minter()
        let service = MeroARService(
            relay: Fixture.relay(), mero: Fixture.mero(), contextId: ctx, memberId: Fixture.account,
            mintInvitation: minter.mint)

        let invite = try await service.createRoomInvite()

        XCTAssertEqual(minter.asked, [Self.namespace])
        XCTAssertEqual(invite.namespaceId, Self.namespace)
        XCTAssertEqual(invite.contextId, ctx)
        XCTAssertEqual(invite.roomName, "Studio")
        XCTAssertEqual(invite.invitation.inviterAccount, Fixture.account)
        // The relay's node never mints: no admin invitation endpoint was hit.
        XCTAssertFalse(RelayStub.requests.contains { $0.path.contains("/invite") })
        // And the link it becomes is this app's.
        XCTAssertTrue(try invite.shareableLink().hasPrefix("https://links.calimero.network/com.calimero.mero-ar/join?"))
    }

    func testWithoutAnAccountMinterThereIsNoInvite() async {
        let service = Fixture.service(context: Fixture.context())
        do {
            _ = try await service.createRoomInvite()
            XCTFail("expected readsUnavailable")
        } catch {
            XCTAssertEqual(error as? MeroARError, .readsUnavailable)
        }
        XCTAssertTrue(RelayStub.requests.isEmpty)
    }

    /// The real minter goes through the SDK: with no relay session behind the
    /// connection it refuses before signing anything, and sends nothing.
    func testTheCloudMinterNeedsTheRelaySession() async throws {
        let cloud = CloudSignIn(
            keyStore: AnyValueStore<DeviceKeys>.memory(), sessionStore: AnyValueStore<CloudSession>.memory(),
            nonces: MemoryWarrantNonceStore(), urlSession: RelayStub.session)
        let connection = await cloud.connect(
            CloudSession(account: Fixture.account, device: Fixture.account, credential: "00"))
        let mint = MeroARService.cloudMinter(cloud, connection: connection)
        do {
            _ = try await mint(Self.namespace)
            XCTFail("expected relayKeyUnavailable")
        } catch AccountError.relayKeyUnavailable {
        } catch {
            XCTFail("unexpected \(error)")
        }
        XCTAssertTrue(RelayStub.requests.isEmpty)
    }

    func testAnUnclaimableInviteReadsAsSomethingToAct() {
        let message = userMessage(AccountError.invitationNotClaimable(namespaceId: Self.namespace, reason: "not-hosted"))
        XCTAssertTrue(message.contains("Calimero Cloud"))
    }
}
