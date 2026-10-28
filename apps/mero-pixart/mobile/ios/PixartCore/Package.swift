// swift-tools-version: 5.9
//
// PixartCore: everything in the iOS app that is not a view. The generated
// contract client, the native compositor (layers + blobs to one image, with
// Core Graphics), the invitation codec and the view models. It builds and
// tests on macOS with `swift test`, so none of it needs a simulator;
// project.yml links it into the app.
import PackageDescription

let package = Package(
    name: "PixartCore",
    platforms: [.iOS(.v16), .macOS(.v13)],
    products: [
        .library(name: "PixartCore", targets: ["PixartCore"]),
    ],
    dependencies: [
        // swift-sdk `feat/app-session` (PR #84). Move to the merge commit once it lands.
        .package(url: "https://github.com/calimero-network/swift-sdk", revision: "122bb0d71bb43b823cb9d694c4e70678a2ef8c89"),
    ],
    targets: [
        .target(
            name: "PixartCore",
            dependencies: [.product(name: "MeroKit", package: "swift-sdk")]
        ),
        .testTarget(
            name: "PixartCoreTests",
            dependencies: [
                "PixartCore",
                .product(name: "MeroKit", package: "swift-sdk"),
                .product(name: "MeroKitTestSupport", package: "swift-sdk"),
            ]
        ),
    ]
)
