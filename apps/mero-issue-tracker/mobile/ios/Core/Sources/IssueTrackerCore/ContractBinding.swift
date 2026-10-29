import Foundation
import MeroKit

// The generated client declares its own `ContextContractCalling` (same two
// methods as MeroKit's), so the SDK's bound contract is adopted here.
extension BoundContextContract: ContextContractCalling {}

extension IssueTrackerClient {
    /// The tracker contract in one repo (context), through the account's relay.
    public init(contract: any ContextContract, contextId: String) {
        self.init(transport: contract.bound(to: contextId))
    }
}
