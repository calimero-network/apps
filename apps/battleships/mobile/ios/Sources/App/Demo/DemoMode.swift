import BattleshipsCore
import Foundation
import MeroKit

/// Demo mode: the app on an in-memory account with fixture data, for
/// screenshots and the scripted UI tour (`BattleshipsUITests`). Debug builds
/// only, and only when launched with `-MeroDemo YES`; in Release this is a
/// constant `nil` and the demo backend and fixtures are not compiled.
enum DemoMode {
    #if DEBUG
    static let isOn = UserDefaults.standard.bool(forKey: "MeroDemo")

    /// The demo account's backend, seeded on first use. `nil` when demo mode is off.
    static let backend: (any MeroAppBackend)? = isOn ? BattleshipsDemo.backend : nil

    /// Boards in memory, with the fleets of the matches already under way. `nil` when demo mode is off.
    static let boardStore: (any BoardStore)? = isOn ? BattleshipsDemo.boards : nil

    static var applicationId: String? { isOn ? BattleshipsDemo.applicationId : nil }
    #else
    static let isOn = false
    static let backend: (any MeroAppBackend)? = nil
    static let boardStore: (any BoardStore)? = nil
    static let applicationId: String? = nil
    #endif
}
