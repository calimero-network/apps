// swift-tools-version: 5.9
//
// ModelsCore: everything in the iOS app that is not a view. The generated
// contract client, the invitation format, formatting, and the view models.
// It builds and tests on macOS with `swift test`, so none of it needs a
// simulator; project.yml links it into the app.
//
// The MeroKit pin must match the one in ../project.yml.
import PackageDescription

let package = Package(
    name: "ModelsCore",
    platforms: [.iOS(.v16), .macOS(.v13)],
    products: [
        .library(name: "ModelsCore", targets: ["ModelsCore"]),
    ],
    dependencies: [
        // MeroKit from a calimero-network/core release (Calimero 1.0); keep it equal to
        // `exactVersion` in ../project.yml.
        .package(url: "https://github.com/calimero-network/core", exact: "1.0.0-rc.36"),
    ],
    targets: [
        .target(
            name: "ModelsCore",
            dependencies: [.product(name: "MeroKit", package: "core")]
        ),
        .testTarget(
            name: "ModelsCoreTests",
            dependencies: [
                "ModelsCore",
                .product(name: "MeroKit", package: "core"),
                .product(name: "MeroKitTestSupport", package: "core"),
            ]
        ),
    ]
)
