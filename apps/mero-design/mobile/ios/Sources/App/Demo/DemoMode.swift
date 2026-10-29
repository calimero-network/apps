import DesignCore
import Foundation
import MeroKit

/// Demo mode: the app on an in-memory account with fixture teams and boards,
/// for screenshots and the scripted UI tour (`MeroDesignUITests`). Debug
/// builds only, and only when launched with `-MeroDemo YES`; in Release this
/// is a constant `nil` and the demo backend and fixtures are not compiled.
enum DemoMode {
    #if DEBUG
    static let isOn = UserDefaults.standard.bool(forKey: "MeroDemo")

    /// The demo account's backend, seeded on first use. `nil` when demo mode is off.
    static let backend: (any MeroAppBackend)? = isOn ? DesignDemo.makeBackend() : nil

    static var applicationId: String? { isOn ? DesignDemo.applicationId : nil }

    /// The boards' image bytes, drawn on the device.
    static var blobs: (any BlobLoading)? { isOn ? DesignDemo.Blobs() : nil }
    #else
    static let isOn = false
    static let backend: (any MeroAppBackend)? = nil
    static let applicationId: String? = nil
    static let blobs: (any BlobLoading)? = nil
    #endif
}
