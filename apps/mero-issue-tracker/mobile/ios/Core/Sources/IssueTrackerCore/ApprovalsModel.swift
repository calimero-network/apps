import Foundation
import MeroKit

#if canImport(Combine)
import Combine
#endif

/// What waits for the signed-in person's approval on a Calimero 1.0
/// cluster: a newer release of Mero Issue Tracker for one of their repos,
/// or a node release their org (or account) has to approve. Approving opens
/// the node's consent page in the system browser; an app's own session can't
/// approve anything.
///
/// The app hands it `MeroAppSession.pendingApprovals(org:)` and
/// `MeroClient.requestConsent(_:callback:confirm:)`; tests hand it fakes.
/// Before the page opens, the node's confirmation code is shown
/// (``confirmationCode``) so the person can check the page shows the same.
@MainActor
public final class ApprovalsModel: ObservableObject {
    /// One thing to approve.
    public struct Item: Identifiable, Hashable, Sendable {
        public enum Kind: Hashable, Sendable {
            /// Upgrade app instance `app` to `version`.
            case upgrade(app: String, version: String)
            /// Approve node release `version` for `org` (`nil`: the account's own apps).
            case release(org: String?, version: String)
        }

        public let kind: Kind
        public let title: String
        public let detail: String

        public var id: String {
            switch kind {
            case .upgrade(let app, let version): return "upgrade:\(app):\(version)"
            case .release(let org, let version): return "release:\(org ?? "-"):\(version)"
            }
        }

        /// The consent request that approves it, returning to `returnTo`.
        public func request(returnTo: String) -> ConsentRequest {
            switch kind {
            case .upgrade(let app, let version):
                return upgradeConsent(app: app, toVersion: version, returnTo: returnTo)
            case .release(let org, let version):
                return releaseConsent(org.map { .org($0) } ?? .account, version: version, returnTo: returnTo)
            }
        }
    }

    public typealias Fetch = @MainActor (_ org: String?) async throws -> PendingApprovals
    /// Where the app asks the node to approve: `confirm` runs with the node's
    /// answer before the page opens (`false`: don't open it).
    public typealias Consent = @MainActor (
        _ request: @escaping (String) -> ConsentRequest,
        _ confirm: @escaping @MainActor (ConsentStarted) async -> Bool
    ) async -> ConsentResult?

    @Published public private(set) var items: [Item] = []
    /// The item whose consent page is open.
    @Published public private(set) var approving: String?
    @Published public var error: String?
    /// The confirmation code to show before the consent page opens; answer
    /// with ``answerConfirmation(_:)``.
    @Published public private(set) var confirmationCode: String?
    private var confirmation: CheckedContinuation<Bool, Never>?

    private let packageName: String
    private let appName: String
    private let fetch: Fetch
    private let consent: Consent

    public init(packageName: String, appName: String, fetch: @escaping Fetch, consent: @escaping Consent) {
        self.packageName = packageName
        self.appName = appName
        self.fetch = fetch
        self.consent = consent
    }

    /// Re-read what waits, for the account's own apps and each of `orgs`.
    /// A scope the person may not read (not an owner there) is skipped.
    public func load(orgs: [String]) async {
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
    public func approve(_ item: Item, orgs: [String]) async -> Bool {
        approving = item.id
        defer { approving = nil }
        error = nil
        var declined = false
        let result = await consent({ item.request(returnTo: $0) }) { [weak self] started in
            guard let self else { return false }
            let go = await self.askToConfirm(started.code ?? MeroKit.confirmationCode(started.requestId))
            declined = !go
            return go
        }
        if declined { return false }
        guard let result else {
            error = "Couldn't open the approval page. Try again."
            return false
        }
        await load(orgs: orgs)
        return result.status == .approved
    }

    /// Show `code` and wait for ``answerConfirmation(_:)``.
    func askToConfirm(_ code: String) async -> Bool {
        confirmation?.resume(returning: false)
        return await withCheckedContinuation { continuation in
            confirmation = continuation
            confirmationCode = code
        }
    }

    /// The person read the code: `true` opens the consent page, `false` drops the request.
    public func answerConfirmation(_ proceed: Bool) {
        confirmationCode = nil
        let waiting = confirmation
        confirmation = nil
        waiting?.resume(returning: proceed)
    }

    /// The actionable items in one scope's pending list: upgrades of this
    /// app's package, and node releases the scope's side approves.
    public nonisolated static func items(
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
