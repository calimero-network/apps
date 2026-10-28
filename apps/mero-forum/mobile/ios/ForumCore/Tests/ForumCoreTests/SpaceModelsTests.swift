import Foundation
import MeroKit
import MeroKitTestSupport
import XCTest

@testable import ForumCore

@MainActor
final class SpacesModelTests: XCTestCase {
    func testLoadsSpacesByName() async {
        let (backend, _) = makeBackend()
        backend.namespaces = [
            AppNamespace(id: "2", name: "zeta", applicationId: "app"),
            AppNamespace(id: "1", name: "Alpha", applicationId: "app"),
        ]
        let model = SpacesModel(backend: backend)
        await model.load()
        XCTAssertEqual(model.phase, .loaded)
        XCTAssertEqual(model.spaces.map(\.id), ["1", "2"])
    }

    func testCreateFoundsANamespace() async throws {
        let (backend, _) = makeBackend()
        let model = SpacesModel(backend: backend)
        let space = try await model.create(name: "  Design  ")
        XCTAssertEqual(space.name, "Design")
        XCTAssertTrue(backend.log.contains("foundNamespace Design"))
        XCTAssertEqual(model.spaces.count, 1)
    }

    func testCreateNeedsAName() async {
        let (backend, _) = makeBackend()
        let model = SpacesModel(backend: backend)
        do {
            try await model.create(name: " ")
            XCTFail("expected a refusal")
        } catch {
            XCTAssertEqual(error as? ForumModelError, .message("Give the space a name."))
        }
        XCTAssertTrue(backend.log.isEmpty)
    }

    func testAFailedFirstLoadSaysWhy() async {
        let (backend, _) = makeBackend()
        backend.failure = URLError(.notConnectedToInternet)
        let model = SpacesModel(backend: backend)
        await model.load()
        XCTAssertEqual(model.phase, .failed("You're offline. Check your connection and try again."))
    }
}

@MainActor
final class ForumsModelTests: XCTestCase {
    private func model(_ backend: InMemoryAppBackend) -> ForumsModel {
        ForumsModel(backend: backend, namespaceId: ns, spaceName: "Design", applicationId: backend.applicationId)
    }

    func testListsForumsWithMembership() async {
        let (backend, _) = makeBackend()
        backend.subgroups = [
            ns: [
                AppSubgroup(groupId: "g2", name: "Random", contextIds: ["c2"]),
                AppSubgroup(groupId: "g1", name: "General", contextIds: ["c1"]),
                AppSubgroup(groupId: "g3", name: nil, contextIds: []),
            ]
        ]
        backend.members = ["c1"]
        let forums = model(backend)
        await forums.load()
        XCTAssertEqual(forums.forums.map(\.name), ["Forum g3", "General", "Random"])
        XCTAssertEqual(forums.forums.first { $0.id == "g1" }?.joined, true)
        XCTAssertEqual(forums.forums.first { $0.id == "g2" }?.joined, false)
        XCTAssertNil(forums.forums.first { $0.id == "g3" }?.contextId)
    }

    func testCreateMakesAnOpenSubgroupAndAContextWithNoInitArgs() async throws {
        let (backend, _) = makeBackend()
        let forums = model(backend)
        let ref = try await forums.create(name: "General")
        XCTAssertEqual(ref.forumName, "General")
        XCTAssertTrue(backend.publicSubgroups.contains(ref.forumId))
        XCTAssertEqual(backend.initArgs[ref.contextId], .object([:]))
        XCTAssertEqual(forums.forums.first?.joined, true)
    }

    func testEnterJoinsAnOpenForumFirst() async throws {
        let (backend, _) = makeBackend()
        let forums = model(backend)
        let ref = try await forums.enter(ForumRow(id: "g1", name: "General", contextId: "c1", joined: false))
        XCTAssertEqual(ref.contextId, "c1")
        XCTAssertTrue(backend.log.contains("joinContext c1"))
        XCTAssertTrue(backend.members.contains("c1"))
    }

    func testEnterRefusesAForumStillSyncing() async {
        let (backend, _) = makeBackend()
        do {
            _ = try await model(backend).enter(ForumRow(id: "g1", name: "General", contextId: nil, joined: false))
            XCTFail("expected a refusal")
        } catch {
            XCTAssertEqual(error as? ForumModelError, .message("This forum is still syncing. Try again in a moment."))
        }
    }

    func testInvitesParseBack() async throws {
        let (backend, _) = makeBackend()
        let forums = model(backend)
        let spaceLink = try await forums.spaceInvite()
        let space = try XCTUnwrap(ForumInvitation.parse(spaceLink))
        XCTAssertEqual(space.kind, .space)
        XCTAssertEqual(space.spaceName, "Design")
        let forumLink = try await forums.forumInvite(ForumRow(id: "g1", name: "General", contextId: "c1", joined: true))
        let forum = try XCTUnwrap(ForumInvitation.parse(forumLink))
        XCTAssertEqual(forum.kind, .forum)
        XCTAssertEqual(forum.contextId, "c1")
        XCTAssertEqual(forum.namespaceId, ns)
    }
}

@MainActor
final class InvitationModelTests: XCTestCase {
    func testRejectsALinkThatIsNotAnInvitation() {
        let model = InvitationModel()
        XCTAssertFalse(model.open("https://example.com"))
        XCTAssertEqual(model.stage, .failed("This isn't a Mero Forum invitation. Check the link and try again."))
    }

    func testJoinsASpace() async throws {
        let (backend, _) = makeBackend()
        backend.hasRelay = false
        let link = try ForumInvitation(invitation: InMemoryAppBackend.invitation(namespaceId: ns), spaceName: "Design").link()
        let model = InvitationModel()
        XCTAssertTrue(model.open(link))
        XCTAssertEqual(model.stage, .confirm(title: "Design", isForum: false))
        var joined = false
        await model.accept(backend: { backend }, didJoin: { joined = true })
        XCTAssertTrue(joined)
        XCTAssertTrue(backend.hasRelay)
        XCTAssertEqual(model.stage, .joined(InvitationDestination(namespaceId: ns, spaceName: "Design", forum: nil)))
    }

    func testAForumInviteLandsInTheForum() async throws {
        let (backend, _) = makeBackend()
        let link = try ForumInvitation(
            invitation: InMemoryAppBackend.invitation(namespaceId: ns), kind: .forum, spaceName: "Design",
            forumId: "g1", forumName: "General", contextId: "c1"
        ).link()
        let model = InvitationModel(forumAttempts: 1, forumRetryDelay: .zero)
        model.open(link)
        await model.accept(backend: { backend }, didJoin: {})
        guard case .joined(let destination) = model.stage else { return XCTFail("not joined: \(model.stage)") }
        XCTAssertEqual(destination.forum?.contextId, "c1")
        XCTAssertTrue(backend.log.contains("joinContext c1"))
    }

    func testAFailedJoinSaysWhy() async throws {
        let (backend, _) = makeBackend()
        backend.failure = URLError(.timedOut)
        let model = InvitationModel()
        model.open(try ForumInvitation(invitation: InMemoryAppBackend.invitation(namespaceId: ns)).token())
        await model.accept(backend: { backend }, didJoin: {})
        XCTAssertEqual(model.stage, .failed("The relay took too long to answer. Try again."))
    }
}
