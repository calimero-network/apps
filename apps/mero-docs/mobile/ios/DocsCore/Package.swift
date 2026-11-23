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
        // MeroKit from a calimero-network/core release (Calimero 1.0). Keep it equal to
        // ../project.yml.
        .package(url: "https://github.com/calimero-network/core", exact: "1.0.0-rc.35"),
    ],
    targets: [
        .target(
            name: "DocsCore",
            dependencies: [
                .product(name: "MeroKit", package: "core"),
                // `CalimeroAppBackend`: folders are read from the org snapshot (`DocsDirectory`).
                .product(name: "MeroKitUI", package: "core"),
            ]
        ),
        .testTarget(
            name: "DocsCoreTests",
            dependencies: [
                "DocsCore",
                .product(name: "MeroKit", package: "core"),
                .product(name: "MeroKitTestSupport", package: "core"),
            ]
        ),
    ]
)
