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
        // swift-sdk `feat/app-session` (PR #84). Move to the merge commit once it lands.
        .package(url: "https://github.com/calimero-network/swift-sdk", revision: "122bb0d71bb43b823cb9d694c4e70678a2ef8c89"),
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
