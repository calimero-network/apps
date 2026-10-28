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
        // swift-sdk `feat/app-session` (PR #84). Move to the merge commit once it lands.
        .package(url: "https://github.com/calimero-network/swift-sdk", revision: "122bb0d71bb43b823cb9d694c4e70678a2ef8c89"),
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
