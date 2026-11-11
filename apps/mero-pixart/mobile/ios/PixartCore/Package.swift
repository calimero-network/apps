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
        // swift-sdk v0.5.0 (Calimero 1.0); keep it equal to `exactVersion` in ../project.yml.
        // Unreleased swift-sdk 1.0 (calimero-network/swift-sdk#91): back to exact: once 1.0.0 is tagged.
        .package(url: "https://github.com/calimero-network/swift-sdk", revision: "5cbce7687095d4ed338f7feeb43a6c2197f219b9"),
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
