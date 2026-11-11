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
        // swift-sdk release v0.5.0 (Calimero 1.0).
        // Keep it equal to ../project.yml.
        // Unreleased swift-sdk 1.0 (calimero-network/swift-sdk#91): back to exact: once 1.0.0 is tagged.
        .package(url: "https://github.com/calimero-network/swift-sdk", revision: "dfc8082102130d03920e096feca6b559555a530d"),
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
