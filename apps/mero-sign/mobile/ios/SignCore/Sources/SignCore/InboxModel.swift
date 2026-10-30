import Foundation
import MeroKit

/// Every document in every agreement the account is in, sorted into To sign,
/// Waiting and Completed. Agreements the account can see but has not opened
/// yet are listed beside it, so a new invitation is one tap from signing.
@MainActor
public final class InboxModel: ObservableObject {
    @Published public private(set) var entries: [DocumentEntry] = []
    /// Agreements in your workspaces your account hasn't entered yet.
    @Published public private(set) var unopened: [AgreementRef] = []
    /// Agreements still syncing to the account (they answered "Uninitialized").
    @Published public private(set) var syncing: [AgreementRef] = []
    @Published public private(set) var phase: LoadPhase = .loading
    @Published public var bucket: InboxBucket = .toSign
    @Published public private(set) var opening: String?
    @Published public var notice: String?

    public let directory: AgreementDirectory

    public init(directory: AgreementDirectory) {
        self.directory = directory
    }

    public func entries(in bucket: InboxBucket) -> [DocumentEntry] {
        entries.filter { $0.bucket == bucket }
            .sorted { $0.document.uploadedAt > $1.document.uploadedAt }
    }

    public func count(_ bucket: InboxBucket) -> Int { entries.filter { $0.bucket == bucket }.count }

    public func load() async {
        if entries.isEmpty { phase = .loading }
        do {
            let agreements = try await directory.allAgreements()
            let backend = directory.backend
            var joined: [AgreementRef] = []
            var notJoined: [AgreementRef] = []
            for agreement in agreements {
                if (try? await backend.isMember(contextId: agreement.contextId)) == true {
                    joined.append(agreement)
                } else {
                    notJoined.append(agreement)
                }
            }
            let directory = self.directory
            let results = await withTaskGroup(of: (AgreementRef, Result<AgreementSnapshot, Error>).self) { group in
                for agreement in joined {
                    group.addTask {
                        do { return (agreement, .success(try await directory.snapshot(agreement))) } catch {
                            return (agreement, .failure(error))
                        }
                    }
                }
                var out: [(AgreementRef, Result<AgreementSnapshot, Error>)] = []
                for await item in group { out.append(item) }
                return out
            }
            var loaded: [DocumentEntry] = []
            var stillSyncing: [AgreementRef] = []
            var firstError: Error?
            for (agreement, result) in results {
                switch result {
                case .success(let snapshot): loaded += snapshot.documents
                case .failure(let error):
                    if SignErrorText.isSyncing(error) { stillSyncing.append(agreement) } else { firstError = firstError ?? error }
                }
            }
            entries = loaded
            unopened = notJoined.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
            syncing = stillSyncing
            if loaded.isEmpty, let firstError, stillSyncing.isEmpty {
                phase = .failed(SignErrorText.describe(firstError))
            } else {
                phase = .loaded
            }
        } catch {
            phase = entries.isEmpty ? .failed(SignErrorText.describe(error)) : .loaded
        }
    }

    /// Enter an agreement you can see but haven't opened, as the web's
    /// invitation flow does, then reload.
    public func open(_ agreement: AgreementRef) async {
        opening = agreement.contextId
        defer { opening = nil }
        do {
            try await directory.enter(agreement.contextId)
            await directory.settle(contextId: agreement.contextId, nameHint: agreement.name)
            await load()
        } catch {
            notice = SignErrorText.describe(error)
        }
    }
}
