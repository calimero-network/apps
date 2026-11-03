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

/// The confirmation code of a consent request the node accepted: the app
/// shows it before opening the page, and the page shows the same one.
public struct ConsentConfirmation: Identifiable, Equatable, Sendable {
    public let id: String
    public let code: String
    public let title: String
}

/// What waits for this account's approval, and asking for it on the node's
/// consent page. The app wires `load` to `MeroAppSession.pendingApprovals(org:)`
/// and `consent` to `MeroAppSession.requestConsent(_:confirm:)`, which opens the
/// page in the system browser once ``confirm(_:title:)`` said yes.
@MainActor
public final class ApprovalsModel: ObservableObject {
    public typealias Load = @MainActor (_ org: String?) async throws -> PendingApprovals
    /// Ask the node for the consent request `request(returnTo)`, call `confirm`
    /// with its answer (open the page only on true), and answer the decision.
    public typealias Consent = @MainActor (
        _ request: @escaping (String) -> ConsentRequest,
        _ confirm: @escaping @MainActor (ConsentStarted) async -> Bool
    ) async throws -> ConsentResult?

    @Published public private(set) var items: [ApprovalItem] = []
    /// The item whose consent page is open.
    @Published public private(set) var busy: String?
    /// The last decision or failure, in words.
    @Published public private(set) var message: String?
    /// The confirmation code on screen, before the consent page opens.
    @Published public private(set) var confirmation: ConsentConfirmation?

    private let load: Load
    private let consent: Consent
    private var orgs: [String] = []
    private var answer: CheckedContinuation<Bool, Never>?
    private var declined = false

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

    /// Show the request's confirmation code, then open the consent page for
    /// `item` if the person goes on, and re-read once they are back.
    public func approve(_ item: ApprovalItem) async {
        busy = item.id
        declined = false
        defer { busy = nil }
        do {
            let result = try await consent({ item.request(returnTo: $0) }) { [weak self] started in
                guard let self else { return false }
                return await self.confirm(started, title: item.title)
            }
            switch result?.status {
            case .approved?: message = "Approved."
            case .declined?: message = "Declined."
            case .pending?: message = "Not decided yet. You can come back to it."
            case nil: message = declined ? "Not opened. Nothing changed." : "The consent page did not answer. Try again."
            }
        } catch {
            message = ErrorText.describe(error)
        }
        await refresh()
    }

    /// Hold the consent page until the person has seen the code and chosen.
    public func confirm(_ started: ConsentStarted, title: String) async -> Bool {
        answer?.resume(returning: false)
        let code = started.code.flatMap { $0.isEmpty ? nil : $0 } ?? confirmationCode(started.requestId)
        confirmation = ConsentConfirmation(id: started.requestId, code: code, title: title)
        return await withCheckedContinuation { answer = $0 }
    }

    /// The person's choice on the code screen: open the page, or not.
    public func answerConfirmation(_ open: Bool) {
        confirmation = nil
        answer?.resume(returning: open)
        answer = nil
        declined = !open
    }
}
