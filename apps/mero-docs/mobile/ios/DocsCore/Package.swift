// swift-tools-version: 5.9
//
// DocsCore: everything in the iOS app that is not a view. The generated
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
        .package(url: "https://github.com/calimero-network/swift-sdk", revision: "6c5f1167d1e586f556f59c326de5f51d034e80dd"),
    ],
    targets: [
        .target(
            name: "DocsCore",
            dependencies: [.product(name: "MeroKit", package: "swift-sdk")]
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
