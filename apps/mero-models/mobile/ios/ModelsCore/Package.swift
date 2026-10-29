// swift-tools-version: 5.9
//
// ModelsCore: everything in the iOS app that is not a view. The generated
// contract client, the invitation format, formatting, and the view models.
// It builds and tests on macOS with `swift test`, so none of it needs a
// simulator; project.yml links it into the app.
//
// The swift-sdk pin must match the one in ../project.yml.
import PackageDescription

let package = Package(
    name: "ModelsCore",
    platforms: [.iOS(.v16), .macOS(.v13)],
    products: [
        .library(name: "ModelsCore", targets: ["ModelsCore"]),
    ],
    dependencies: [
        // swift-sdk `main` merge commit of PR #84.
        .package(url: "https://github.com/calimero-network/swift-sdk", revision: "c9ca1a06ea3b04c24d943cbb0e1d9b30eb4c5a8f"),
    ],
    targets: [
        .target(
            name: "ModelsCore",
            dependencies: [.product(name: "MeroKit", package: "swift-sdk")]
        ),
        .testTarget(
            name: "ModelsCoreTests",
            dependencies: [
                "ModelsCore",
                .product(name: "MeroKit", package: "swift-sdk"),
                .product(name: "MeroKitTestSupport", package: "swift-sdk"),
            ]
        ),
    ]
)
