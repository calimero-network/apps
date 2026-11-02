// swift-tools-version: 5.9
//
// DocsCore: everything in the iOS app that is not a view. The typed
// contract client, the read-only document reader (contract blocks to
// renderable blocks), comment threads, and the view models. It builds and tests on
// macOS with `swift test`, so none of it needs a simulator; project.yml links
// it into the app.
import PackageDescription

let package = Package(
    name: "DocsCore",
    platforms: [.iOS(.v16), .macOS(.v13)],
    products: [
        .library(name: "DocsCore", targets: ["DocsCore"]),
    ],
    dependencies: [
        // swift-sdk#85 (feat/calimero-1.0, Calimero 1.0) head; moves to its merge commit once it lands.
        // Keep it equal to ../project.yml.
        .package(url: "https://github.com/calimero-network/swift-sdk", revision: "37c09f3f96e7d98440f6618eef8a0e83ddee8ebd"),
    ],
    targets: [
        .target(
            name: "DocsCore",
            dependencies: [
                .product(name: "MeroKit", package: "swift-sdk"),
                // `CalimeroAppBackend`: folders are read from the org snapshot (`DocsDirectory`).
                .product(name: "MeroKitUI", package: "swift-sdk"),
            ]
        ),
        .testTarget(
            name: "DocsCoreTests",
            dependencies: [
                "DocsCore",
                .product(name: "MeroKit", package: "swift-sdk"),
                .product(name: "MeroKitTestSupport", package: "swift-sdk"),
            ]
        ),
    ]
)
