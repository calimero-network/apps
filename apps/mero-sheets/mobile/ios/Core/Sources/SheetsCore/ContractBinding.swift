import Foundation
import MeroKit

extension SheetsClient {
    /// The sheets contract in one spreadsheet (context), through the account's relay.
    /// The generated client takes MeroKit's `ContextContractCalling` directly.
    public init(contract: any ContextContract, contextId: String) {
        self.init(transport: contract.bound(to: contextId))
    }
}
