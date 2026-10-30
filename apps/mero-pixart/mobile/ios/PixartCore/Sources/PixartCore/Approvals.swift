import Foundation
import MeroKit

/// One decision that waits for this account on Calimero 1.0: a node release
/// to approve for a scope (the account's own apps, or an organization), or an
/// app instance to upgrade. The decision is made on the node's consent page,
/// in the system browser, never in the app.
public enum ApprovalItem: Identifiable, Equatable, Sendable {
    case release(scope: ReportScope, version: String, deadline: String?)
    case upgrade(app: String, name: String?, from: String, to: String)

    public var id: String {
        switch self {
        case .release(let scope, let version, _):
            switch scope {
            case .account: return "release:account:\(version)"
            case .org(let org): return "release:\(org):\(version)"
            }
        case .upgrade(let app, _, _, let to): return "upgrade:\(app):\(to)"
        }
    }

    /// What the row says.
    public var title: String {
        switch self {
        case .release(_, let version, _): return "Approve node release \(version)"
        case .upgrade(_, let name, _, let to): return "Upgrade \(name ?? "an app") to \(to)"
        }
    }

    /// The line under it.
    public var detail: String {
        switch self {
        case .release(_, _, let deadline?): return "New work stops after \(deadline) until it is approved."
        case .release: return "Your cluster's nodes run a release you have not approved yet."
        case .upgrade(_, _, let from, _): return "Runs \(from) now."
        }
    }

    /// The consent request that asks for this decision, returning to `returnTo`.
    public func request(returnTo: String) -> ConsentRequest {
        switch self {
        case .release(let scope, let version, _): return releaseConsent(scope, version: version, returnTo: returnTo)
        case .upgrade(let app, _, _, let to): return upgradeConsent(app: app, toVersion: to, returnTo: returnTo)
        }
    }

    /// The decisions in `pending` that are this account's to make.
    public static func from(_ pending: PendingApprovals) -> [ApprovalItem] {
        let releases = pending.releases.filter(\.actionable).map {
            ApprovalItem.release(scope: pending.scope, version: $0.version, deadline: $0.deadline?.after)
        }
        let upgrades = pending.upgrades.filter(\.actionable).map {
            ApprovalItem.upgrade(app: $0.app, name: $0.name, from: $0.from, to: $0.to)
        }
        return releases + upgrades
    }
}

/// What waits for this account's approval, and asking for it on the node's
/// consent page. The app wires `load` to `MeroAppSession.pendingApprovals(org:)`
/// and `consent` to `MeroAppSession.requestConsent(_:)`, which opens the page
/// in the system browser.
@MainActor
public final class ApprovalsModel: ObservableObject {
    public typealias Load = @MainActor (_ org: String?) async throws -> PendingApprovals
    public typealias Consent = @MainActor (_ request: @escaping (String) -> ConsentRequest) async -> ConsentResult?

    @Published public private(set) var items: [ApprovalItem] = []
    /// The item whose consent page is open.
    @Published public private(set) var busy: String?
    /// The last decision or failure, in words.
    @Published public private(set) var message: String?

    private let load: Load
    private let consent: Consent
    private var orgs: [String] = []

    public init(load: @escaping Load, consent: @escaping Consent) {
        self.load = load
        self.consent = consent
    }

    /// Re-read the account's own approvals and those of `orgs`. A scope the
    /// account cannot read (not an owner there) adds nothing.
    public func refresh(orgs: [String]? = nil) async {
        if let orgs { self.orgs = orgs }
        var found: [ApprovalItem] = []
        for scope in [nil] + self.orgs.map(Optional.some) {
            guard let pending = try? await load(scope) else { continue }
            for item in ApprovalItem.from(pending) where !found.contains(item) { found.append(item) }
        }
        items = found
    }

    /// Open the consent page for `item` and re-read once the person is back.
    public func approve(_ item: ApprovalItem) async {
        busy = item.id
        defer { busy = nil }
        let result = await consent { item.request(returnTo: $0) }
        switch result?.status {
        case .approved?: message = "Approved."
        case .declined?: message = "Declined."
        case .pending?: message = "Not decided yet. You can come back to it."
        case nil: message = "The consent page did not answer. Try again."
        }
        await refresh()
    }
}
