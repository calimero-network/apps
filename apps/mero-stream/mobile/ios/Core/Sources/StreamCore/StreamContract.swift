import Foundation
import MeroKit

/// A member of a room's call, as the contract's `getMembers` and `join` answer: the generated
/// client's type. `memberId` is the member's **account** (64 hex); `joinedAt` and `updatedAt`
/// are unix seconds, sent as decimal strings (u64 on the wire).
public typealias Member = StreamClient.Member

/// The room contract (`../../logic`, `res/abi.json`) is `StreamClient`, generated from it into
/// `Generated/` by core's `mero-app-build codegen` (`scripts/mobile-codegen.sh`). The phone calls
/// only `join` and `getMembers`: the probe's in-WASM codec and chunk paths are measurement tools the
/// web keeps.
extension StreamClient {
    /// Every contract method the app calls, with its parameters in ABI order.
    /// `ContractSurfaceTests` pins it to the component ABI.
    public static let methods: [String: [String]] = [
        "join": ["username", "now"],
        "getMembers": [],
    ]

    /// The client for one room's call (app instance), through the signed-in backend.
    public init(backend: any MeroAppBackend, contextId: String) {
        self.init(backend: backend, app: contextId)
    }
}
