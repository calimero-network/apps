import MeroKit
import MeroKitTestSupport
import XCTest

@testable import IssueTrackerCore

@MainActor
final class WorkspaceModelTests: XCTestCase {
    private func model(_ fake: FakeTracker, store: TrackerStore = MemoryTrackerStore()) -> WorkspaceModel {
        WorkspaceModel(backend: fake.backend, applicationId: fake.backend.applicationId, store: store)
    }

    func testLoadOpensRememberedWorkspaceAndNamesReposFromURL() async {
        let fake = FakeTracker()
        let a = String(repeating: "1", count: 64)
        let b = String(repeating: "2", count: 64)
        fake.backend.namespaces = [
            AppNamespace(id: a, name: "Alpha", applicationId: "app"), AppNamespace(id: b, name: "Beta", applicationId: "app"),
        ]
        fake.backend.rootContexts = [b: ["ctx-1"]]
        _ = try? await fake.backend.contract.execute(
            contextId: "ctx-1", method: "set_repo_url", argsJSON: Data(#"{"url":"https://github.com/acme/core"}"#.utf8))
        let store = MemoryTrackerStore()
        store.activeWorkspace = b
        let m = model(fake, store: store)
        await m.load()
        XCTAssertEqual(m.phase, .loaded)
        XCTAssertEqual(m.workspaces.map(\.name), ["Alpha", "Beta"])
        XCTAssertEqual(m.activeWorkspaceId, b)
        XCTAssertEqual(m.repos, [Repo(id: "ctx-1", name: "core", url: "https://github.com/acme/core")])
        XCTAssertEqual(m.activeRepoId, "ctx-1")
    }

    func testCreateWorkspaceThenAddRepo() async throws {
        let fake = FakeTracker()
        let store = MemoryTrackerStore()
        let m = model(fake, store: store)
        await m.load()
        XCTAssertTrue(m.workspaces.isEmpty)
        let notice = try await m.createWorkspace(name: "  Platform team ")
        XCTAssertNil(notice)
        XCTAssertEqual(m.activeWorkspace?.name, "Platform team")
        XCTAssertEqual(fake.backend.log.first, "listNamespaces")
        XCTAssertTrue(fake.backend.log.contains("foundNamespace Platform team"))

        try await m.addRepo(name: "core", url: "https://github.com/acme/core-repo")
        let repo = try XCTUnwrap(m.activeRepo)
        XCTAssertEqual(repo.name, "core")  // the name given, not the URL's
        XCTAssertEqual(fake.repoURL(repo.id), "https://github.com/acme/core-repo")
        XCTAssertEqual(store.repoName(repo.id), "core")
        XCTAssertEqual(fake.backend.initArgs[repo.id], .object([:]))
    }

    func testHostingNoticeWhenNotHosted() async throws {
        let fake = FakeTracker()
        fake.backend.haEnabled = false
        let m = model(fake)
        let notice = try await m.createWorkspace(name: "Solo")
        XCTAssertNotNil(notice)
    }

    func testAddRepoNeedsName() async {
        let fake = FakeTracker()
        let m = model(fake)
        do {
            try await m.addRepo(name: " ", url: "")
            XCTFail("expected a failure")
        } catch {
            XCTAssertEqual(error as? TrackerError, .message("Repo name is required"))
        }
    }

    func testInviteLinkRoundTripsAndJoinOpensWorkspace() async throws {
        let inviter = FakeTracker()
        let m = model(inviter)
        _ = try await m.createWorkspace(name: "Core team")
        let link = try await m.inviteLink()
        XCTAssertTrue(link.hasPrefix("https://links.calimero.network/com.calimero.mero-issue-tracker/join?invitation="))
        let parsed = try XCTUnwrap(TrackerInvitation.parse(link))
        XCTAssertEqual(parsed.workspaceName, "Core team")

        let joiner = FakeTracker(account: String(repeating: "cd", count: 32))
        let store = MemoryTrackerStore()
        let other = model(joiner, store: store)
        try await other.join(parsed)
        XCTAssertEqual(other.activeWorkspaceId, parsed.namespaceId)
        XCTAssertEqual(store.activeWorkspace, parsed.namespaceId)
        XCTAssertTrue(other.isSyncing)  // no repos have arrived yet
    }

    func testFailureIsWorded() async {
        let fake = FakeTracker()
        fake.backend.failure = URLError(.notConnectedToInternet)
        let m = model(fake)
        await m.load()
        XCTAssertEqual(m.phase, .failed("You are offline. Check your connection and try again."))
    }

    func testEnsureMemberJoinsWhenNotAMember() async {
        let fake = FakeTracker()
        let m = model(fake)
        await m.ensureMember("ctx-9")
        XCTAssertTrue(fake.backend.log.contains("joinContext ctx-9"))
        XCTAssertTrue(fake.backend.members.contains("ctx-9"))
    }
}
