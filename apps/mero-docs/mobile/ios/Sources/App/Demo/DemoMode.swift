import DocsCore
import Foundation
import MeroKit

/// Demo mode: the app on an in-memory account with fixture data, for
/// screenshots and the scripted UI tour (`MeroDocsUITests`). Debug builds
/// only, and only when launched with `-MeroDemo YES`; in Release this is a
/// constant `nil` and the demo backend and fixtures are not compiled.
enum DemoMode {
    #if DEBUG
    static let isOn = UserDefaults.standard.bool(forKey: "MeroDemo")

    /// The demo account's backend, seeded on first use. `nil` when demo mode is off.
    static let backend: (any MeroAppBackend)? = isOn ? DocsDemo.makeBackend() : nil

    /// The pictures of the demo documents' image blocks.
    static let blobs: (any BlobLoading)? = isOn ? DocsDemo.Blobs() : nil

    static var applicationId: String? { isOn ? DocsDemo.applicationId : nil }
    #else
    static let isOn = false
    static let backend: (any MeroAppBackend)? = nil
    static let blobs: (any BlobLoading)? = nil
    static let applicationId: String? = nil
    #endif
}
