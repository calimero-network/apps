import MeroKit
import MeroKitTestSupport
import XCTest

@testable import PixartCore

@MainActor
final class ModelTests: XCTestCase {
    func testTeamsListThisAccountsTeams() async {
        let (backend, _) = Fixtures.backend()
        backend.namespaces.append(AppNamespace(id: "zz", name: nil, applicationId: "x"))
        let model = TeamsModel(backend: backend)
        await model.load()
        XCTAssertEqual(model.state, .loaded)
        XCTAssertEqual(model.teams.map(\.name), ["Studio", "Team zz"])
    }

    func testTeamsFailureIsShown() async {
        let (backend, _) = Fixtures.backend()
        backend.failure = URLError(.notConnectedToInternet)
        let model = TeamsModel(backend: backend)
        await model.load()
        XCTAssertEqual(model.state, .failed("You're offline. Check your connection and try again."))
    }

    func testProjectsTakeTheDocumentsNameAndSize() async {
        let (backend, _) = Fixtures.backend()
        let model = ProjectsModel(backend: backend, teamId: Fixtures.team, blobs: BlobStore(loader: NoBlobs()))
        await model.load()
        XCTAssertEqual(model.projects.count, 1)
        XCTAssertEqual(model.projects[0].name, "Poster")
        XCTAssertEqual(model.projects[0].width, 4)
        XCTAssertEqual(model.projects[0].layerCount, 1)
        XCTAssertEqual(backend.recording.calls("get_document").first?.path, .query)
    }

    func testAThumbnailIsComposited() async {
        let (backend, _) = Fixtures.backend(layers: "[" + Fixtures.layerJSON("a", blob: "px") + "]")
        let blobs = FakeBlobs(["px": Fixtures.png(RGBA(0, 0, 1))])
        let model = ProjectsModel(backend: backend, teamId: Fixtures.team, blobs: BlobStore(loader: blobs))
        await model.load()
        await model.loadThumbnail(Fixtures.project)
        let thumb = model.thumbnails[Fixtures.project]
        XCTAssertEqual(thumb?.width, 4)
        XCTAssertEqual(thumb?.pixel(0, 0).2, 255)
        XCTAssertEqual(blobs.asked, ["px@\(Fixtures.project)"])
    }

    func testOpeningJoinsThenComposites() async {
        let (backend, _) = Fixtures.backend(
            layers: "[" + Fixtures.layerJSON("a", blob: "px") + "]", memberOfProject: false)
        let model = ArtworkModel(
            backend: backend, teamId: Fixtures.team, contextId: Fixtures.project,
            blobs: BlobStore(loader: FakeBlobs(["px": Fixtures.png(RGBA(1, 0, 0))])))
        await model.open()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertTrue(backend.log.contains("joinContext \(Fixtures.project)"))
        XCTAssertEqual(model.name, "Poster")
        XCTAssertEqual(model.role, "viewer")
        XCTAssertEqual(model.image?.pixel(1, 1).0, 255)
        XCTAssertEqual(model.image?.pixel(1, 1).1, 0)
        XCTAssertEqual(model.missing, 0)
    }

    func testHidingIsLocalAndNeverWritten() async {
        let (backend, _) = Fixtures.backend(layers: "[" + Fixtures.layerJSON("a", kind: "fill", fill: "#000000") + "]")
        let model = ArtworkModel(
            backend: backend, teamId: Fixtures.team, contextId: Fixtures.project, blobs: BlobStore(loader: NoBlobs()))
        await model.open()
        XCTAssertEqual(model.image?.pixel(0, 0).0, 0)
        await model.toggle("a")
        XCTAssertEqual(model.overrides, ["a": false])
        XCTAssertEqual(model.image?.pixel(0, 0).0, 255)
        XCTAssertTrue(model.rows[0].overridden)
        await model.toggle("a")
        XCTAssertEqual(model.overrides, [:])
        XCTAssertTrue(backend.recording.calls.allSatisfy { $0.path == .query })
    }

    func testAMissingBlobIsCounted() async {
        let (backend, _) = Fixtures.backend(layers: "[" + Fixtures.layerJSON("a", blob: "gone") + "]")
        let model = ArtworkModel(
            backend: backend, teamId: Fixtures.team, contextId: Fixtures.project, blobs: BlobStore(loader: NoBlobs()))
        await model.open()
        XCTAssertEqual(model.missing, 1)
        XCTAssertNotNil(model.image)
    }

    func testExportIsAPNGOfWhatThisPhoneShows() async {
        let (backend, _) = Fixtures.backend(layers: "[" + Fixtures.layerJSON("a", kind: "fill", fill: "#000000") + "]")
        let model = ArtworkModel(
            backend: backend, teamId: Fixtures.team, contextId: Fixtures.project, blobs: BlobStore(loader: NoBlobs()))
        await model.open()
        await model.toggle("a")
        let png = await model.exportPNG()
        let bmp = png.flatMap(Renderer.decode)
        XCTAssertEqual(bmp?.width, 4)
        XCTAssertEqual(bmp?.pixel(0, 0).0, 255)
    }

    func testRefreshPicksUpANewLayer() async {
        let (backend, answers) = Fixtures.backend(layers: "[]")
        let model = ArtworkModel(
            backend: backend, teamId: Fixtures.team, contextId: Fixtures.project, blobs: BlobStore(loader: NoBlobs()))
        await model.open()
        XCTAssertEqual(model.image?.pixel(0, 0).1, 255)
        answers.set("get_layers", "[" + Fixtures.layerJSON("a", kind: "fill", fill: "#000000") + "]")
        await model.refresh()
        XCTAssertEqual(model.layers.count, 1)
        XCTAssertEqual(model.image?.pixel(0, 0).1, 0)
    }

    func testProjectLinksRoundTrip() {
        let link = PixartFormat.projectLink(teamId: "t1", contextId: "c1")
        XCTAssertEqual(PixartFormat.parseProjectLink(link)?.contextId, "c1")
        XCTAssertEqual(PixartFormat.parseProjectLink("calimero://com.calimero.mero-pixart/project?team=t1&project=c1")?.teamId, "t1")
        XCTAssertNil(PixartFormat.parseProjectLink("https://links.calimero.network/com.calimero.mero-design/project?team=t&project=c"))
        XCTAssertEqual(PixartFormat.fileName("Spring / Poster"), "Spring - Poster.png")
    }
}

@MainActor
final class InvitationTests: XCTestCase {
    static let signedJSON =
        #"{"invitation":{"inviter_identity":[1,2],"group_id":[170,170],"expiration_timestamp":9,"secret_salt":[3]},"inviter_signature":"sig"}"#

    func testTheWebsPayloadParses() throws {
        let payload = #"{"invitation":\#(Self.signedJSON),"groupName":"g","__teamName":"Studio"}"#
        let inv = try XCTUnwrap(PixartInvitation.parse(json: payload))
        XCTAssertEqual(inv.namespaceId, "aaaa")
        XCTAssertEqual(inv.title, "Studio")
    }

    func testALinkRoundTripsAndOtherAppsAreRefused() throws {
        let inv = try XCTUnwrap(PixartInvitation.parse(json: #"{"invitation":\#(Self.signedJSON)}"#))
        let link = try PixartInvitation(invitation: inv.invitation, teamName: "Studio").link()
        XCTAssertTrue(link.contains("com.calimero.mero-pixart/join?invitation="))
        XCTAssertEqual(PixartInvitation.parse(link)?.teamName, "Studio")
        XCTAssertNil(PixartInvitation.parse(link.replacingOccurrences(of: "mero-pixart", with: "mero-chat")))
    }

    func testAcceptJoinsTheTeam() async throws {
        let (backend, _) = Fixtures.backend()
        let model = InvitationModel()
        let inv = try XCTUnwrap(PixartInvitation.parse(json: #"{"invitation":\#(Self.signedJSON),"__teamName":"Studio"}"#))
        XCTAssertTrue(model.open(try inv.link()))
        XCTAssertEqual(model.stage, .confirm(title: "Studio"))
        var joined = false
        await model.accept(backend: { backend }, didJoin: { joined = true })
        XCTAssertTrue(joined)
        XCTAssertEqual(model.stage, .joined(teamId: "aaaa", name: "Studio"))
        XCTAssertFalse(model.open("https://example.com"))
    }
}
