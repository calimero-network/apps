import Foundation
import MeroKit

extension IssueTrackerClient {
    /// The tracker contract in one repo (app instance), through the account's cluster session.
    public init(contract: any ContextContract, contextId: String) {
        self.init(contract: contract.bound(to: contextId))
    }
}
