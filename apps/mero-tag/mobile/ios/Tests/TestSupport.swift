import Foundation
import MeroKit
import MeroKitUI
@testable import MeroTag
import TagCore
import TagCoreTestSupport

/// A client that talks to no cluster (nothing in its session store).
@MainActor
func makeClient() -> MeroClient {
    MeroClient(config: MeroProviderConfig(packageName: SpaceInvite.appSlug), store: MemoryCloudSessionStore())
}

/// An app acting as ``Fixtures/account`` without a cluster.
@MainActor
func signedInApp(
    transport: FakeTransport = Fixtures.transport(), directory: FakeDirectory = FakeDirectory(),
    defaults: UserDefaults = isolatedDefaults()
) -> AppState {
    let app = AppState(
        client: makeClient(), preferences: SpacePreferences(defaults: defaults),
        makeTransport: { _ in transport }, makeDirectory: { _ in directory })
    app.syncDelay = 0
    app.signInForTesting(account: Fixtures.account)
    return app
}

/// Records what the app asked of the organization layer.
final class FakeDirectory: SpaceDirectory, @unchecked Sendable {
    private let lock = NSLock()
    private var _created: [String] = []
    private var _invited: [String] = []
    private var _joined: [String] = []
    var failure: Error?

    var created: [String] { lock.withLock { _created } }
    var invited: [String] { lock.withLock { _invited } }
    var joined: [String] { lock.withLock { _joined } }

    func createSpace(named name: String) async throws -> CreatedSpace {
        if let failure { throw failure }
        lock.withLock { _created.append(name) }
        return CreatedSpace(orgId: Fixtures.org, appId: "app-new")
    }

    func invite(appId: String, spaceName: String) async throws -> SpaceInvite {
        if let failure { throw failure }
        lock.withLock { _invited.append(appId) }
        return Fixtures.invite()
    }

    func join(_ invite: SpaceInvite) async throws {
        if let failure { throw failure }
        lock.withLock { _joined.append(invite.token) }
    }
}

func isolatedDefaults() -> UserDefaults {
    let name = "merotag.tests.\(UUID().uuidString)"
    let defaults = UserDefaults(suiteName: name)!
    defaults.removePersistentDomain(forName: name)
    return defaults
}
