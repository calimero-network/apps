import Foundation
import MeroKit

extension SheetsClient {
    /// The sheets contract in one spreadsheet (context), through the account's node session.
    public init(contract: any ContextContract, contextId: String) {
        self.init(contract: contract.bound(to: contextId))
    }
}
