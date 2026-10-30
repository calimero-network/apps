import Foundation
import MeroKit

#if canImport(Combine)
import Combine
#endif

/// What waits for the signed-in person's approval on a Calimero 1.0
/// cluster: a newer release of Mero Chat for one of their app instances,
/// or a node release their org (or account) has to approve. Approving opens
/// the node's consent page in the system browser; an app's own session can't
/// approve anything.
///
/// The app hands it `MeroAppSession.pendingApprovals(org:)` and
/// `MeroAppSession.requestConsent(_:)`; tests hand it fakes.
@MainActor
final class ApprovalsModel: ObservableObject {
    /// One thing to approve.
    struct Item: Identifiable, Hashable, Sendable {
        enum Kind: Hashable, Sendable {
            /// Upgrade app instance `app` to `version`.
            case upgrade(app: String, version: String)
            /// Approve node release `version` for `org` (`nil`: the account's own apps).
            case release(org: String?, version: String)
        }

        let kind: Kind
        let title: String
        let detail: String

        var id: String {
            switch kind {
            case .upgrade(let app, let version): return "upgrade:\(app):\(version)"
            case .release(let org, let version): return "release:\(org ?? "-"):\(version)"
            }
        }

        /// The consent request that approves it, returning to `returnTo`.
        func request(returnTo: String) -> ConsentRequest {
            switch kind {
            case .upgrade(let app, let version):
                return upgradeConsent(app: app, toVersion: version, returnTo: returnTo)
            case .release(let org, let version):
                return releaseConsent(org.map { .org($0) } ?? .account, version: version, returnTo: returnTo)
            }
        }
    }

    typealias Fetch = @MainActor (_ org: String?) async throws -> PendingApprovals
    typealias Consent = @MainActor (_ request: @escaping (String) -> ConsentRequest) async -> ConsentResult?

    @Published private(set) var items: [Item] = []
    /// The item whose consent page is open.
    @Published private(set) var approving: String?
    @Published var error: String?

    private let packageName: String
    private let appName: String
    private let fetch: Fetch
    private let consent: Consent

    init(packageName: String, appName: String, fetch: @escaping Fetch, consent: @escaping Consent) {
        self.packageName = packageName
        self.appName = appName
        self.fetch = fetch
        self.consent = consent
    }

    /// Re-read what waits, for the account's own apps and each of `orgs`.
    /// A scope the person may not read (not an owner there) is skipped.
    func load(orgs: [String]) async {
        var found: [Item] = []
        for org in [String?.none] + orgs.map(Optional.some) {
            guard let pending = try? await fetch(org) else { continue }
            found += Self.items(from: pending, org: org, packageName: packageName, appName: appName)
        }
        var seen = Set<String>()
        items = found.filter { seen.insert($0.id).inserted }
    }

    /// Open the consent page for `item`; `true` when it came back approved.
    @discardableResult
    func approve(_ item: Item, orgs: [String]) async -> Bool {
        approving = item.id
        defer { approving = nil }
        error = nil
        guard let result = await consent({ item.request(returnTo: $0) }) else {
            error = "Couldn't open the approval page. Try again."
            return false
        }
        await load(orgs: orgs)
        return result.status == .approved
    }

    /// The actionable items in one scope's pending list: upgrades of this
    /// app's package, and node releases the scope's side approves.
    nonisolated static func items(
        from pending: PendingApprovals, org: String?, packageName: String, appName: String
    ) -> [Item] {
        let upgrades = pending.upgrades
            .filter { $0.actionable && $0.package == packageName }
            .map { u in
                Item(
                    kind: .upgrade(app: u.app, version: u.to),
                    title: "\(appName) \(u.to) is available",
                    detail: "\(u.name ?? "An app instance") runs \(u.from). Review the update to keep it current.")
            }
        let releases = pending.releases
            .filter(\.actionable)
            .map { r in
                Item(
                    kind: .release(org: org, version: r.version),
                    title: "Node release \(r.version) needs your approval",
                    detail: r.deadline.map { "New work stops after \($0.after) until it's approved." }
                        ?? "Your cluster's nodes run a release you haven't approved yet.")
            }
        return upgrades + releases
    }
}
